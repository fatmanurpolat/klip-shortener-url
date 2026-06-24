/**
 * Klipo dashboard API client.
 *
 * In dev, Vite proxies /api → the Fastify app (see vite.config.ts), so calls are
 * same-origin and the HttpOnly session cookie flows automatically. In production
 * behind nginx the dashboard and API also share an origin. API_BASE is therefore
 * empty by default; override with VITE_API_BASE only for a split-origin setup.
 */

export const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";
export const SHORT_DOMAIN = (import.meta.env.VITE_SHORT_DOMAIN as string | undefined) ?? "klipo.to";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

interface RequestOpts {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
}

async function request<T>(path: string, opts: RequestOpts = {}): Promise<{ status: number; data: T }> {
  const { method = "GET", body, query } = opts;
  let url = `${API_BASE}${path}`;
  if (query) {
    const qs = Object.entries(query)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&");
    if (qs) url += `?${qs}`;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: "include",
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "network_error", "Couldn't reach Klipo. Check your connection and try again.");
  }

  if (res.status === 204) return { status: 204, data: undefined as T };

  const data = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string };

  if (!res.ok) {
    const code = (data as { error?: string }).error ?? "error";
    // For documented codes the on-brand copy WINS over the backend's blunter
    // message (e.g. 429 "Too many requests." → our warmer rate-limit line);
    // unknown codes still surface the server message, then a generic fallback.
    const serverMsg = (data as { message?: string }).message;
    const message = WARM_CODES.has(code) ? friendlyError(res.status, code) : serverMsg ?? friendlyError(res.status, code);
    throw new ApiError(res.status, code, message);
  }
  return { status: res.status, data };
}

/** Codes whose on-brand client copy should override the server's wording. */
const WARM_CODES = new Set([
  "auth_required",
  "forbidden",
  "not_found",
  "invalid_url",
  "invalid_expiry",
  "reserved_alias",
  "alias_taken",
  "unsafe_url",
  "blocked_host",
  "unresolvable_host",
  "self_referential",
  "rate_limited",
]);

/** Warm, never-blaming fallbacks when the server doesn't supply a message. */
function friendlyError(status: number, code: string): string {
  switch (code) {
    case "auth_required":
      return "Please sign in to continue.";
    case "forbidden":
      return "This link belongs to another account.";
    case "not_found":
      return "We couldn't find that link — it may have been removed.";
    case "invalid_url":
      return "That doesn't look like a valid link. Paste a full http(s) URL.";
    case "invalid_expiry":
      return "The expiry date needs to be in the future.";
    case "reserved_alias":
      return "That custom alias is reserved — try another.";
    case "alias_taken":
      return "That custom alias is already in bloom. Pick a different one.";
    case "unsafe_url":
      return "We can't shorten that destination right now — try a different link.";
    case "blocked_host":
      return "That destination isn't allowed — try a public web address.";
    case "unresolvable_host":
      return "We couldn't reach that site — double-check the address?";
    case "self_referential":
      return "That's already a Klipo link — paste the original long URL.";
    case "rate_limited":
      return "That's a few too many tries — give it a minute and try again.";
    default:
      return status >= 500 ? "Klipo hit a snag on our end. Please try again in a moment." : `Request failed (HTTP ${status}).`;
  }
}

// ---------------------------------------------------------------------------
// Types (mirror the backend route responses)
// ---------------------------------------------------------------------------

export interface LinkItem {
  code: string;
  shortUrl: string;
  longUrl: string;
  createdAt: string;
  expiresAt: string | null;
  private: boolean;
  analytics: boolean;
  clicks: number;
}

export interface LinksPage {
  links: LinkItem[];
  nextCursor: string | null;
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

export interface StatsResponse {
  code: string;
  analytics?: boolean; // false → 301 link, no analytics
  message?: string;
  totalClicks?: number;
  uniqueClicks?: number;
  byDay?: { date: string; clicks: number }[];
  topReferrers?: { referrer: string; clicks: number }[];
  byCountry?: { country: string; clicks: number }[];
  byDevice?: { device: string; clicks: number }[];
  webviewVsNative?: { webview: number; native: number };
  webviewByNetwork?: { network: string; clicks: number }[];
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export interface RequestLoginResult {
  message: string;
}

export async function requestLogin(email: string): Promise<RequestLoginResult> {
  const { data } = await request<RequestLoginResult>("/api/v1/auth/request-login", {
    method: "POST",
    body: { email },
  });
  return data;
}

export interface VerifyResult {
  token: string;
  userId: string;
  email: string;
}

/** Complete a magic-link sign-in: sets the session cookie, returns the user. */
export async function verifyToken(token: string): Promise<VerifyResult> {
  const { data } = await request<VerifyResult>("/api/v1/auth/verify", { query: { token } });
  return data;
}

export interface SessionUser {
  userId: string;
  email: string;
}

/** Current signed-in user from the session cookie (the account email lives here). */
export async function getMe(): Promise<SessionUser> {
  const { data } = await request<SessionUser>("/api/v1/auth/me");
  return data;
}

export async function logout(): Promise<void> {
  await request("/api/v1/auth/logout", { method: "POST" });
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

export async function listLinks(params: { limit?: number; cursor?: string } = {}): Promise<LinksPage> {
  const { data } = await request<LinksPage>("/api/v1/links", {
    query: { limit: params.limit ?? 50, cursor: params.cursor },
  });
  return data;
}

/** Probe the session: returns the signed-in user, or null on a real 401. */
export async function probeSession(): Promise<SessionUser | null> {
  try {
    return await getMe();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

export interface PatchLinkBody {
  longUrl?: string;
  expiresAt?: string | null;
  private?: boolean;
  analytics?: boolean;
}

export async function patchLink(code: string, body: PatchLinkBody): Promise<LinkItem> {
  // The PATCH response echoes the link's fields but not the click count.
  const { data } = await request<Omit<LinkItem, "clicks">>(`/api/v1/links/${encodeURIComponent(code)}`, {
    method: "PATCH",
    body,
  });
  return { ...data, clicks: 0 };
}

export async function deleteLink(code: string): Promise<void> {
  await request(`/api/v1/links/${encodeURIComponent(code)}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export async function getStats(code: string, range?: { from?: string; to?: string }): Promise<StatsResponse> {
  const { data } = await request<StatsResponse>(`/api/v1/links/${encodeURIComponent(code)}/stats`, {
    query: { from: range?.from, to: range?.to },
  });
  return data;
}

// ---------------------------------------------------------------------------
// Shorten
// ---------------------------------------------------------------------------

export interface ShortenBody {
  url: string;
  customAlias?: string;
  expiresAt?: string;
  private?: boolean;
  analytics?: boolean;
}

export async function shorten(body: ShortenBody): Promise<ShortenResult> {
  const { data } = await request<ShortenResult>("/api/v1/shorten", {
    method: "POST",
    body: {
      url: body.url,
      ...(body.customAlias ? { customAlias: body.customAlias } : {}),
      ...(body.expiresAt ? { expiresAt: body.expiresAt } : {}),
      private: body.private ?? false,
      analytics: body.analytics ?? true,
    },
  });
  return data;
}

// ---------------------------------------------------------------------------
// Derived helpers
// ---------------------------------------------------------------------------

export type LinkStatus = "live" | "expiring" | "expired";

/** Derive a link's lifecycle status from its expiry (expiring = within 7 days). */
export function deriveStatus(expiresAt: string | null, now: number = Date.now()): LinkStatus {
  if (!expiresAt) return "live";
  const t = new Date(expiresAt).getTime();
  if (Number.isNaN(t)) return "live";
  if (t <= now) return "expired";
  if (t - now <= 7 * 24 * 60 * 60 * 1000) return "expiring";
  return "live";
}

/** Humanized relative-time, e.g. "2d ago", "3w ago". */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const s = Math.max(0, Math.floor((now - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}
