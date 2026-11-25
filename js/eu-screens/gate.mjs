/* One owner-gate implementation for games, labs and screen apps. Keep the server-owned permission check,
   token-bound decisions, revocation and page-cache handling in owner-only.mjs, not a second auth system. */
import { guardPage } from '../owner-only.mjs';
export { API_ORIGIN, SESSION_KEY, storedToken, checkOwner } from '../owner-only.mjs';

export function whenOwner({ doc = globalThis.document, win = globalThis, check } = {}) {
  return new Promise((resolve, reject) => {
    const finish = () => {
      if (win.__mccOwnerGate && doc.documentElement.dataset.ownerAccess === 'open') {
        win.removeEventListener('mcc:owner-open', finish);
        resolve();
      }
    };
    win.addEventListener('mcc:owner-open', finish);
    const gate = doc.querySelector('section[data-owner-gate]');
    if (!gate) {
      if (win.__mccOwnerGate && doc.documentElement.dataset.ownerAccess === 'open') finish();
      else { win.removeEventListener('mcc:owner-open', finish); reject(new Error('Owner gate is missing; application stays closed.')); }
      return;
    }
    if (!win.__mccOwnerGate) {
      win.__mccOwnerGate = true;
      void guardPage(gate, { doc, win, ...(check ? {check} : {}) });
    }
  });
}
