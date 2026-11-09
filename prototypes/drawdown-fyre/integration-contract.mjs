/* Proposed host seam only. The local preview does not instantiate this adapter.
   The host must implement readAuthority using its existing server-verified owner
   authority, not a URL parameter, localStorage value or supplied client boolean. */
export function createFyreContext(adapter) {
  for (const name of ['readAuthority', 'readSelection', 'onAuthorityChange', 'onSelectionChange', 'clearPrivateState']) {
    if (typeof adapter?.[name] !== 'function') throw new TypeError(`Missing host adapter: ${name}`);
  }
  let epoch = 0, destroyed = false;
  const invalidate = () => { epoch++; adapter.clearPrivateState(); };
  const unsubscribeAuthority = adapter.onAuthorityChange(invalidate);
  const unsubscribeSelection = adapter.onSelectionChange(invalidate);
  return Object.freeze({
    async read() {
      if (destroyed) return null;
      const snapshot = epoch;
      const before = await adapter.readAuthority();
      if (destroyed || snapshot !== epoch || before?.capability !== 'house-owner' || !before.principalId) return null;
      const selection = await adapter.readSelection();
      const after = await adapter.readAuthority();
      if (destroyed || snapshot !== epoch || after?.capability !== 'house-owner' || after.principalId !== before.principalId) return null;
      // No private assignment details, location history, event coordinates,
      // points, solution scores or impact values cross this proposed seam.
      return Object.freeze({ contextId: typeof selection?.contextId === 'string' ? selection.contextId.slice(0,120) : null, mode:'admin-preview', localOutcome:null });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true; invalidate();
      unsubscribeAuthority?.(); unsubscribeSelection?.();
    }
  });
}
