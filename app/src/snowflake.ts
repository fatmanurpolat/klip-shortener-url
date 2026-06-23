import { env } from './env';

/**
 * Snowflake-style distributed 64-bit ID generator.
 *
 * Use as COUNTER_BACKEND=snowflake when IDs must be minted independently on many
 * nodes WITHOUT a central counter (Redis INCR / Postgres sequence). Each node
 * stamps its own MACHINE_ID into the id, so two nodes never collide — PROVIDED
 * every replica has a UNIQUE MACHINE_ID (see the big warning in initSnowflake /
 * counter.ts: `docker compose --scale` shares one env, so you must assign
 * MACHINE_ID per replica or two replicas will mint duplicate ids).
 *
 * Bit layout (63 usable bits; bit 63 sign stays 0 so ids are always positive):
 *   [ 41 bits: ms since EPOCH ][ 10 bits: machine id ][ 12 bits: sequence ]
 *   - 4096 ids / ms / machine, 1024 machines, ~69.7 years from EPOCH.
 * Max id = 2^63-1, exactly Postgres BIGINT max — fits link_id with no overflow.
 */

// Custom epoch: 2026-01-01T00:00:00Z. Date.UTC (not `new Date('2026-01-01')`) to
// be unambiguous about the timezone. ms granularity.
export const SNOWFLAKE_EPOCH = BigInt(Date.UTC(2026, 0, 1));

const TIMESTAMP_BITS = 41n;
const MACHINE_BITS = 10n;
const SEQUENCE_BITS = 12n;

export const MAX_MACHINE_ID = (1n << MACHINE_BITS) - 1n; // 1023
const MAX_SEQUENCE = (1n << SEQUENCE_BITS) - 1n; // 4095
const MACHINE_SHIFT = SEQUENCE_BITS; // 12
const TIMESTAMP_SHIFT = SEQUENCE_BITS + MACHINE_BITS; // 22
const MAX_TIMESTAMP = (1n << TIMESTAMP_BITS) - 1n; // ~69.7 years past EPOCH

/**
 * A single machine's id generator. State (lastTimestamp/sequence) is per-instance;
 * uniqueness ACROSS machines comes from the machineId bits, not shared state.
 * The optional clock is injectable for deterministic tests.
 */
export class SnowflakeGenerator {
  readonly machineId: bigint;
  private readonly epoch: bigint;
  private readonly clock: () => number;
  private lastTimestamp = -1n;
  private sequence = 0n;

  constructor(machineId: bigint, opts: { epoch?: bigint; clock?: () => number } = {}) {
    if (machineId < 0n || machineId > MAX_MACHINE_ID) {
      throw new Error(`Snowflake: MACHINE_ID must be 0..${MAX_MACHINE_ID}, got ${machineId}`);
    }
    this.machineId = machineId;
    this.epoch = opts.epoch ?? SNOWFLAKE_EPOCH;
    this.clock = opts.clock ?? Date.now;
  }

  /** Current time as ms-since-epoch (the 41-bit timestamp domain). */
  private now(): bigint {
    return BigInt(this.clock()) - this.epoch;
  }

  /** Busy-wait until strictly after `after` (used on per-ms sequence exhaustion). */
  private waitNextMillis(after: bigint): bigint {
    let ts = this.now();
    while (ts <= after) ts = this.now();
    return ts;
  }

  /** Mint the next id. Throws if the clock runs backwards (would risk a duplicate). */
  next(): bigint {
    let ts = this.now();

    if (ts < 0n) {
      // Wall clock is before EPOCH (2026-01-01). A negative ts would shift into the
      // sign bit and mint a NEGATIVE id (and ts === -1 would even slip past the
      // backwards-clock check below). Refuse outright.
      throw new Error(`Snowflake: clock is before EPOCH (2026-01-01) by ${-ts}ms — refusing to mint an id.`);
    }

    if (ts < this.lastTimestamp) {
      // CLOCK WENT BACKWARDS (NTP step, VM migration, manual change). The spec's
      // naive code would reset sequence and re-mint ids for an already-used ms —
      // producing DUPLICATES and breaking monotonicity. Refuse instead: the caller
      // surfaces a 503 and retries once the clock catches up. (A duplicate id is
      // far worse than a brief shorten failure.)
      throw new Error(
        `Snowflake: clock moved backwards by ${this.lastTimestamp - ts}ms — refusing to mint an id.`,
      );
    }

    if (ts === this.lastTimestamp) {
      // Same ms → advance the 12-bit sequence; on wrap (>4095) spin to the next ms.
      this.sequence = (this.sequence + 1n) & MAX_SEQUENCE;
      if (this.sequence === 0n) {
        ts = this.waitNextMillis(this.lastTimestamp);
      }
    } else {
      // New ms → restart the sequence.
      this.sequence = 0n;
    }

    if (ts > MAX_TIMESTAMP) {
      throw new Error(`Snowflake: timestamp exhausted the 41-bit field (~69 years past EPOCH).`);
    }

    this.lastTimestamp = ts;
    return (ts << TIMESTAMP_SHIFT) | (this.machineId << MACHINE_SHIFT) | this.sequence;
  }
}

// Process-wide default generator, created lazily from env.MACHINE_ID on first use.
let defaultGenerator: SnowflakeGenerator | null = null;

/** Ensure the default generator exists (validates MACHINE_ID). Mints nothing. */
export function initSnowflake(): SnowflakeGenerator {
  if (!defaultGenerator) defaultGenerator = new SnowflakeGenerator(BigInt(env.MACHINE_ID));
  return defaultGenerator;
}

/** Mint the next id from this process's machine. */
export function nextSnowflakeId(): bigint {
  return initSnowflake().next();
}

// --- Introspection helpers (decode an id back into its parts) -----------------
/** Absolute ms timestamp embedded in `id` (= ms-since-epoch + EPOCH). */
export function snowflakeTimestamp(id: bigint): bigint {
  return (id >> TIMESTAMP_SHIFT) + SNOWFLAKE_EPOCH;
}
export function snowflakeMachineId(id: bigint): bigint {
  return (id >> MACHINE_SHIFT) & MAX_MACHINE_ID;
}
export function snowflakeSequence(id: bigint): bigint {
  return id & MAX_SEQUENCE;
}
