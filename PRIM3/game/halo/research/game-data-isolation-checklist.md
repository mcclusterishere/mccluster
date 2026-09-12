# Game Data Isolation Acceptance Checklist

Before PRIM3 Halo can be hosted as production game software:

- game process has no Halo Ops service credentials;
- game process has no Supabase service credential that can read unrestricted operational schemas;
- game API queries only approved `prim3_game` views/RPCs/tables;
- game runtime contains no live-flight/telemetry/CRM connectors;
- static public geography reused by the game is snapshotted/transformed into game assets where appropriate;
- cross-schema negative tests prove game identity cannot read Halo Ops records;
- logs do not contain production operational payloads or credentials;
- game and Halo Ops have independent systemd services, env files, release identifiers, health checks, and rollback procedures;
- both origins remain loopback/private and use reviewed Cloudflare/private ingress;
- shared `halo-engine` package contains renderer/interaction code only, not data clients or production secrets.
