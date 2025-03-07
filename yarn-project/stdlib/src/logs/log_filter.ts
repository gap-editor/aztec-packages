import { z } from 'zod';

import type { AztecAddress } from '../aztec-address/index.js';
import { type ZodFor, schemas } from '../schemas/index.js';
import { TxHash } from '../tx/tx_hash.js';
import { LogId } from './log_id.js';

/**
 * Log filter used to fetch L2 logs.
 * @remarks This filter is applied as an intersection of all it's params.
 */
export type LogFilter = {
  /** Hash of a transaction from which to fetch the logs. */
  txHash?: TxHash;
  /** The block number from which to start fetching logs (inclusive). */
  fromBlock?: number;
  /** The block number until which to fetch logs (not inclusive). */
  toBlock?: number;
  /** Log id after which to start fetching logs. */
  afterLog?: LogId;
  /** The contract address to filter logs by. */
  contractAddress?: AztecAddress;
};

export const LogFilterSchema: ZodFor<LogFilter> = z.object({
  txHash: TxHash.schema.optional(),
  fromBlock: schemas.Integer.optional(),
  toBlock: schemas.Integer.optional(),
  afterLog: LogId.schema.optional(),
  contractAddress: schemas.AztecAddress.optional(),
});
