# pg-native-shim

A drop-in for the tiny `@electric-sql/pglite` surface the SQL fixtures use (`new PGlite()`, `exec`, `query`, `close`, `error.code`), backed by a **real local PostgreSQL** through a persistent `psql` session per instance. Use it when the npm registry is unreachable but `psql` and a disposable localhost cluster exist.

```sh
# disposable cluster (never an operational server)
PGHOST=127.0.0.1 PGUSER=postgres PGLITE_DIR="$PWD/scripts/test/pg-native-shim/node_modules" \
  node scripts/test/editor-versioned-db.mjs
```

Each `PGlite` instance creates and drops its own `shim_<random>` database. Only `localhost` / `127.0.0.1` / `::1` is accepted; `PGSERVICE`, `PGSERVICEFILE` and `PGHOSTADDR` are refused.

Evidence produced with this driver is **native PostgreSQL**, not PGlite; record it that way. Differences from PGlite: parameters are inlined as dollar-quoted unknown-typed literals (server-side type inference is the same as text-protocol params); result rows come back through `json_agg`, so timestamps are ISO strings and bigints are JSON numbers.
