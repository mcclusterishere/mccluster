/* The shared front settings validator, exposed to the classic-script editors so a refused setting is named on the
   screen before the request. js/front-config.mjs is the published copy of packages/front-config/index.mjs (the
   Worker's validator); scripts/test/front-config-published-copy.test.mjs keeps the two byte-identical, so the
   browser preflight and the server check are the same code. The Worker validates again regardless. */
import { validateFront, mediaPrefix, FRONT_MAX_BYTES, FRONT_SCHEMA } from './front-config.mjs';
window.MCC_FRONT_CONFIG = { validateFront, mediaPrefix, FRONT_MAX_BYTES, FRONT_SCHEMA };
window.dispatchEvent(new CustomEvent('mcc:front-config-ready'));
