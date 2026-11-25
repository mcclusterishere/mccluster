/* Hands the vendored Chem-108 data (classic scripts that declare CHEM_DATA and CHEM_EXTRA as top-level consts) to the
   Molecule Rush module, which loads data.js, extra-data.js and then this file. */
(function (root) { "use strict"; root.CHEM108_VENDORED = { data: CHEM_DATA, extra: CHEM_EXTRA }; })(globalThis);
