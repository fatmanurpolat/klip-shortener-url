import * as ipaddr from 'ipaddr.js';

/**
 * Coarse IP prefix for abuse tracking / quotas: the first 3 octets of an IPv4
 * (/24) and the /48 of an IPv6. Coarse enough that one NAT or household shares a
 * bucket, specific enough to throttle a single source. Returns '' for input that
 * can't be parsed (callers treat '' as "no prefix" — quota then can't be keyed).
 *
 * Feed it the PROXY-ATTESTED client IP (security/rateLimit.getClientIp), never the
 * raw left-most X-Forwarded-For, so a spoofed header can't dodge the quota.
 */
export function ipPrefix(ip: string): string {
  try {
    if (!ipaddr.isValid(ip)) return '';
    let addr = ipaddr.parse(ip);
    if (addr instanceof ipaddr.IPv6 && addr.isIPv4MappedAddress()) {
      addr = addr.toIPv4Address();
    }
    if (addr.kind() === 'ipv4') {
      const o = (addr as ipaddr.IPv4).octets;
      return `${o[0]}.${o[1]}.${o[2]}.0/24`;
    }
    const net = ipaddr.IPv6.networkAddressFromCIDR(`${addr.toNormalizedString()}/48`);
    return `${net.toNormalizedString()}/48`;
  } catch {
    return '';
  }
}
