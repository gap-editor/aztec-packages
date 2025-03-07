import { getInitialTestAccounts } from "@aztec/accounts/testing/lazy";
import { getSchnorrAccount } from "@aztec/accounts/schnorr/lazy";
import {
  AccountWalletWithSecretKey,
  createAztecNodeClient,
  createLogger,
} from "@aztec/aztec.js";
import { BBWASMLazyPrivateKernelProver } from "@aztec/bb-prover/wasm/lazy";
import { KeyStore } from "@aztec/key-store";
import { createStore } from "@aztec/kv-store/indexeddb";
import { L2TipsStore } from "@aztec/kv-store/stores";
import { PXEServiceConfig, getPXEServiceConfig } from "@aztec/pxe/config";
import { KVPxeDatabase } from "@aztec/pxe/database";
import { PXEService } from "@aztec/pxe/service";
import { WASMSimulator } from "@aztec/simulator/client";
import { LazyProtocolContractsProvider } from "@aztec/protocol-contracts/providers/lazy";

export class PrivateEnv {
  pxe: PXEService;
  wallet: AccountWalletWithSecretKey;

  constructor() {}

  async init() {
    const nodeURL = process.env.AZTEC_NODE_URL ?? "http://localhost:8080";

    const config = getPXEServiceConfig();
    config.dataDirectory = "pxe";
    const aztecNode = await createAztecNodeClient(nodeURL);
    const simulationProvider = new WASMSimulator();
    const proofCreator = new BBWASMLazyPrivateKernelProver(
      simulationProvider,
      16,
    );
    const l1Contracts = await aztecNode.getL1ContractAddresses();
    const configWithContracts = {
      ...config,
      l1Contracts,
    } as PXEServiceConfig;

    const store = await createStore(
      "pxe_data",
      configWithContracts,
      createLogger("pxe:data:idb"),
    );

    const keyStore = new KeyStore(store);

    const db = await KVPxeDatabase.create(store);
    const tips = new L2TipsStore(store, "pxe");

    const protocolContractsProvider = new LazyProtocolContractsProvider();

    this.pxe = new PXEService(
      keyStore,
      aztecNode,
      db,
      tips,
      proofCreator,
      simulationProvider,
      protocolContractsProvider,
      config,
    );
    await this.pxe.init();
    const [accountData] = await getInitialTestAccounts();
    const account = await getSchnorrAccount(
      this.pxe,
      accountData.secret,
      accountData.signingKey,
      accountData.salt,
    );
    await account.register();
    this.wallet = await account.getWallet();
  }

  async getWallet() {
    return this.wallet;
  }
}

export const deployerEnv = new PrivateEnv();
