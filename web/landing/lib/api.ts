/**
 * Klip API client (browser-side).
 *
 * Base URL resolves from NEXT_PUBLIC_API_BASE. In production behind nginx the
 * landing page and API share an origin, so the default ("") yields same-origin
 * calls like `/api/v1/shorten`. For local dev against the Fastify app on
 * port 3000, set NEXT_PUBLIC_API_BASE=http://localhost:3000.
 */

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";
export const SHORT_DOMAIN = process.env.NEXT_PUBLIC_SHORT_DOMAIN ?? "klipo.to";

export interface ShortenRequest {
  url: string;
  customAlias?: string;
  expiresAt?: string; // ISO 8601, must be in the future
  private?: boolean;
  analytics?: boolean;
}

export interface ShortenResult {
  shortUrl: string;
  code: string;
  longUrl: string;
  createdAt: string;
  expiresAt: string | null;
  private: boolean;
  analytics: boolean;
}

export interface ApiError {
  error: string;
  message?: string;
}

export class ShortenError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ShortenError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Shorten a URL. Resolves to the created link, or throws ShortenError with a
 * human-readable message mapped from the backend's error contract.
 */
export async function shorten(body: ShortenRequest): Promise<ShortenResult> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/v1/shorten`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Include cookies so authenticated (private) links work once signed in.
      credentials: "include",
      body: JSON.stringify({
        url: body.url,
        ...(body.customAlias ? { customAlias: body.customAlias } : {}),
        ...(body.expiresAt ? { expiresAt: body.expiresAt } : {}),
        private: body.private ?? false,
        analytics: body.analytics ?? true,
      }),
    });
  } catch {
    throw new ShortenError(0, "network_error", "Could not reach Klip. Check your connection and try again.");
  }

  const data = (await res.json().catch(() => ({}))) as Partial<ShortenResult & ApiError>;

  if (res.status === 201 && data.shortUrl) {
    return data as ShortenResult;
  }

  // For documented error codes, the on-brand copy WINS over the backend's
  // clinical message (e.g. "This alias is already in use." → our warmer line).
  // Unknown codes fall back to the server message, then a generic friendly one.
  const code = data.error;
  const message =
    code && KNOWN_ERROR_CODES.has(code)
      ? friendlyError(res.status, code)
      : data.message || friendlyError(res.status, code);
  throw new ShortenError(res.status, code ?? "error", message);
}

/** Codes for which lib/api.ts owns warmer, on-brand copy (server text ignored). */
const KNOWN_ERROR_CODES = new Set([
  "invalid_url",
  "invalid_expiry",
  "reserved_alias",
  "alias_taken",
  "auth_required",
  "unsafe_url",
  "blocked_host",
  "unresolvable_host",
  "self_referential",
]);

/**
 * Request a magic sign-in link. Resolves on success (the server always replies
 * "Check your email" to avoid leaking which addresses exist); throws a
 * reassuring, never-blaming message otherwise.
 */
export async function requestLogin(email: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/v1/auth/request-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email }),
    });
  } catch {
    throw new ShortenError(0, "network_error", "Couldn't send just now — give it another try in a moment.");
  }
  if (res.ok) return;
  const data = (await res.json().catch(() => ({}))) as ApiError;
  if (res.status === 400 || res.status === 422) {
    throw new ShortenError(res.status, data.error ?? "invalid_email", "That email looks a little off — mind checking it?");
  }
  if (res.status === 429) {
    throw new ShortenError(429, "rate_limited", "That's a few too many tries — give it a minute and we'll send another.");
  }
  throw new ShortenError(res.status, data.error ?? "error", "Couldn't send just now — give it another try in a moment.");
}

/** Reassuring, on-brand fallbacks when the server doesn't supply a message. */
function friendlyError(status: number, code?: string): string {
  switch (code) {
    case "invalid_url":
      return "That doesn't look like a valid link. Paste a full http(s) URL.";
    case "invalid_expiry":
      return "The expiry date needs to be in the future.";
    case "reserved_alias":
      return "That custom alias is reserved — try another.";
    case "alias_taken":
      return "That custom alias is already in bloom. Pick a different one.";
    case "auth_required":
      return "Sign in to create a private link.";
    case "unsafe_url":
      return "We can't shorten that destination right now — try a different link.";
    case "blocked_host":
      return "That destination isn't allowed — try a public web address.";
    case "unresolvable_host":
      return "We couldn't reach that site — double-check the address?";
    case "self_referential":
      return "That's already a Klipo link — paste the original long URL.";
    default:
      return status >= 500
        ? "Klip hit a snag on our end. Please try again in a moment."
        : `Request failed (HTTP ${status}).`;
  }
}
