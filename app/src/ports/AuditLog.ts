// Port: abuse-investigation audit trail for shortens.
export interface AuditEntry {
  shortCode: string;
  longUrl: string;
  ownerId: string | null;
  ipPrefix: string | null;
  createdAt: Date;
}

export interface AuditLog {
  /** Fire-and-forget: records the shorten, never throws to / blocks the caller. */
  record(entry: AuditEntry): void;
}
