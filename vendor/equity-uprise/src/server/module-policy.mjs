/** Server-loaded module policy. Browser feature flags never authorize a route. */
export function readModulePolicy(value, installationId, moduleId) {
  if (!value || value.schema !== 'equity-uprise.module-policy/v1' || value.installationId !== installationId || value.moduleId !== moduleId || !Number.isSafeInteger(value.revision) || value.revision < 0 || !['enabled', 'draining', 'disabled'].includes(value.state)) throw new TypeError('Authoritative module policy is unavailable.');
  return Object.freeze({ installationId, moduleId, revision: value.revision, state: value.state });
}
export function moduleRefusal(policy, method) {
  if (policy.state === 'disabled') return Object.freeze({ code: 'module_disabled', status: 404 });
  if (policy.state === 'draining' && !['GET', 'HEAD', 'OPTIONS'].includes(method)) return Object.freeze({ code: 'module_draining', status: 503 });
  return null;
}
