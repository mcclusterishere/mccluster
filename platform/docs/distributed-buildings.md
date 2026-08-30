# HERE distributed building backend

This deployment supports the first ten buildings with two local servers per building and allocates all 33 owned servers without making every machine a global dependency.

## Allocation

- 10 building primaries
- 10 building replicas
- 3 central control-plane nodes
- 3 central PostgreSQL nodes
- 2 observability/deployment nodes
- 2 staging nodes
- 3 powered-off cold spares
- Mac Studio M1 Max: AI inference only; never required for safety or core building operation

The authoritative allocation is `config/server-inventory.json`.

## Operating rules

1. Each building owns its operational ledger and remains usable when disconnected.
2. Only the primary node sets `NODE_ACTIVE=true`. The replica stays passive until a deliberate promotion.
3. Events enter the local PostgreSQL outbox before synchronization. Central ingestion is idempotent by event UUID and stream sequence.
4. Central commands are leased and acknowledged. The generic agent never directly executes a physical or safety-sensitive action.
5. Emergency stops, door controls and other `local_only` actions never traverse the central command plane.
6. Building databases are not joined into one global PostgreSQL database.
7. The Mac Studio may provide Qwen inference, but loss of AI must not stop orders, access, telemetry or safety controls.
8. Raw video and high-volume telemetry remain local; central services receive approved events and summaries.

## Network

Use a WireGuard or Tailscale private network. Expose only the control-plane HTTPS endpoint through the private network. PostgreSQL, node health endpoints, iDRAC and local administration must not be public. Assign unique credentials per node and rotate them after any reprovisioning.

TLS termination is required in front of the control-plane service. Node payloads are additionally signed and time-bound. Configure firewall allowlists so building nodes can reach the control-plane VIP but cannot directly reach another building's database.

## Provisioning order

1. Apply all SQL migrations to the central database with `npm run db:migrate`.
2. Run `npm run topology:provision`.
3. For each building node, set `NODE_CODE`, `NODE_KEY_ID` and a unique 32+ character `NODE_SHARED_SECRET`, then run `npm run node:credential` against the central database.
4. Install PostgreSQL locally on both building servers.
5. Configure PostgreSQL streaming replication from primary to replica over the private network.
6. Copy the appropriate environment template into `/etc/here/` with mode 0600.
7. Install and enable the systemd unit.
8. Verify `/health`, event synchronization, command leasing, internet-disconnection behavior and controlled replica promotion.

## Failover

Do not enable automatic dual-primary promotion. A network partition could otherwise create two active writers. Promotion requires confirming that the old primary is fenced or offline, promoting the replica, setting `NODE_ACTIVE=true` there, and changing the old primary to false before it rejoins.

Central control-plane nodes are stateless and may sit behind a private load balancer. The three central database nodes should use PostgreSQL replication with a documented quorum/fencing manager. Backups must also leave the building: replication is availability, not backup.

## Acceptance tests

A building is ready only when all of these pass:

- Primary failure and controlled replica promotion
- 30 minutes without internet while local events continue
- Reconnection drains the outbox without duplicate central events
- Duplicate command delivery does not repeat a physical action
- Central control-plane outage does not stop local operations
- Mac Studio/AI outage does not stop local operations
- Restore from an encrypted off-site backup
- UPS runtime and clean shutdown test
- Confirmation-required and local-only safety policies
