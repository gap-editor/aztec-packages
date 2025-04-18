import { getSchnorrWalletWithSecretKey } from '@aztec/accounts/schnorr';
import type { InitialAccountData } from '@aztec/accounts/testing';
import type { AztecNodeConfig, AztecNodeService } from '@aztec/aztec-node';
import type { AccountWalletWithSecretKey } from '@aztec/aztec.js';
import { RollupContract, getExpectedAddress, getL1ContractsConfigEnvVars } from '@aztec/ethereum';
import { L1TxUtilsWithBlobs } from '@aztec/ethereum/l1-tx-utils-with-blobs';
import { ChainMonitor, EthCheatCodesWithState } from '@aztec/ethereum/test';
import { type Logger, createLogger } from '@aztec/foundation/log';
import { ForwarderAbi, ForwarderBytecode, RollupAbi, TestERC20Abi } from '@aztec/l1-artifacts';
import { SpamContract } from '@aztec/noir-contracts.js/Spam';
import type { BootstrapNode } from '@aztec/p2p/bootstrap';
import { createBootstrapNodeFromPrivateKey, getBootstrapNodeEnr } from '@aztec/p2p/test-helpers';
import type { PublicDataTreeLeaf } from '@aztec/stdlib/trees';
import { getGenesisValues } from '@aztec/world-state/testing';

import getPort from 'get-port';
import { getContract } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import {
  ATTESTER_PRIVATE_KEYS_START_INDEX,
  PROPOSER_PRIVATE_KEYS_START_INDEX,
  createValidatorConfig,
  generatePrivateKeys,
} from '../fixtures/setup_p2p_test.js';
import {
  type ISnapshotManager,
  type SubsystemsContext,
  createSnapshotManager,
  deployAccounts,
} from '../fixtures/snapshot_manager.js';
import { getPrivateKeyFromIndex, getSponsoredFPCAddress } from '../fixtures/utils.js';
import { getEndToEndTestTelemetryClient } from '../fixtures/with_telemetry_utils.js';

// Use a fixed bootstrap node private key so that we can re-use the same snapshot and the nodes can find each other
const BOOTSTRAP_NODE_PRIVATE_KEY = '080212208f988fc0899e4a73a5aee4d271a5f20670603a756ad8d84f2c94263a6427c591';
const l1ContractsConfig = getL1ContractsConfigEnvVars();
export const WAIT_FOR_TX_TIMEOUT = l1ContractsConfig.aztecSlotDuration * 3;

export const SHORTENED_BLOCK_TIME_CONFIG = {
  aztecSlotDuration: 12,
  ethereumSlotDuration: 4,
};

export class P2PNetworkTest {
  private snapshotManager: ISnapshotManager;
  private baseAccount;

  public logger: Logger;
  public monitor!: ChainMonitor;

  public ctx!: SubsystemsContext;
  public attesterPrivateKeys: `0x${string}`[] = [];
  public attesterPublicKeys: string[] = [];
  public proposerPrivateKeys: `0x${string}`[] = [];
  public peerIdPrivateKeys: string[] = [];
  public validators: { attester: `0x${string}`; proposer: `0x${string}`; withdrawer: `0x${string}` }[] = [];

  public deployedAccounts: InitialAccountData[] = [];
  public prefilledPublicData: PublicDataTreeLeaf[] = [];
  // The re-execution test needs a wallet and a spam contract
  public wallet?: AccountWalletWithSecretKey;
  public spamContract?: SpamContract;

  public bootstrapNode?: BootstrapNode;

  private cleanupInterval: NodeJS.Timeout | undefined = undefined;

  private gasUtils: L1TxUtilsWithBlobs | undefined = undefined;

  constructor(
    testName: string,
    public bootstrapNodeEnr: string,
    public bootNodePort: number,
    private numberOfNodes: number,
    initialValidatorConfig: AztecNodeConfig,
    // If set enable metrics collection
    private metricsPort?: number,
  ) {
    this.logger = createLogger(`e2e:e2e_p2p:${testName}`);

    // Set up the base account and node private keys for the initial network deployment
    this.baseAccount = privateKeyToAccount(`0x${getPrivateKeyFromIndex(0)!.toString('hex')}`);
    this.proposerPrivateKeys = generatePrivateKeys(PROPOSER_PRIVATE_KEYS_START_INDEX, numberOfNodes);
    this.attesterPrivateKeys = generatePrivateKeys(ATTESTER_PRIVATE_KEYS_START_INDEX, numberOfNodes);
    this.attesterPublicKeys = this.attesterPrivateKeys.map(privateKey => privateKeyToAccount(privateKey).address);

    this.snapshotManager = createSnapshotManager(
      `e2e_p2p_network/${testName}`,
      process.env.E2E_DATA_PATH,
      {
        ...initialValidatorConfig,
        ethereumSlotDuration: initialValidatorConfig.ethereumSlotDuration ?? l1ContractsConfig.ethereumSlotDuration,
        aztecEpochDuration: initialValidatorConfig.aztecEpochDuration ?? l1ContractsConfig.aztecEpochDuration,
        aztecSlotDuration: initialValidatorConfig.aztecSlotDuration ?? l1ContractsConfig.aztecSlotDuration,
        aztecProofSubmissionWindow:
          initialValidatorConfig.aztecProofSubmissionWindow ?? l1ContractsConfig.aztecProofSubmissionWindow,
        salt: 420,
        metricsPort: metricsPort,
        numberOfInitialFundedAccounts: 2,
      },
      {
        ...initialValidatorConfig,
        aztecEpochDuration: initialValidatorConfig.aztecEpochDuration ?? l1ContractsConfig.aztecEpochDuration,
        ethereumSlotDuration: initialValidatorConfig.ethereumSlotDuration ?? l1ContractsConfig.ethereumSlotDuration,
        aztecSlotDuration: initialValidatorConfig.aztecSlotDuration ?? l1ContractsConfig.aztecSlotDuration,
        aztecProofSubmissionWindow:
          initialValidatorConfig.aztecProofSubmissionWindow ?? l1ContractsConfig.aztecProofSubmissionWindow,
        initialValidators: [],
      },
    );
  }

  static async create({
    testName,
    numberOfNodes,
    basePort,
    metricsPort,
    initialConfig,
  }: {
    testName: string;
    numberOfNodes: number;
    basePort?: number;
    metricsPort?: number;
    initialConfig?: Partial<AztecNodeConfig>;
  }) {
    const port = basePort || (await getPort());

    const bootstrapNodeENR = await getBootstrapNodeEnr(BOOTSTRAP_NODE_PRIVATE_KEY, port);
    const bootstrapNodeEnr = bootstrapNodeENR.encodeTxt();

    const initialValidatorConfig = await createValidatorConfig(
      (initialConfig ?? {}) as AztecNodeConfig,
      bootstrapNodeEnr,
    );

    return new P2PNetworkTest(testName, bootstrapNodeEnr, port, numberOfNodes, initialValidatorConfig, metricsPort);
  }

  get fundedAccount() {
    if (!this.deployedAccounts[0]) {
      throw new Error('Call snapshot t.setupAccount to create a funded account.');
    }
    return this.deployedAccounts[0];
  }

  /**
   * Start a loop to sync the mock system time with the L1 block time
   */
  public startSyncMockSystemTimeInterval() {
    this.cleanupInterval = setInterval(() => {
      void this.syncMockSystemTime().catch(err => this.logger.error('Error syncing mock system time', err));
    }, l1ContractsConfig.aztecSlotDuration * 1000);
  }

  /**
   * When using fake timers, we need to keep the system and anvil clocks in sync.
   */
  public async syncMockSystemTime() {
    this.logger.info('Syncing mock system time');
    const { dateProvider, deployL1ContractsValues } = this.ctx!;
    // Send a tx and only update the time after the tx is mined, as eth time is not continuous
    const { receipt } = await this.gasUtils!.sendAndMonitorTransaction({
      to: this.baseAccount.address,
      data: '0x',
      value: 1n,
    });
    const timestamp = await deployL1ContractsValues.publicClient.getBlock({ blockNumber: receipt.blockNumber });
    this.logger.info(`Timestamp: ${timestamp.timestamp}`);
    dateProvider.setTime(Number(timestamp.timestamp) * 1000);
  }

  async applyBaseSnapshots() {
    await this.snapshotManager.snapshot('add-bootstrap-node', async ({ aztecNodeConfig }) => {
      const telemetry = getEndToEndTestTelemetryClient(this.metricsPort);
      this.bootstrapNode = await createBootstrapNodeFromPrivateKey(
        BOOTSTRAP_NODE_PRIVATE_KEY,
        this.bootNodePort,
        telemetry,
        aztecNodeConfig,
      );
      // Overwrite enr with updated info
      this.bootstrapNodeEnr = this.bootstrapNode.getENR().encodeTxt();
    });

    await this.snapshotManager.snapshot(
      'add-validators',
      async ({ deployL1ContractsValues, aztecNodeConfig, dateProvider }) => {
        const rollup = getContract({
          address: deployL1ContractsValues.l1ContractAddresses.rollupAddress.toString(),
          abi: RollupAbi,
          client: deployL1ContractsValues.walletClient,
        });

        this.logger.verbose(`Adding ${this.numberOfNodes} validators`);

        const stakingAsset = getContract({
          address: deployL1ContractsValues.l1ContractAddresses.stakingAssetAddress.toString(),
          abi: TestERC20Abi,
          client: deployL1ContractsValues.walletClient,
        });

        const stakeNeeded = l1ContractsConfig.minimumStake * BigInt(this.numberOfNodes);
        await Promise.all(
          [
            await stakingAsset.write.mint(
              [deployL1ContractsValues.walletClient.account.address, stakeNeeded],
              {} as any,
            ),
            await stakingAsset.write.approve(
              [deployL1ContractsValues.l1ContractAddresses.rollupAddress.toString(), stakeNeeded],
              {} as any,
            ),
          ].map(txHash => deployL1ContractsValues.publicClient.waitForTransactionReceipt({ hash: txHash })),
        );

        const validators = [];

        for (let i = 0; i < this.numberOfNodes; i++) {
          const attester = privateKeyToAccount(this.attesterPrivateKeys[i]!);
          const proposerEOA = privateKeyToAccount(this.proposerPrivateKeys[i]!);
          const forwarder = getExpectedAddress(
            ForwarderAbi,
            ForwarderBytecode,
            [proposerEOA.address],
            proposerEOA.address,
          ).address;
          validators.push({
            attester: attester.address,
            proposer: forwarder,
            withdrawer: attester.address,
            amount: l1ContractsConfig.minimumStake,
          } as const);

          this.logger.info(`Adding attester ${attester.address} proposer ${forwarder} as validator`);
        }

        this.validators = validators;
        await deployL1ContractsValues.publicClient.waitForTransactionReceipt({
          hash: await rollup.write.cheat__InitialiseValidatorSet([validators]),
        });

        const slotsInEpoch = await rollup.read.getEpochDuration();
        const timestamp = await rollup.read.getTimestampForSlot([slotsInEpoch]);
        const cheatCodes = new EthCheatCodesWithState(aztecNodeConfig.l1RpcUrls);
        try {
          await cheatCodes.warp(Number(timestamp));
        } catch (err) {
          this.logger.debug('Warp failed, time already satisfied');
        }

        // Send and await a tx to make sure we mine a block for the warp to correctly progress.
        await deployL1ContractsValues.publicClient.waitForTransactionReceipt({
          hash: await deployL1ContractsValues.walletClient.sendTransaction({
            to: this.baseAccount.address,
            value: 1n,
            account: this.baseAccount,
          }),
        });

        // Set the system time in the node, only after we have warped the time and waited for a block
        // Time is only set in the NEXT block
        dateProvider.setTime(Number(timestamp) * 1000);
      },
    );
  }

  async setupAccount() {
    await this.snapshotManager.snapshot(
      'setup-account',
      deployAccounts(1, this.logger, false),
      async ({ deployedAccounts }, { pxe }) => {
        this.deployedAccounts = deployedAccounts;
        const [account] = deployedAccounts;
        this.wallet = await getSchnorrWalletWithSecretKey(pxe, account.secret, account.signingKey, account.salt);
      },
    );
  }

  async deploySpamContract() {
    await this.snapshotManager.snapshot(
      'add-spam-contract',
      async () => {
        if (!this.wallet) {
          throw new Error('Call snapshot t.setupAccount before deploying account contract');
        }

        const spamContract = await SpamContract.deploy(this.wallet).send().deployed();
        return { contractAddress: spamContract.address };
      },
      async ({ contractAddress }) => {
        if (!this.wallet) {
          throw new Error('Call snapshot t.setupAccount before deploying account contract');
        }
        this.spamContract = await SpamContract.at(contractAddress, this.wallet);
      },
    );
  }

  async removeInitialNode() {
    await this.snapshotManager.snapshot(
      'remove-inital-validator',
      async ({ deployL1ContractsValues, aztecNode, dateProvider }) => {
        // Send and await a tx to make sure we mine a block for the warp to correctly progress.
        const receipt = await deployL1ContractsValues.publicClient.waitForTransactionReceipt({
          hash: await deployL1ContractsValues.walletClient.sendTransaction({
            to: this.baseAccount.address,
            value: 1n,
            account: this.baseAccount,
          }),
        });
        const block = await deployL1ContractsValues.publicClient.getBlock({
          blockNumber: receipt.blockNumber,
        });
        dateProvider.setTime(Number(block.timestamp) * 1000);

        await aztecNode.stop();
      },
    );
  }

  async setup() {
    this.ctx = await this.snapshotManager.setup();

    const sponsoredFPCAddress = await getSponsoredFPCAddress();
    const initialFundedAccounts = [...this.ctx.initialFundedAccounts.map(a => a.address), sponsoredFPCAddress];

    const { prefilledPublicData } = await getGenesisValues(initialFundedAccounts);
    this.prefilledPublicData = prefilledPublicData;

    this.startSyncMockSystemTimeInterval();

    this.gasUtils = new L1TxUtilsWithBlobs(
      this.ctx.deployL1ContractsValues.publicClient,
      this.ctx.deployL1ContractsValues.walletClient,
      this.logger,
      {
        gasLimitBufferPercentage: 20,
        maxGwei: 500n,
        maxAttempts: 3,
        checkIntervalMs: 100,
        stallTimeMs: 1000,
      },
    );

    this.monitor = new ChainMonitor(RollupContract.getFromL1ContractsValues(this.ctx.deployL1ContractsValues)).start();
  }

  async stopNodes(nodes: AztecNodeService[]) {
    this.logger.info('Stopping nodes');

    if (!nodes || !nodes.length) {
      this.logger.info('No nodes to stop');
      return;
    }

    await Promise.all(nodes.map(node => node.stop()));

    this.logger.info('Nodes stopped');
  }

  async teardown() {
    this.monitor.stop();
    await this.bootstrapNode?.stop();
    await this.snapshotManager.teardown();
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}
