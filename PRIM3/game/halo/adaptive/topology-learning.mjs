/* The lattice-learning runtime is PUBLIC browser runtime: the reviewed-mission UI
   (js/prim3-mission/released-app.mjs and released-learning.mjs) imports it, and
   deploy-pages.yml strips all of PRIM3/ from the published tree (audit W5, the
   defect W1 fixed for the generated-recipe compiler). The one source of truth now
   lives at js/prim3-mission/topology-learning.mjs, which the export publishes and
   the Worker imports. This shim keeps the private-tree path resolving for the
   adaptive engine beside it and for tooling; nothing published may import this
   path (scripts/test/prim3-topology-learning.test.mjs). */
export * from '../../../../js/prim3-mission/topology-learning.mjs';
