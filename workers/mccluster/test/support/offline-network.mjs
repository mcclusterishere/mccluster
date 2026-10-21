// Worker unit tests must provide explicit fetch doubles. A missed mock must
// never contact production, a provider, or even a deliberately invalid host.
// Loaded before each test module by npm test; tests may replace this with their
// own bounded fixture implementation and restore to this guard afterwards.
globalThis.fetch = async () => {
  throw Object.assign(new Error('Unmocked fetch blocked: Worker unit tests run offline'), {
    code: 'OFFLINE_WORKER_TEST_FETCH'
  });
};
