import { mintCode } from '../domain/codes';
import { ShortCodeCodec } from '../ports';

/** ShortCodeCodec adapter delegating to the Hashids-based domain codec. */
export function createHashidsShortCodeCodec(): ShortCodeCodec {
  return { encode: (seq: bigint) => mintCode(seq) };
}
