import { getNextId } from '../counter';
import { IdGenerator } from '../ports';

/** IdGenerator adapter delegating to the configured counter backend. */
export function createCounterIdGenerator(): IdGenerator {
  return { nextId: () => getNextId() };
}
