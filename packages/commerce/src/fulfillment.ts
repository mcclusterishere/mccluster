/* FulfillmentProvider — Tapstitch has no assumed public API; the
   verified path is its Shopify integration, so the first live
   adapter is TapstitchViaShopifyProvider, with ManualMcClusterProvider
   (collab sets, physical inserts) and LocalEmbroideryProvider
   (finished editions) beside it. Routing:
     direct:   checkout → Tapstitch/Shopify → customer
     finished: checkout → Tapstitch → McCluster desk (embroidery, QC,
               numbering, packaging) → customer
     collab:   checkout → McCluster fulfillment → customer */

export type FulfillmentRoute = "direct" | "finished" | "collab-set";

export interface PlacementSnapshot {
  id: string;
  area: string;
  method: "dtg" | "dtf" | "embroidery" | "patch" | "screen-print" | "hand-finished";
  phrase?: string;
  artworkVersion?: string;
  productionNotes?: string;
}

/* Historical truth: every order item snapshots what was sold, at what
   cost, with which artwork. Order totals are NEVER recomputed from
   the live catalog. */
export interface OrderItemSnapshot {
  productSlug: string;
  productName: string;
  artworkVersion: string;
  placements: PlacementSnapshot[];
  size: string;
  color: string;
  baseProductionCostCents: number;
  dtgSurchargeCents: number;
  finishingFeeCents: number;     // the ~$25 local-modification fee where applicable
  packagingCostCents: number;
  shippingCostCents: number;
  retailPriceCents: number;
  route: FulfillmentRoute;
}

export interface FulfillmentOrder {
  orderId: string;
  route: FulfillmentRoute;
  items: OrderItemSnapshot[];
  shipTo: {
    name: string;
    line1: string;
    line2?: string;
    city: string;
    region: string;
    postalCode: string;
    country: string;
  };
  idempotencyKey: string;
}

export interface ProviderOrder {
  providerOrderId: string;
  provider: string;
  acceptedAt: string;
}

export type FulfillmentStatus =
  | "submitted" | "in_production" | "shipped" | "delivered"
  | "cancelled" | "failed" | "unknown";

export interface ProviderOrderStatus {
  providerOrderId: string;
  status: FulfillmentStatus;
  trackingNumber?: string;
  trackingUrl?: string;
  updatedAt: string;
}

export interface CancelResult {
  providerOrderId: string;
  cancelled: boolean;
  reason?: string;
}

export interface FulfillmentEvent {
  id: string;                // provider event id — idempotency key
  provider: string;
  providerOrderId: string;
  status: FulfillmentStatus;
  raw: unknown;
  occurredAt: string;
}

export interface FulfillmentProvider {
  readonly name: string;
  submitOrder(order: FulfillmentOrder): Promise<ProviderOrder>;
  getOrder(providerOrderId: string): Promise<ProviderOrderStatus>;
  cancelOrder(providerOrderId: string): Promise<CancelResult>;
  normalizeWebhook(payload: unknown): Promise<FulfillmentEvent>;
}
