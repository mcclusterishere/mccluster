/** Validated, public installation configuration. Never accepts credentials. */
const SCHEMA = 'equity-uprise.installation/v1';
const object = value => value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
function keys(value, allowed, label) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new TypeError(`Invalid ${label} fields.`);
}
function origin(value, allowLocalhost) {
  if (typeof value !== 'string') throw new TypeError('An explicit origin is required.');
  let url; try { url = new URL(value); } catch { throw new TypeError('Invalid origin.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(allowLocalhost && local && url.protocol === 'http:')) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new TypeError('Use a credential-free HTTPS origin, not a path or redirect URL.');
  return url.origin;
}
export function defineInstallation(input, { allowLocalhost = false } = {}) {
  keys(input, ['schema', 'id', 'appOrigin', 'apiOrigin', 'brand', 'modules'], 'installation');
  if (input.schema !== SCHEMA || typeof input.id !== 'string' || !/^[a-z][a-z0-9-]{0,62}$/.test(input.id)) throw new TypeError('Invalid installation schema or id.');
  keys(input.brand, ['name'], 'brand');
  if (typeof input.brand.name !== 'string' || !input.brand.name.trim() || input.brand.name.length > 100) throw new TypeError('A brand name is required.');
  keys(input.modules, ['environment'], 'modules');
  if (typeof input.modules.environment !== 'boolean') throw new TypeError('Explicit module configuration is required.');
  return Object.freeze({ schema: SCHEMA, id: input.id, appOrigin: origin(input.appOrigin, allowLocalhost), apiOrigin: origin(input.apiOrigin, allowLocalhost), brand: Object.freeze({ name: input.brand.name.trim() }), modules: Object.freeze({ environment: input.modules.environment }) });
}
