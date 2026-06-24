import { Clock } from '../ports';

/** Wall-clock adapter for the Clock port. */
export function createSystemClock(): Clock {
  return { now: () => new Date() };
}
