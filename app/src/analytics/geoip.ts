import { createHash } from 'node:crypto';
import geoip from 'geoip-lite';
import { env } from '../env';

/**
 * Privacy-preserving IP handling + country lookup.
 *
 * Raw IPs are never stored. IPv4 is truncated to /24 and hashed with a salt
 * that rotates daily, so the same visitor's hash differs day-to-day and can't
 * be correlated across days. Country comes from the local geoip-lite DB (no
 * external calls); private/unknown IPs resolve to ''.
 */

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/;

function normalizeIp(ip: string): string {
  // Unwrap IPv4-mapped IPv6 (e.g. "::ffff:1.2.3.4").
  return ip.startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip;
}

// IPv4 → zero the last octet (/24). IPv6/unknown left as-is.
function truncateIp(ip: string): string {
  const m = IPV4_RE.exec(ip);
  return m ? `${m[1]}.${m[2]}.${m[3]}.0` : ip;
}

function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

// Daily salt = SHA-256(HASHIDS_SALT + "YYYY-MM-DD").
function dailySalt(date: Date): Buffer {
  return createHash('sha256').update(`${env.HASHIDS_SALT}${utcDateKey(date)}`).digest();
}

/** Salted SHA-256 (32 bytes) of the /24-truncated IP, using the day's salt. */
export function hashIp(ip: string, date: Date = new Date()): Buffer {
  const value = truncateIp(normalizeIp(ip ?? ''));
  return createHash('sha256').update(dailySalt(date)).update(value).digest();
}

/** 2-letter ISO country code, or '' for private/local/unknown IPs. */
export function getCountry(ip: string): string {
  const geo = geoip.lookup(normalizeIp(ip ?? ''));
  return geo?.country ?? '';
}
