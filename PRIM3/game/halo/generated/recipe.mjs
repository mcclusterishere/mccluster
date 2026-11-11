/* The generated-recipe compiler is PUBLIC browser runtime: PRIM3 World and the
   reviewed-mission UI import it, and deploy-pages.yml strips all of PRIM3/ from
   the published tree (audit W1, 2026-11-09: the published artifact shipped the
   importers without this file). The one source of truth now lives at
   js/prim3-tactics/levels/recipe.mjs, which the export publishes. This shim
   keeps the private-tree path resolving for tooling and history; nothing
   published may import this path (scripts/test/published-import-closure.test.mjs). */
export * from '../../../../js/prim3-tactics/levels/recipe.mjs';
