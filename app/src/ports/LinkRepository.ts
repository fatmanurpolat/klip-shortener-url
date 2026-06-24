// Port: persistence of short links. No infra imports — a pure interface.

export type Owner = string | null;

/** Inputs for the active-link quota count (owner OR anonymous IP prefix). */
export interface QuotaQuery {
  ownerId: Owner;
  /** IPv4 /24 or IPv6 /48 prefix; '' when unavailable (anon quota then skipped). */
  ipPrefix: string;
}

/** A link ready to persist. `id` is the bigint as text (seq + COUNTER_OFFSET). */
export interface NewLink {
  id: string;
  shortCode: string;
  longUrl: string;
  ownerId: Owner;
  isPrivate: boolean;
  /** prefer_301 in the DB; true means analytics OFF. */
  prefer301: boolean;
  expiresAt: string | null;
  /** Written to BOTH tables (links + links_code_lookup); it's the partition key. */
  createdAt: Date;
  ipPrefix: string | null;
  /** Selects the ON CONFLICT lookup SQL (custom aliases can collide). */
  isCustomAlias: boolean;
}

export type CreateLinkResult = { ok: true } | { ok: false; reason: 'alias_taken' };

export interface LinkRepository {
  /** Count of the owner's (or anon IP-prefix's) ACTIVE links; used for the quota. */
  countActiveLinks(q: QuotaQuery): Promise<number>;
  /**
   * Persist link + code-lookup in ONE transaction. Returns
   * `{ ok:false, reason:'alias_taken' }` when a custom alias collided; throws on
   * any infra failure (the caller maps that to a 500).
   */
  createLink(link: NewLink): Promise<CreateLinkResult>;
}
