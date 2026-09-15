# McCluster Communications — Beta 1

McCluster Communications is the self-hosted messaging layer for an Android phone + SIM relay. Twilio or another carrier API is not part of the Beta 1 transport path.

## Runtime path

```text
SMS sender
  -> carrier
  -> Android/SIM relay
  -> POST /v1/comms/relay/inbound
  -> comms_contacts / comms_threads / comms_messages
  -> ops_agent_jobs:sms_assistant_turn
  -> OVH McCluster Core + local model
  -> deterministic communications policy
  -> reply OR owner escalation OR ignore
  -> comms_outbox
  -> POST /v1/comms/relay/outbox/claim
  -> Android SmsManager
  -> POST /v1/comms/relay/delivery
```

Core never sends directly to a carrier. It writes durable outbox work. The relay is the transport adapter.

## Database authority

- `comms_contacts`: canonical SMS identities per organization.
- `comms_relay_devices`: enrolled Android relay identities. Only SHA-256 token hashes are stored.
- `comms_threads`: conversation mode and takeover state.
- `comms_messages`: inbound/outbound message ledger.
- `comms_outbox`: durable relay work queue.
- `comms_delivery_events`: sent/delivered/failed transport receipts.
- `comms_audit`: owner, assistant, relay, and system actions.

All tables have RLS enabled and direct `anon` / `authenticated` Data API privileges revoked. Server-controlled Worker/Core processes use the service role.

## Relay enrollment

An authenticated McCluster owner calls:

`POST /v1/comms/relay-devices`

with a label and the relay SIM phone number. The response contains `device.id` and `relay_token`. The token is returned once; only its hash is retained server-side. The Android app stores the ID/token in secure local storage and sends:

- `x-mccluster-relay-id`
- `x-mccluster-relay-token`

on relay-only requests.

## Relay API

- `POST /v1/comms/relay/inbound` — record an inbound SMS and queue a bounded assistant turn.
- `POST /v1/comms/relay/outbox/claim` — atomically claim the oldest sendable message for that relay.
- `POST /v1/comms/relay/delivery` — record `sent`, `delivered`, or `failed` state.

Inbound requests are idempotent. Self-originating relay messages are suppressed. `STOP`, `UNSUBSCRIBE`, `CANCEL`, `END`, and `QUIT` disable automation for that contact/thread.

## Assistant policy

The Core executor `sms_assistant_turn` can return only:

- `reply`
- `escalate`
- `ignore`

The first automated response is disclosed as `McCluster's assistant`. Deterministic policy escalates legal, financial, credential, identity, and medical topics before model generation. The model is additionally instructed not to impersonate McCluster or make consequential commitments.

Rate controls cap automated reply volume and enforce a minimum reply gap. On escalation, the thread is paused and an `ops_signals` owner warning is created.

## Owner takeover

Authenticated owner API:

- `GET /v1/comms/threads`
- `POST /v1/comms/threads/:threadId/takeover`
- `POST /v1/comms/threads/:threadId/release`
- `POST /v1/comms/threads/:threadId/send`

When `MCCLUSTER_OWNER_PHONE` is configured on the Worker, the same controls can be issued by SMS:

- `STATUS`
- `TAKEOVER <thread UUID>`
- `RELEASE <thread UUID>`

Takeover disables the assistant immediately. Release returns the thread to assistant mode.

## Beta activation boundary

This PR builds the complete backend contract. End-to-end carrier validation still requires an Android device with an active SIM and the companion relay app. Do not port an established phone number until temporary-number inbound/outbound/delivery testing is proven.
