/* Proposed host seam only. The local preview does not instantiate this adapter.
   The host must implement readAuthority using its existing server-verified owner
   authority, not a URL parameter, localStorage value or supplied client boolean. */
const owners = new WeakMap();
export function createFyreContext(adapter) {
  if (!adapter?.host || typeof adapter.host !== 'object') throw new TypeError('Supply the stable host identity object');
  for (const name of ['readAuthority', 'readSelection', 'onAuthorityChange', 'onSelectionChange', 'clearPrivateState']) {
    if (typeof adapter?.[name] !== 'function') throw new TypeError(`Missing host adapter: ${name}`);
  }
  const lease = Symbol('fyre-context');
  owners.set(adapter.host, lease);
  const ownsHost = () => owners.get(adapter.host) === lease;
  let epoch = 0, destroyed = false;
  const invalidate = () => { epoch++; if (ownsHost()) adapter.clearPrivateState(lease); };
  const unsubscribeAuthority = adapter.onAuthorityChange(invalidate);
  const unsubscribeSelection = adapter.onSelectionChange(invalidate);
  return Object.freeze({
    async read() {
      if (destroyed || !ownsHost()) return null;
      const snapshot = epoch;
      const before = await adapter.readAuthority();
      if (destroyed || !ownsHost() || snapshot !== epoch || before?.capability !== 'house-owner' || typeof before.principalId !== 'string' || !before.principalId || typeof before.sessionRevision !== 'string' || !before.sessionRevision) return null;
      const principalId = before.principalId, sessionRevision = before.sessionRevision;
      const selection = await adapter.readSelection();
      const contextId = typeof selection?.contextId === 'string' ? selection.contextId.slice(0,120) : null;
      const after = await adapter.readAuthority();
      if (destroyed || !ownsHost() || snapshot !== epoch || after?.capability !== 'house-owner' || after.principalId !== principalId || after.sessionRevision !== sessionRevision) return null;
      // No private assignment details, location history, event coordinates,
      // points, solution scores or impact values cross this proposed seam.
      return Object.freeze({ contextId, mode:'admin-preview', localOutcome:null });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true; invalidate();
      if (ownsHost()) owners.delete(adapter.host);
      unsubscribeAuthority?.(); unsubscribeSelection?.();
    }
  });
}
