// Port: time source (injectable for deterministic tests).
export interface Clock {
  now(): Date;
}
