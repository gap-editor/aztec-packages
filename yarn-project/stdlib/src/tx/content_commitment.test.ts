import { CONTENT_COMMITMENT_LENGTH } from '@aztec/constants';
import { randomInt } from '@aztec/foundation/crypto';

import { makeContentCommitment } from '../tests/factories.js';
import { ContentCommitment } from './content_commitment.js';

describe('Content Commitment', () => {
  let contentCommitment: ContentCommitment;

  beforeAll(() => {
    contentCommitment = makeContentCommitment(randomInt(1000));
  });

  it('serializes to buffer and deserializes it back', () => {
    const buffer = contentCommitment.toBuffer();
    const res = ContentCommitment.fromBuffer(buffer);
    expect(res).toEqual(contentCommitment);
  });

  it('serializes to field array and deserializes it back', () => {
    const fieldArray = contentCommitment.toFields();
    const res = ContentCommitment.fromFields(fieldArray);
    expect(res).toEqual(contentCommitment);
  });

  it('number of fields matches constant', () => {
    const fields = contentCommitment.toFields();
    expect(fields.length).toBe(CONTENT_COMMITMENT_LENGTH);
  });
});
