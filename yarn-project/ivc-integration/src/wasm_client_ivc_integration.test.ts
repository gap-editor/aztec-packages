import { AztecClientBackend } from '@aztec/bb.js';

import { jest } from '@jest/globals';

/* eslint-disable camelcase */
import createDebug from 'debug';
import { ungzip } from 'pako';

import {
  MOCK_MAX_COMMITMENTS_PER_TX,
  MockAppCreatorCircuit,
  MockAppCreatorVk,
  MockAppReaderCircuit,
  MockAppReaderVk,
  MockPrivateKernelInitCircuit,
  MockPrivateKernelInitVk,
  MockPrivateKernelInnerCircuit,
  MockPrivateKernelInnerVk,
  MockPrivateKernelResetCircuit,
  MockPrivateKernelResetVk,
  MockPrivateKernelTailCircuit,
  getVkAsFields,
  witnessGenCreatorAppMockCircuit,
  witnessGenMockPrivateKernelInitCircuit,
  witnessGenMockPrivateKernelInnerCircuit,
  witnessGenMockPrivateKernelResetCircuit,
  witnessGenMockPrivateKernelTailCircuit,
  witnessGenReaderAppMockCircuit,
} from './index.js';
import { proveThenVerifyAztecClient } from './prove_wasm.js';

const logger = createDebug('ivc-integration:test:wasm');
createDebug.enable('*');

jest.setTimeout(120_000);

describe('Client IVC Integration', () => {
  beforeEach(async () => {});

  // This test will verify a client IVC proof of a simple tx:
  // 1. Run a mock app that creates two commitments
  // 2. Run the init kernel to process the app run
  // 3. Run the tail kernel to finish the client IVC chain.
  it('Should generate a verifiable client IVC proof from a simple mock tx via bb.js', async () => {
    const tx = {
      number_of_calls: '0x1',
    };
    // Witness gen app and kernels
    const appWitnessGenResult = await witnessGenCreatorAppMockCircuit({ commitments_to_create: ['0x1', '0x2'] });
    logger('generated app mock circuit witness');

    const initWitnessGenResult = await witnessGenMockPrivateKernelInitCircuit({
      app_inputs: appWitnessGenResult.publicInputs,
      tx,
      app_vk: getVkAsFields(MockAppCreatorVk),
    });
    logger('generated mock private kernel init witness');

    const tailWitnessGenResult = await witnessGenMockPrivateKernelTailCircuit({
      prev_kernel_public_inputs: initWitnessGenResult.publicInputs,
      kernel_vk: getVkAsFields(MockPrivateKernelInitVk),
    });
    logger('generated mock private kernel tail witness');

    // Create client IVC proof
    const bytecodes = [
      MockAppCreatorCircuit.bytecode,
      MockPrivateKernelInitCircuit.bytecode,
      MockPrivateKernelTailCircuit.bytecode,
    ];

    logger('built bytecode array');
    const witnessStack = [appWitnessGenResult.witness, initWitnessGenResult.witness, tailWitnessGenResult.witness];
    logger('built witness stack');

    const verifyResult = await proveThenVerifyAztecClient(bytecodes, witnessStack);
    logger(`generated then verified proof. result: ${verifyResult}`);

    expect(verifyResult).toEqual(true);
  });

  it('Should generate an array of gate numbers for the stack of programs being proved by ClientIVC', async () => {
    // Create ACIR bytecodes
    const bytecodes = [
      MockAppCreatorCircuit.bytecode,
      MockPrivateKernelInitCircuit.bytecode,
      MockPrivateKernelTailCircuit.bytecode,
    ];

    // Initialize AztecClientBackend with the given bytecodes
    const backend = new AztecClientBackend(bytecodes.map(base64ToUint8Array).map((arr: Uint8Array) => ungzip(arr)));

    // Compute the numbers of gates in each circuit
    const gateNumbers = await backend.gates();
    await backend.destroy();
    logger('Gate numbers for each circuit:', gateNumbers);
    // STARTER: add a test here instantiate an AztecClientBackend with the above bytecodes, call gates, and check they're correct (maybe just
    // eyeball against logs to start... better is to make another test that actually pins the sizes since the mock protocol circuits are
    // intended not to change, though for sure there will be some friction, and such test should actually just be located in barretenberg/ts)
  });
  // This test will verify a client IVC proof of a more complex tx:
  // 1. Run a mock app that creates two commitments
  // 2. Run the init kernel to process the app run
  // 3. Run a mock app that reads one of those commitments
  // 4. Run the inner kernel to process the second app run
  // 5. Run the reset kernel to process the read request emitted by the reader app
  // 6. Run the tail kernel to finish the client IVC chain
  it('Should generate a verifiable client IVC proof from a complex mock tx', async () => {
    const tx = {
      number_of_calls: '0x2',
    };
    // Witness gen app and kernels
    const creatorAppWitnessGenResult = await witnessGenCreatorAppMockCircuit({ commitments_to_create: ['0x1', '0x2'] });
    const readerAppWitnessGenResult = await witnessGenReaderAppMockCircuit({ commitments_to_read: ['0x2', '0x0'] });

    const initWitnessGenResult = await witnessGenMockPrivateKernelInitCircuit({
      app_inputs: creatorAppWitnessGenResult.publicInputs,
      tx,
      app_vk: getVkAsFields(MockAppCreatorVk),
    });
    const innerWitnessGenResult = await witnessGenMockPrivateKernelInnerCircuit({
      prev_kernel_public_inputs: initWitnessGenResult.publicInputs,
      app_inputs: readerAppWitnessGenResult.publicInputs,
      app_vk: getVkAsFields(MockAppReaderVk),
      kernel_vk: getVkAsFields(MockPrivateKernelInitVk),
    });

    const resetWitnessGenResult = await witnessGenMockPrivateKernelResetCircuit({
      prev_kernel_public_inputs: innerWitnessGenResult.publicInputs,
      commitment_read_hints: [
        '0x1', // Reader reads commitment 0x2, which is at index 1 of the created commitments
        MOCK_MAX_COMMITMENTS_PER_TX.toString(), // Pad with no-ops
        MOCK_MAX_COMMITMENTS_PER_TX.toString(),
        MOCK_MAX_COMMITMENTS_PER_TX.toString(),
      ],
      kernel_vk: getVkAsFields(MockPrivateKernelInnerVk),
    });

    const tailWitnessGenResult = await witnessGenMockPrivateKernelTailCircuit({
      prev_kernel_public_inputs: resetWitnessGenResult.publicInputs,
      kernel_vk: getVkAsFields(MockPrivateKernelResetVk),
    });

    // Create client IVC proof
    const bytecodes = [
      MockAppCreatorCircuit.bytecode,
      MockPrivateKernelInitCircuit.bytecode,
      MockAppReaderCircuit.bytecode,
      MockPrivateKernelInnerCircuit.bytecode,
      MockPrivateKernelResetCircuit.bytecode,
      MockPrivateKernelTailCircuit.bytecode,
    ];
    const witnessStack = [
      creatorAppWitnessGenResult.witness,
      initWitnessGenResult.witness,
      readerAppWitnessGenResult.witness,
      innerWitnessGenResult.witness,
      resetWitnessGenResult.witness,
      tailWitnessGenResult.witness,
    ];

    const verifyResult = await proveThenVerifyAztecClient(bytecodes, witnessStack);
    logger(`generated then verified proof. result: ${verifyResult}`);

    expect(verifyResult).toEqual(true);
  });
});
function base64ToUint8Array(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
}
