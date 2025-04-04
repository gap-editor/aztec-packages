import { Fr } from '@aztec/foundation/fields';
import type { Writeable } from '@aztec/foundation/types';
import { ProtocolContractAddress } from '@aztec/protocol-contracts';
import { computeFeePayerBalanceStorageSlot } from '@aztec/protocol-contracts/fee-juice';
import { FunctionSelector } from '@aztec/stdlib/abi';
import { AztecAddress } from '@aztec/stdlib/aztec-address';
import { GasFees, GasSettings } from '@aztec/stdlib/gas';
import { mockTx } from '@aztec/stdlib/testing';
import type { PublicStateSource } from '@aztec/stdlib/trees';
import type { Tx } from '@aztec/stdlib/tx';

import { type MockProxy, mock, mockFn } from 'jest-mock-extended';

import { GasTxValidator } from './gas_validator.js';
import { patchNonRevertibleFn, patchRevertibleFn } from './test_utils.js';

describe('GasTxValidator', () => {
  // Vars for validator.
  let publicStateSource: MockProxy<PublicStateSource>;
  let feeJuiceAddress: AztecAddress;
  let gasFees: Writeable<GasFees>;
  // Vars for tx.
  let tx: Tx;
  let payer: AztecAddress;
  let expectedBalanceSlot: Fr;
  let feeLimit: bigint;

  beforeEach(async () => {
    publicStateSource = mock<PublicStateSource>({
      storageRead: mockFn().mockImplementation((_address: AztecAddress, _slot: Fr) => Fr.ZERO),
    });
    feeJuiceAddress = ProtocolContractAddress.FeeJuice;
    gasFees = new GasFees(11, 22);

    tx = await mockTx(1, { numberOfNonRevertiblePublicCallRequests: 2 });
    tx.data.feePayer = await AztecAddress.random();
    tx.data.constants.txContext.gasSettings = GasSettings.default({ maxFeesPerGas: gasFees.clone() });
    payer = tx.data.feePayer;
    expectedBalanceSlot = await computeFeePayerBalanceStorageSlot(payer);
    feeLimit = tx.data.constants.txContext.gasSettings.getFeeLimit().toBigInt();
  });

  const mockBalance = (balance: bigint) => {
    publicStateSource.storageRead.mockImplementation((address, slot) =>
      Promise.resolve(address.equals(feeJuiceAddress) && slot.equals(expectedBalanceSlot) ? new Fr(balance) : Fr.ZERO),
    );
  };

  const validateTx = async (tx: Tx) => {
    const validator = new GasTxValidator(publicStateSource, feeJuiceAddress, gasFees);
    return await validator.validateTx(tx);
  };

  const expectValid = async (tx: Tx) => {
    await expect(validateTx(tx)).resolves.toEqual({ result: 'valid' });
  };

  const expectInvalid = async (tx: Tx, reason: string) => {
    await expect(validateTx(tx)).resolves.toEqual({ result: 'invalid', reason: [reason] });
  };

  const expectSkipped = async (tx: Tx, reason: string) => {
    await expect(validateTx(tx)).resolves.toEqual({ result: 'skipped', reason: [reason] });
  };

  it('allows fee paying txs if fee payer has enough balance', async () => {
    mockBalance(feeLimit);
    await expectValid(tx);
  });

  it('allows fee paying txs if fee payer claims enough balance during setup', async () => {
    mockBalance(feeLimit - 1n);
    const selector = await FunctionSelector.fromSignature('_increase_public_balance((Field),u128)');
    await patchNonRevertibleFn(tx, 0, {
      address: ProtocolContractAddress.FeeJuice,
      selector,
      args: [payer.toField(), new Fr(1n)],
      msgSender: ProtocolContractAddress.FeeJuice,
    });
    await expectValid(tx);
  });

  it('rejects txs if fee payer has not enough balance', async () => {
    mockBalance(feeLimit - 1n);
    await expectInvalid(tx, 'Insufficient fee payer balance');
  });

  it('rejects txs if fee payer has zero balance', async () => {
    await expectInvalid(tx, 'Insufficient fee payer balance');
  });

  it('rejects txs if fee payer claims balance outside setup', async () => {
    mockBalance(feeLimit - 1n);
    await patchRevertibleFn(tx, 0, {
      selector: await FunctionSelector.fromSignature('_increase_public_balance((Field),u128)'),
      args: [payer.toField(), new Fr(1n)],
    });
    await expectInvalid(tx, 'Insufficient fee payer balance');
  });

  it('skips txs with not enough fee per da gas', async () => {
    gasFees.feePerDaGas = gasFees.feePerDaGas.add(new Fr(1));
    await expectSkipped(tx, 'Insufficient fee per gas');
  });

  it('skips txs with not enough fee per l2 gas', async () => {
    gasFees.feePerL2Gas = gasFees.feePerL2Gas.add(new Fr(1));
    await expectSkipped(tx, 'Insufficient fee per gas');
  });
});
