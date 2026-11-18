// The browser executor's policy, pure and DNS-injected: which URLs a
// navigation may open (the owner's allowlist file beside the manifest), which
// requests may leave at all (http(s), no userinfo, no private network after
// DNS), and the address table that keeps the node browser off the owner's LAN,
// loopback and link-local ranges. The executor runs checkRequest on every
// request through context.route, redirect hops included.
import dns from 'node:dns';
import net from 'node:net';

export const BROWSER_POLICY_SCHEMA = 'mccluster-browser-policy/1';
const MAX_HOSTS = 200;

function empty(error) { return { allowed: [], allowSubdomains: false, error }; }
function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function stripDot(host) { return String(host || '').replace(/\.+$/, ''); }
function refused(code, reason, extra = {}) { return { ok: false, code, reason, ...extra }; }

// "example.com", "docs.example.com:8443", an IDNA name (stored as punycode) or
// an IP literal; anything with a scheme, userinfo, path, query, wildcard or
// whitespace is not a host entry.
export function normalizeHostEntry(entry) {
  if (typeof entry !== 'string') return null;
  const raw = entry.trim().toLowerCase();
  if (!raw || /[\s@/\\*?#]/.test(raw) || raw.endsWith(':')) return null;
  let url;
  try { url = new URL(`http://${raw}`); } catch { return null; }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || !url.hostname) return null;
  if (/:\d+$/.test(raw) && !url.port) return null; // ":0" and out-of-range ports parse to no port
  const port = url.port ? Number(url.port) : null;
  if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535)) return null;
  return { host: stripDot(url.hostname), port };
}

export function parseBrowserPolicy(text) {
  let parsed;
  try { parsed = JSON.parse(String(text ?? '')); } catch { return empty('invalid_json'); }
  if (!record(parsed) || parsed.schema !== BROWSER_POLICY_SCHEMA) return empty('schema_mismatch');
  if (!Array.isArray(parsed.allowed_hosts) || parsed.allowed_hosts.length > MAX_HOSTS) return empty('invalid_hosts');
  const allowed = [];
  for (const entry of parsed.allowed_hosts) {
    const normalized = normalizeHostEntry(entry);
    if (!normalized) return empty('invalid_hosts');
    allowed.push(normalized);
  }
  return { allowed, allowSubdomains: parsed.allow_subdomains === true, error: null };
}

function defaultPort(scheme) { return scheme === 'https' ? 443 : 80; }

// navigation: true for every frame navigation and redirect hop (allowlisted
// host and port); false for subresources (http(s) and no userinfo only, so
// the pages the owner allowed can load their CDNs; the address rule below
// still applies to them).
export function classifyUrl(urlString, policy, { navigation = true } = {}) {
  let url;
  try { url = new URL(String(urlString)); } catch { return refused('BROWSER_URL_INVALID', 'not an absolute URL'); }
  if (url.protocol === 'about:') {
    if (navigation && url.href === 'about:blank') return { ok: true, url: 'about:blank', host: null, port: null, scheme: 'about', navigation };
    return refused('BROWSER_SCHEME_REFUSED', 'about: pages other than about:blank are refused');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return refused('BROWSER_SCHEME_REFUSED', `${url.protocol} URLs are refused; only http and https may open`);
  if (url.username || url.password) return refused('BROWSER_URL_USERINFO', 'credentials in a URL are refused');
  const host = stripDot(url.hostname.toLowerCase());
  if (!host) return refused('BROWSER_URL_INVALID', 'the URL has no host');
  const scheme = url.protocol.slice(0, -1);
  const port = url.port ? Number(url.port) : defaultPort(scheme);
  const result = { ok: true, url: url.href, host, port, scheme, navigation };
  if (!navigation) return result;
  if (!policy || !Array.isArray(policy.allowed) || !policy.allowed.length) {
    return refused('BROWSER_POLICY_EMPTY', 'allowed_hosts is empty, so every open is refused; edit browser-policy.json beside the node manifest to allow sites');
  }
  const matches = policy.allowed.filter((entry) => entry.host === host || (policy.allowSubdomains === true && host.endsWith(`.${entry.host}`)));
  if (!matches.length) return refused('BROWSER_HOST_NOT_ALLOWED', `${host} is not in allowed_hosts`);
  const portAllowed = matches.some((entry) => (entry.port === null ? port === defaultPort(scheme) : entry.port === port));
  if (!portAllowed) return refused('BROWSER_PORT_NOT_ALLOWED', `port ${port} is not allowed for ${host}`);
  return result;
}

function privateV4(octets) {
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a >= 224) return true; // 224/4 multicast, 240/4 reserved, 255.255.255.255
  return false;
}

function v4Octets(value) {
  const parts = String(value).split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
  return octets.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? octets : null;
}

// 16 bytes from any textual IPv6 form Node accepts (with :: and an embedded
// dotted v4 tail); null when it does not parse.
function v6Bytes(value) {
  let text = String(value);
  let v4 = null;
  const dotted = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (dotted) {
    v4 = v4Octets(dotted[2]);
    if (!v4) return null;
    text = `${dotted[1]}0:0`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/i.test(group))) return null;
  const words = groups.map((group) => parseInt(group, 16));
  if (v4) { words[6] = (v4[0] << 8) | v4[1]; words[7] = (v4[2] << 8) | v4[3]; }
  const bytes = [];
  for (const word of words) bytes.push(word >> 8, word & 0xff);
  return bytes;
}

function allZero(bytes, from, to) {
  for (let i = from; i < to; i += 1) if (bytes[i] !== 0) return false;
  return true;
}

function privateV6(bytes) {
  if (allZero(bytes, 0, 16)) return true; // ::
  if (allZero(bytes, 0, 15) && bytes[15] === 1) return true; // ::1
  if ((bytes[0] & 0xfe) === 0xfc) return true; // fc00::/7
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true; // fe80::/10
  if (bytes[0] === 0xff) return true; // ff00::/8
  if (allZero(bytes, 0, 10) && bytes[10] === 0xff && bytes[11] === 0xff) return privateV4(bytes.slice(12)); // ::ffff:a.b.c.d
  if (allZero(bytes, 0, 12)) return privateV4(bytes.slice(12)); // ::a.b.c.d (deprecated v4-compatible)
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b && allZero(bytes, 4, 12)) return privateV4(bytes.slice(12)); // 64:ff9b::/96 NAT64
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return privateV4(bytes.slice(2, 6)); // 2002::/16 6to4
  return false;
}

// True for every address the node browser must never reach, and for anything
// that is not an address at all.
export function isPrivateAddress(ip) {
  if (typeof ip !== 'string') return true;
  const value = ip.trim().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  if (!value) return true;
  if (net.isIPv4(value)) {
    const octets = v4Octets(value);
    return octets ? privateV4(octets) : true;
  }
  if (net.isIPv6(value)) {
    const bytes = v6Bytes(value);
    return bytes ? privateV6(bytes) : true;
  }
  return true;
}

export function checkAddresses(list) {
  const addresses = (Array.isArray(list) ? list : [])
    .map((item) => (typeof item === 'string' ? item : item?.address))
    .filter((item) => typeof item === 'string' && item);
  if (!addresses.length) return refused('BROWSER_DNS_FAILED', 'the name resolved to no address');
  if (addresses.some(isPrivateAddress)) return refused('BROWSER_PRIVATE_ADDRESS', 'the name resolves to a private, loopback, link-local or special address; the node browser never reaches those');
  return { ok: true, addresses };
}

function ipLiteral(host) {
  const bare = String(host || '').replace(/^\[|\]$/g, '');
  return net.isIP(bare) ? bare : null;
}

const defaultResolve = (host, options) => dns.promises.lookup(host, options);

// classifyUrl, then the resolver (dns.lookup all:true by default, injected in
// tests), then checkAddresses on every answer. An IP-literal host skips DNS.
// `cache` (a Map) lets one task answer repeated hosts without a new lookup.
export async function checkRequest(urlString, policy, { navigation = true, resolve = defaultResolve, cache = null } = {}) {
  const classified = classifyUrl(urlString, policy, { navigation });
  if (!classified.ok) return classified;
  if (classified.scheme === 'about') return { ...classified, addresses: [] };
  const literal = ipLiteral(classified.host);
  if (literal) {
    const check = checkAddresses([literal]);
    return check.ok ? { ...classified, addresses: check.addresses } : { ...check, url: classified.url, host: classified.host };
  }
  let answers;
  try {
    if (cache?.has(classified.host)) answers = cache.get(classified.host);
    else {
      answers = await resolve(classified.host, { all: true });
      cache?.set(classified.host, answers);
    }
  } catch (error) {
    return refused('BROWSER_DNS_FAILED', `DNS lookup failed (${String(error?.code || error?.message || error).slice(0, 80)})`, { url: classified.url, host: classified.host });
  }
  const check = checkAddresses(answers);
  return check.ok ? { ...classified, addresses: check.addresses } : { ...check, url: classified.url, host: classified.host };
}
