/* The owner check moved to js/owner-only.mjs, the one gate every owner-only page (the games and the PRIM3 learning
   management system) shares. This file re-exports it for the modules and tests that import it here. */
export { API_ORIGIN, SESSION_KEY, storedToken, checkOwner } from '../owner-only.mjs';
