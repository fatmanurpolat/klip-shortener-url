// Port: reversible sequence-value ↔ short-code codec (wraps Hashids).
export interface ShortCodeCodec {
  /** Encode a sequence value into a short, unguessable code. */
  encode(seq: bigint): string;
}
