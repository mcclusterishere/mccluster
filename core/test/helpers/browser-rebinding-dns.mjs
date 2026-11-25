// Test only, loaded into the browser executor child with `node --import`: a
// DNS server that rebinds. Each name listed in MCCLUSTER_TEST_REBIND_NAMES
// answers the public documentation address 203.0.113.10 on its first lookup
// in this process and the loopback address 127.0.0.2 on every later lookup,
// which is what an attacker's zero-TTL record does to a resolver that is asked
// twice. Every other name goes to the real resolver. Both node:dns entry points
// are replaced (dns.lookup and dns.promises.lookup), so any code in the
// process that resolves a listed name, Playwright included, sees the sequence.
import dns from 'node:dns';

const FIRST = '203.0.113.10';
const LATER = '127.0.0.2';
const names = new Set(String(process.env.MCCLUSTER_TEST_REBIND_NAMES || '').split(',').map((name) => name.trim().toLowerCase()).filter(Boolean));
const seen = new Map();

function answer(hostname, options) {
  const key = String(hostname || '').toLowerCase().replace(/\.+$/, '');
  const count = seen.get(key) || 0;
  seen.set(key, count + 1);
  const address = count === 0 ? FIRST : LATER;
  const family = typeof options === 'number' ? options : Number(options?.family || 0);
  return family === 6 ? [] : [{ address, family: 4 }];
}

function listed(hostname) {
  return names.has(String(hostname || '').toLowerCase().replace(/\.+$/, ''));
}

function notFound(hostname) {
  return Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND', hostname });
}

if (names.size) {
  const promisesLookup = dns.promises.lookup.bind(dns.promises);
  dns.promises.lookup = async (hostname, options) => {
    if (!listed(hostname)) return promisesLookup(hostname, options);
    const answers = answer(hostname, options);
    if (!answers.length) throw notFound(hostname);
    return (typeof options === 'object' && options?.all) ? answers : answers[0];
  };
  const callbackLookup = dns.lookup.bind(dns);
  dns.lookup = (hostname, options, callback) => {
    const done = typeof options === 'function' ? options : callback;
    const opts = typeof options === 'function' ? {} : options;
    if (!listed(hostname)) return callbackLookup(hostname, opts, done);
    const answers = answer(hostname, opts);
    process.nextTick(() => {
      if (!answers.length) return done(notFound(hostname));
      if (typeof opts === 'object' && opts?.all) return done(null, answers);
      return done(null, answers[0].address, answers[0].family);
    });
    return undefined;
  };
}
