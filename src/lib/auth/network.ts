/**
 * Komt een verzoek van het eigen netwerk (kassa-pc, telefoons op de wifi) of
 * van buiten (boekhouder via internet / tunnel)?
 *
 * Geen Node-imports: wordt ook in proxy.ts gebruikt.
 *
 * Op afstand zijn alleen inloggen, beheer, rapporten en export beschikbaar.
 * Kassa, telefoon en koppelen werken uitsluitend op het eigen netwerk.
 */

const PRIVATE_IPV4 = [/^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./];

export function isPrivateAddress(raw: string): boolean {
  let ip = raw.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (!ip) return false;
  if (ip === '::1' || ip === 'localhost') return true;
  if (/^fe80:/.test(ip) || /^f[cd][0-9a-f]{2}:/.test(ip)) return true;
  return PRIVATE_IPV4.some((r) => r.test(ip));
}

export function isPrivateHost(rawHost: string): boolean {
  let host = rawHost.trim().toLowerCase();
  if (host.startsWith('[')) host = host.slice(1, host.indexOf(']'));
  else host = host.replace(/:\d+$/, '');
  if (!host) return false;
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.lan') || host.endsWith('.home')) return true;
  if (!host.includes('.') && !host.includes(':')) return true; // computernaam op het netwerk, bijv. "kassa-pc"
  return isPrivateAddress(host);
}

interface HeaderLike {
  get(name: string): string | null;
}

export function isRemoteRequest(h: HeaderLike): boolean {
  // Tunnels (Tailscale Funnel, Cloudflare Tunnel) markeren hun verkeer
  if (h.get('tailscale-funnel-request') || h.get('cf-connecting-ip') || h.get('cf-ray')) return true;
  // Next.js vult x-forwarded-for met het echte adres; een tunnel zet er het internetadres van de bezoeker in
  const xff = h.get('x-forwarded-for');
  if (xff && xff.split(',').some((ip) => ip.trim() && !isPrivateAddress(ip))) return true;
  const host = h.get('x-forwarded-host') ?? h.get('host');
  if (host && !isPrivateHost(host.split(',')[0])) return true;
  return false;
}

export function isHttpsRequest(h: HeaderLike): boolean {
  return (h.get('x-forwarded-proto') ?? '').split(',')[0].trim() === 'https';
}
