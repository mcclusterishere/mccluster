// Which Stripe endpoint signed this event, and what it may therefore change.
//
// Stripe signs each webhook endpoint with its own secret. This function sits
// behind up to four endpoints:
//   platform       STRIPE_WEBHOOK_SECRET               the account's own events (and, as before, any
//                                                       connected-account event Stripe sends there)
//   platform_test  STRIPE_WEBHOOK_SECRET_TEST          the same, test mode only
//   connect        STRIPE_CONNECT_WEBHOOK_SECRET       the "connected accounts" endpoint (merch marketplace
//                                                       sellers, Client Connect orgs)
//   connect_test   STRIPE_CONNECT_WEBHOOK_SECRET_TEST  the same, test mode only
// The platform secrets are tried first, so an event the platform endpoint
// signs behaves exactly as it did before the Connect endpoint existed.
//
// A Connect-signed event speaks for a connected account and nothing else: it
// must name one (event.account), and it never reaches a platform-only effect
// (the premium plan, a music licence or its refund, a provider flag owned by
// the platform account). It may settle a marketplace order (which binds to the
// seller's stored account anyway), sync org_stripe_accounts on account.updated,
// and write the commerce ledger, which books connected-account events only to
// the org the sale named. A test secret accepts only test-mode events.
// Pure, so scripts/test/merch-marketplace.test.mjs runs it under Node.

export type Endpoint = "platform" | "platform_test" | "connect" | "connect_test";

export type EndpointPolicy = {
  accept: boolean;
  reason: string | null;
  endpoint: Endpoint | null;
  /** premium plan, music licence grant/revoke/expiry: the platform account's own sales, live endpoint only */
  platformEffects: boolean;
  /** account.updated: the providers.charges_enabled flag (a real account's state; never from a test secret) */
  accountEffects: boolean;
  /** the merch marketplace settlement and the org-scoped commerce ledger */
  marketplace: boolean;
  ledger: boolean;
};

const refuse = (reason: string): EndpointPolicy => ({
  accept: false, reason, endpoint: null, platformEffects: false, accountEffects: false, marketplace: false, ledger: false,
});

export function endpointPolicy(endpoint: Endpoint | null | undefined, event: { account?: unknown; livemode?: unknown } | null | undefined): EndpointPolicy {
  if (!endpoint || !event) return refuse("unverified");
  const test = endpoint === "platform_test" || endpoint === "connect_test";
  const connect = endpoint === "connect" || endpoint === "connect_test";
  if (test && event.livemode !== false) return refuse("test_secret_live_event");
  const account = typeof event.account === "string" && /^acct_[A-Za-z0-9]+$/.test(event.account) ? event.account : null;
  if (connect && !account) return refuse("connect_secret_without_account");
  return {
    accept: true,
    reason: null,
    endpoint,
    platformEffects: !test && !connect,
    accountEffects: !test,
    marketplace: true,
    ledger: true,
  };
}
