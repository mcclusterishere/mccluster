/* PaymentGateway — the order system never marries a checkout vendor.
   First adapter: Stripe (the offering-driven checkout the house
   already runs). Possible later: ShopifyPaymentGateway. The iron
   rule rides here: payment state changes come ONLY from verified
   server-side webhooks — a client "payment successful" message is
   never proof of payment. */

export interface CheckoutInput {
  /** the offerings ledger names the price — never the client */
  offeringSlug: string;
  quantity: number;
  userId: string;
  /** server-bounded custom amounts exist only on configured offerings
      (donation, approved invoice, booking deposit) */
  customAmountCents?: number;
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, string>;
}

export interface CheckoutSession {
  id: string;
  url: string;
  provider: string;
  expiresAt: string;
}

export type PaymentEventType =
  | "payment_succeeded"
  | "payment_failed"
  | "refund_succeeded"
  | "dispute_opened"
  | "unknown";

export interface PaymentEvent {
  id: string;                // provider event id — the idempotency key
  type: PaymentEventType;
  provider: string;
  checkoutSessionId?: string;
  amountCents?: number;
  currency?: string;
  raw: unknown;              // persisted verbatim for replay
  occurredAt: string;
}

export interface RefundInput {
  paymentId: string;
  amountCents?: number;      // omit for full refund
  reason?: string;
}

export interface RefundResult {
  id: string;
  status: "succeeded" | "pending" | "failed";
}

export interface PaymentGateway {
  readonly name: string;
  createCheckout(input: CheckoutInput): Promise<CheckoutSession>;
  /** verifies the raw-body signature; throws on mismatch */
  verifyWebhook(payload: unknown, signature: string): Promise<PaymentEvent>;
  refund(input: RefundInput): Promise<RefundResult>;
}
