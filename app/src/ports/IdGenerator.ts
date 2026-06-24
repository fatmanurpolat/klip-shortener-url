// Port: unique-ID source (wraps the redis/postgres/snowflake counter).
export interface IdGenerator {
  /** The next strictly-unique sequence value. */
  nextId(): Promise<bigint>;
}
