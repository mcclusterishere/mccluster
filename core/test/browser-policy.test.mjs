// The browser executor's pure policy: the allowlist file, URL classification
// (scheme, userinfo, host, port, subdomains, IDNA), the private-address table
// (v4, v6, v4-mapped, NAT64, 6to4) and the post-DNS check with an injected
// resolver. The executor re-runs these on every request through context.route.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BROWSER_POLICY_SCHEMA, checkAddresses, checkRequest, classifyUrl, isPrivateAddress, normalizeHostEntry, parseBrowserPolicy
} from '../src/compute/browser-policy.mjs';

const policy = parseBrowserPolicy(JSON.stringify({ schema: BROWSER_POLICY_SCHEMA, allowed_hosts: ['Example.com', 'docs.example.com:8443', 'bücher.example'], allow_subdomains: false }));

test('the policy file parses to normalized hosts and says why it is unusable', () => {
  assert.equal(BROWSER_POLICY_SCHEMA, 'mccluster-browser-policy/1');
  assert.equal(policy.error, null);
  assert.equal(policy.allowSubdomains, false);
  assert.deepEqual(policy.allowed, [{ host: 'example.com', port: null }, { host: 'docs.example.com', port: 8443 }, { host: 'xn--bcher-kva.example', port: null }]);
  assert.deepEqual(parseBrowserPolicy('{not json'), { allowed: [], allowSubdomains: false, error: 'invalid_json' });
  assert.deepEqual(parseBrowserPolicy(JSON.stringify({ allowed_hosts: ['a.example'] })), { allowed: [], allowSubdomains: false, error: 'schema_mismatch' });
  assert.deepEqual(parseBrowserPolicy(JSON.stringify({ schema: 'mccluster-browser-policy/2', allowed_hosts: [] })), { allowed: [], allowSubdomains: false, error: 'schema_mismatch' });
  assert.deepEqual(parseBrowserPolicy(JSON.stringify({ schema: BROWSER_POLICY_SCHEMA, allowed_hosts: 'example.com' })), { allowed: [], allowSubdomains: false, error: 'invalid_hosts' });
  assert.deepEqual(parseBrowserPolicy(JSON.stringify({ schema: BROWSER_POLICY_SCHEMA, allowed_hosts: ['*.example.com'] })).error, 'invalid_hosts');
  assert.deepEqual(parseBrowserPolicy(JSON.stringify({ schema: BROWSER_POLICY_SCHEMA, allowed_hosts: [], allow_subdomains: 'yes' })), { allowed: [], allowSubdomains: false, error: null }, 'an empty list is a valid policy that refuses every open');
  assert.equal(parseBrowserPolicy(JSON.stringify({ schema: BROWSER_POLICY_SCHEMA, allowed_hosts: ['a.example'], allow_subdomains: true })).allowSubdomains, true);
});

test('host entries are lowercase IDNA names with an optional explicit port; userinfo, paths, wildcards and schemes are refused', () => {
  assert.deepEqual(normalizeHostEntry(' Example.COM '), { host: 'example.com', port: null });
  assert.deepEqual(normalizeHostEntry('example.com:8080'), { host: 'example.com', port: 8080 });
  assert.deepEqual(normalizeHostEntry('bücher.example'), { host: 'xn--bcher-kva.example', port: null });
  assert.deepEqual(normalizeHostEntry('example.com.'), { host: 'example.com', port: null }, 'a trailing dot is the same name');
  for (const bad of ['', 'user@example.com', 'example.com/path', '*.example.com', 'https://example.com', 'exa mple.com', 'example.com:', 'example.com:0', 'example.com:70000', 'example.com?x=1', 42, null]) {
    assert.equal(normalizeHostEntry(bad), null, `expected refusal for ${JSON.stringify(bad)}`);
  }
});

test('navigation URLs: http(s) only, about:blank allowed, userinfo refused, exact host and port rules, subdomains only when the policy says so', () => {
  assert.deepEqual(classifyUrl('https://example.com/a?b=1', policy), { ok: true, url: 'https://example.com/a?b=1', host: 'example.com', port: 443, scheme: 'https', navigation: true });
  assert.equal(classifyUrl('http://EXAMPLE.com./', policy).ok, true, 'case and the trailing dot are normalized');
  assert.equal(classifyUrl('about:blank', policy).ok, true);
  assert.equal(classifyUrl('about:blank', policy).host, null);
  assert.equal(classifyUrl('about:blank', policy, { navigation: false }).code, 'BROWSER_SCHEME_REFUSED', 'about:blank is an open, never a subresource');
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,<b>x</b>', 'blob:https://example.com/uuid', 'chrome://settings', 'ftp://example.com/', 'ws://example.com/socket', 'about:config']) {
    assert.equal(classifyUrl(url, policy).code, 'BROWSER_SCHEME_REFUSED', url);
  }
  assert.equal(classifyUrl('https://user:pw@example.com/', policy).code, 'BROWSER_URL_USERINFO');
  assert.equal(classifyUrl('https://user@example.com/', policy).code, 'BROWSER_URL_USERINFO');
  assert.equal(classifyUrl('not a url', policy).code, 'BROWSER_URL_INVALID');
  assert.equal(classifyUrl('/relative/path', policy).code, 'BROWSER_URL_INVALID');
  assert.equal(classifyUrl('https://other.example/', policy).code, 'BROWSER_HOST_NOT_ALLOWED');
  assert.equal(classifyUrl('https://www.example.com/', policy).code, 'BROWSER_HOST_NOT_ALLOWED', 'no subdomains unless allow_subdomains');
  assert.equal(classifyUrl('https://example.com:8443/', policy).code, 'BROWSER_PORT_NOT_ALLOWED', 'an entry without a port allows only the scheme default');
  assert.equal(classifyUrl('http://example.com:443/', policy).code, 'BROWSER_PORT_NOT_ALLOWED', 'http on 443 is not the http default');
  assert.equal(classifyUrl('https://docs.example.com:8443/', policy).ok, true);
  assert.equal(classifyUrl('https://docs.example.com/', policy).code, 'BROWSER_PORT_NOT_ALLOWED', 'an entry with a port allows only that port');
  assert.equal(classifyUrl('https://bücher.example/', policy).ok, true, 'IDNA matches the punycode entry');
  assert.equal(classifyUrl('https://xn--bcher-kva.example/', policy).ok, true);
  const subdomains = parseBrowserPolicy(JSON.stringify({ schema: BROWSER_POLICY_SCHEMA, allowed_hosts: ['example.com'], allow_subdomains: true }));
  assert.equal(classifyUrl('https://www.example.com/', subdomains).ok, true);
  assert.equal(classifyUrl('https://deep.www.example.com/', subdomains).ok, true);
  assert.equal(classifyUrl('https://notexample.com/', subdomains).code, 'BROWSER_HOST_NOT_ALLOWED', 'a suffix match needs the dot');
  assert.equal(classifyUrl('https://example.com.evil.example/', subdomains).code, 'BROWSER_HOST_NOT_ALLOWED');
  const empty = parseBrowserPolicy(JSON.stringify({ schema: BROWSER_POLICY_SCHEMA, allowed_hosts: [] }));
  const refused = classifyUrl('https://example.com/', empty);
  assert.equal(refused.code, 'BROWSER_POLICY_EMPTY');
  assert.match(refused.reason, /browser-policy\.json/);
  assert.equal(classifyUrl('https://example.com/', null).code, 'BROWSER_POLICY_EMPTY');
});

test('subresources: http(s) and no userinfo, but no allowlist (pages load their CDNs); the address rule still applies later', () => {
  const sub = classifyUrl('https://cdn.other.example/lib.js', policy, { navigation: false });
  assert.deepEqual(sub, { ok: true, url: 'https://cdn.other.example/lib.js', host: 'cdn.other.example', port: 443, scheme: 'https', navigation: false });
  assert.equal(classifyUrl('data:image/png;base64,AAAA', policy, { navigation: false }).code, 'BROWSER_SCHEME_REFUSED');
  assert.equal(classifyUrl('https://u:p@cdn.other.example/x', policy, { navigation: false }).code, 'BROWSER_URL_USERINFO');
  assert.equal(classifyUrl('https://cdn.other.example/x', null, { navigation: false }).ok, true, 'an empty policy does not block subresources of a page that could not have opened');
});

test('the private-address table: every v4 and v6 range in the design, embedded v4 by the v4 rule, and anything unparseable', () => {
  for (const ip of ['0.0.0.0', '0.1.2.3', '10.0.0.1', '10.255.255.255', '100.64.0.1', '100.127.255.254', '127.0.0.1', '127.255.0.9', '169.254.1.1', '172.16.0.1', '172.31.255.255', '192.168.0.1', '224.0.0.1', '239.255.255.255', '240.0.0.1', '255.255.255.255']) {
    assert.equal(isPrivateAddress(ip), true, `${ip} is private`);
  }
  for (const ip of ['192.0.2.1', '198.51.100.7', '100.63.255.255', '100.128.0.1', '172.15.255.255', '172.32.0.1', '192.167.255.255', '192.169.0.1', '203.0.113.10', '223.255.255.255']) {
    assert.equal(isPrivateAddress(ip), false, `${ip} is public`);
  }
  for (const ip of ['::', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'febf::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:10.1.2.3', '::ffff:192.168.1.1', '::ffff:7f00:1', '64:ff9b::7f00:1', '64:ff9b::10.0.0.1', '2002:7f00:1::', '2002:0a00:0001::', '::10.0.0.1', '[::1]', 'fe80::1%eth0']) {
    assert.equal(isPrivateAddress(ip), true, `${ip} is private`);
  }
  for (const ip of ['2001:db8::1', '2001:db8:1::2', '::ffff:198.51.100.7', '::ffff:c633:6407', '64:ff9b::198.51.100.7', '2002:c633:6407::', 'fec0::1', '2001:db8::c633:6407']) {
    assert.equal(isPrivateAddress(ip), false, `${ip} is public`);
  }
  for (const bad of ['', 'localhost', '999.1.1.1', '1.2.3', 'fe80:::1', null, undefined, 42]) {
    assert.equal(isPrivateAddress(bad), true, `${String(bad)} is refused as private`);
  }
});

test('checkAddresses refuses an empty answer and any private answer among several', () => {
  assert.deepEqual(checkAddresses(['198.51.100.7']), { ok: true, addresses: ['198.51.100.7'] });
  assert.deepEqual(checkAddresses([{ address: '198.51.100.7', family: 4 }, { address: '2001:db8::1', family: 6 }]).ok, true);
  assert.equal(checkAddresses([]).code, 'BROWSER_DNS_FAILED');
  assert.equal(checkAddresses(null).code, 'BROWSER_DNS_FAILED');
  const mixed = checkAddresses(['198.51.100.7', '10.0.0.5']);
  assert.equal(mixed.code, 'BROWSER_PRIVATE_ADDRESS');
  assert.doesNotMatch(mixed.reason, /10\.0\.0\.5/, 'the reason never echoes the address');
  assert.equal(checkAddresses(['::ffff:127.0.0.1']).code, 'BROWSER_PRIVATE_ADDRESS');
});

test('checkRequest composes classification, the injected resolver and the address rule; IP literals skip DNS', async () => {
  const lookups = [];
  const resolve = async (host) => {
    lookups.push(host);
    if (host === 'example.com') return [{ address: '198.51.100.7', family: 4 }];
    if (host === 'rebinder.example') return [{ address: '198.51.100.7', family: 4 }, { address: '192.168.1.10', family: 4 }];
    if (host === 'nxdomain.example') throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
    return [];
  };
  const wide = parseBrowserPolicy(JSON.stringify({ schema: BROWSER_POLICY_SCHEMA, allowed_hosts: ['example.com', 'rebinder.example', 'nxdomain.example', 'empty.example', '127.0.0.1', '[::1]', 'localhost'] }));
  const ok = await checkRequest('https://example.com/page', wide, { navigation: true, resolve });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.addresses, ['198.51.100.7']);
  assert.deepEqual(lookups, ['example.com']);
  const rebinder = await checkRequest('https://rebinder.example/', wide, { navigation: true, resolve });
  assert.equal(rebinder.code, 'BROWSER_PRIVATE_ADDRESS', 'one private answer among public ones refuses the request');
  assert.equal((await checkRequest('https://nxdomain.example/', wide, { navigation: true, resolve })).code, 'BROWSER_DNS_FAILED');
  assert.equal((await checkRequest('https://empty.example/', wide, { navigation: true, resolve })).code, 'BROWSER_DNS_FAILED');
  assert.equal((await checkRequest('http://127.0.0.1/', wide, { navigation: true, resolve })).code, 'BROWSER_PRIVATE_ADDRESS', 'an allowlisted loopback literal is still refused');
  assert.equal((await checkRequest('http://127.0.0.1:8080/', wide, { navigation: true, resolve })).code, 'BROWSER_PORT_NOT_ALLOWED', 'classification runs before the address rule');
  assert.equal((await checkRequest('http://[::1]/', wide, { navigation: true, resolve })).code, 'BROWSER_PRIVATE_ADDRESS');
  assert.equal(lookups.filter((host) => host === '127.0.0.1' || host === '[::1]').length, 0, 'IP literals never reach the resolver');
  const localhost = await checkRequest('http://localhost/', wide, { navigation: true, resolve: async () => [{ address: '127.0.0.1', family: 4 }] });
  assert.equal(localhost.code, 'BROWSER_PRIVATE_ADDRESS');
  const blank = await checkRequest('about:blank', wide, { navigation: true, resolve });
  assert.equal(blank.ok, true);
  const sub = await checkRequest('https://cdn.other.example/lib.js', wide, { navigation: false, resolve: async () => ['198.51.100.7'] });
  assert.equal(sub.ok, true, 'a public subresource host needs no allowlist entry');
  const privateSub = await checkRequest('http://192.168.1.1/admin', wide, { navigation: false, resolve });
  assert.equal(privateSub.code, 'BROWSER_PRIVATE_ADDRESS', 'a private subresource is refused without any lookup');
  const refusedFirst = await checkRequest('https://other.example/', wide, { navigation: true, resolve });
  assert.equal(refusedFirst.code, 'BROWSER_HOST_NOT_ALLOWED');
  assert.equal(lookups.includes('other.example'), false, 'a host outside the allowlist is never resolved');
  const cache = new Map();
  await checkRequest('https://example.com/a', wide, { navigation: true, resolve, cache });
  await checkRequest('https://example.com/b', wide, { navigation: false, resolve, cache });
  assert.equal(lookups.filter((host) => host === 'example.com').length, 2, 'a per-task cache answers the second request without a lookup');
});
