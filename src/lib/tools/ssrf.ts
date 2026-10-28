import { lookup } from "node:dns/promises";

/** Parse an IPv4 string to octets, or null. */
export function parseIPv4(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const octets = m.slice(1).map(Number);
  return octets.every((o) => o <= 255) ? octets : null;
}

/** True for RFC1918/loopback/link-local/unspecified IPv4 and common IPv6 locals. */
export function isPrivateIp(ip: string): boolean {
  const v4 = parseIPv4(ip);
  if (v4) {
    const a = v4[0]!;
    const b = v4[1]!;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      a >= 224 // multicast/reserved
    );
  }
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fe80") || lower.startsWith("fc") || lower.startsWith("fd"))
    return true;
  // IPv4-mapped IPv6
  if (lower.startsWith("::ffff:")) return isPrivateIp(lower.slice(7));
  return false;
}

export interface SsrfCheck {
  ok: boolean;
  reason?: string;
}

type Resolver = (host: string) => Promise<{ address: string }[]>;

/**
 * https-only URL guard: no IP literals, no private hosts, DNS-resolved
 * addresses re-checked (rebinding defence). `resolver` injectable for tests.
 */
export async function guardUrl(
  rawUrl: string,
  resolver: Resolver = (h) => lookup(h, { all: true }),
): Promise<SsrfCheck> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "unparseable URL" };
  }
  if (url.protocol !== "https:") {
    return { ok: false, reason: "only https:// URLs are allowed" };
  }
  const host = url.hostname.toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    return { ok: false, reason: "local hostnames are blocked" };
  }
  if (isPrivateIp(host)) return { ok: false, reason: "private IP addresses are blocked" };
  if (parseIPv4(host)) {
    // public IPv4 literal - allow (still https)
    return { ok: true };
  }
  try {
    const addrs = await resolver(host);
    if (!addrs.length) return { ok: false, reason: "DNS resolved to nothing" };
    for (const a of addrs) {
      if (isPrivateIp(a.address)) {
        return { ok: false, reason: `DNS resolves to private address ${a.address}` };
      }
    }
  } catch {
    return { ok: false, reason: "DNS resolution failed" };
  }
  return { ok: true };
}
