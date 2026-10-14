// Fetch a document URL safely: http(s) only, no private/internal addresses (also after redirects), size and time limits.
import dns from 'node:dns/promises';
import net from 'node:net';

export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l.startsWith('::ffff:')) return isPrivateIp(l.slice(7));
    return l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe8') || l.startsWith('fe9') || l.startsWith('fea') || l.startsWith('feb');
  }
  return true;
}

export async function assertPublicUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error('Invalid URL'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http(s) URLs are supported');
  if (u.username || u.password) throw new Error('URLs with credentials are not supported');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => { throw new Error(`Cannot resolve host ${host}`); });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error('This address is not publicly reachable (blocked for safety)');
  return u;
}

export async function fetchDocument(rawUrl, { maxBytes = 50 * 1024 * 1024, timeoutMs = 60000, userAgent = 'document-to-markdown (Apify Actor)' } = {}) {
  let url = rawUrl;
  for (let hop = 0; hop < 5; hop++) {
    const u = await assertPublicUrl(url);
    const res = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': userAgent, accept: '*/*' } });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { url = new URL(res.headers.get('location'), u).href; continue; }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > maxBytes) throw new Error(`File is larger than the limit (${Math.round(maxBytes / 1048576)} MB)`);
    const chunks = []; let size = 0;
    for await (const c of res.body) { size += c.length; if (size > maxBytes) throw new Error(`File is larger than the limit (${Math.round(maxBytes / 1048576)} MB)`); chunks.push(c); }
    return { bytes: Buffer.concat(chunks), contentType: res.headers.get('content-type') ?? '', finalUrl: u.href, disposition: res.headers.get('content-disposition') ?? '' };
  }
  throw new Error('Too many redirects');
}
