import type { FUNCTION_TREE_HEIGHT, NOTE_HASH_TREE_HEIGHT, VK_TREE_HEIGHT } from '@aztec/constants';
import type { Fr, GrumpkinScalar, Point } from '@aztec/foundation/fields';
import type { MembershipWitness } from '@aztec/foundation/trees';
import type { FunctionSelector } from '@aztec/stdlib/abi';
import type { AztecAddress } from '@aztec/stdlib/aztec-address';
import { UpdatedClassIdHints } from '@aztec/stdlib/kernel';
import type { PublicKeys } from '@aztec/stdlib/keys';
import type { NullifierMembershipWitness } from '@aztec/stdlib/trees';
import type { VerificationKeyAsFields } from '@aztec/stdlib/vks';

/**
 * Provides functionality to fetch membership witnesses for verification keys,
 * contract addresses, and function selectors in their respective merkle trees.
 */
export interface ProvingDataOracle {
  /** Retrieves the preimage of a contract address from the registered contract instances db. */
  getContractAddressPreimage(address: AztecAddress): Promise<{
    saltedInitializationHash: Fr;
    publicKeys: PublicKeys;
    currentContractClassId: Fr;
    originalContractClassId: Fr;
  }>;

  /** Retrieves the preimage of a contract class id from the contract classes db. */
  getContractClassIdPreimage(
    contractClassId: Fr,
  ): Promise<{ artifactHash: Fr; publicBytecodeCommitment: Fr; privateFunctionsRoot: Fr }>;

  /**
   * Retrieve the function membership witness for the given contract class and function selector.
   * The function membership witness represents a proof that the function belongs to the specified contract.
   * Throws an error if the contract address or function selector is unknown.
   *
   * @param contractClassId - The id of the class.
   * @param selector - The function selector.
   * @returns A promise that resolves with the MembershipWitness instance for the specified contract's function.
   */
  getFunctionMembershipWitness(
    contractClassId: Fr,
    selector: FunctionSelector,
  ): Promise<MembershipWitness<typeof FUNCTION_TREE_HEIGHT>>;

  /**
   * Retrieve the membership witness corresponding to a verification key.
   * This function currently returns a random membership witness of the specified height,
   * which is a placeholder implementation until a concrete membership witness calculation
   * is implemented.
   *
   * @param vk - The VerificationKey for which the membership witness is needed.
   * @returns A Promise that resolves to the MembershipWitness instance.
   */
  getVkMembershipWitness(vk: VerificationKeyAsFields): Promise<MembershipWitness<typeof VK_TREE_HEIGHT>>;

  /**
   * Get the note membership witness for a note in the note hash tree at the given leaf index.
   *
   * @param leafIndex - The leaf index of the note in the note hash tree.
   * @returns the MembershipWitness for the note.
   */
  getNoteHashMembershipWitness(leafIndex: bigint): Promise<MembershipWitness<typeof NOTE_HASH_TREE_HEIGHT>>;

  getNullifierMembershipWitness(nullifier: Fr): Promise<NullifierMembershipWitness | undefined>;

  /**
   * Get the root of the note hash tree.
   *
   * @returns the root of the note hash tree.
   */
  getNoteHashTreeRoot(): Promise<Fr>;

  /**
   * Retrieves the sk_m corresponding to the pk_m.
   * @throws If the provided public key is not associated with any of the registered accounts.
   * @param pkM - The master public key to get secret key for.
   * @returns A Promise that resolves to sk_m.
   * @dev Used when feeding the sk_m to the kernel circuit for keys verification.
   */
  getMasterSecretKey(masterPublicKey: Point): Promise<GrumpkinScalar>;

  getDebugFunctionName(contractAddress: AztecAddress, selector: FunctionSelector): Promise<string | undefined>;

  getUpdatedClassIdHints(contractAddress: AztecAddress): Promise<UpdatedClassIdHints>;
}
