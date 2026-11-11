// Separate authored mission; shared tactical/network action engine.
export {createSharedRun as createRun,act,movePreview,outcome,active,report} from './network-simulation.mjs';
export const SAVE_KEY='here.prim3.shared-fate.client.v1';

import {restoreSession} from './network-simulation.mjs';
export function restoreRun(text){const r=restoreSession(text);if(r.schema!=='prim3.shared-fate/v1')throw Error('Different mission save');return r;}
