// Direct sales of Matthew McCluster's own recordings (music_direct_*).
//
// Pure: no Deno, no npm. music-direct-checkout, music-direct-access and
// stripe-webhook import it, and scripts/test/music-direct-sales.test.mjs runs
// it under Node's TypeScript stripping.
//
// A direct sale is charged on the PLATFORM account, at the price on the
// server's offer row, for one catalogue recording (public.music_catalog_objects).
// What the buyer gets is an entitlement token (a server-random uuid) that
// downloads the full-quality file a limited number of times inside a window.
// The database is the last word on all of it (supabase/migrations/20261031180839_music_direct_sales_v1.sql):
// these functions only decide early and say why.
import { checkoutBindingFailure, type CheckoutSessionLike } from "./checkout-binding.ts";

export const MUSIC_DIRECT_KIND = "music_direct_sale";
/** Order states a payment may still complete (a failed attempt can be retried inside the same session). */
export const MUSIC_DIRECT_PAYABLE = ["pending", "failed"];

/** Owner-visible defaults; the offer row carries the values actually used. */
export const DIRECT_DEFAULTS = {
  /** downloads per purchase */
  maxDownloads: 5,
  /** days from purchase in which those downloads can be used */
  downloadWindowDays: 30,
  /** a signed download URL lives this long */
  signedUrlSeconds: 300,
  /** hours after payment in which the checkout session id still reveals the download token */
  tokenRevealHours: 24,
};
export const PRICE_MIN_CENTS = 50;
export const PRICE_MAX_CENTS = 50000;
export const MAX_DOWNLOADS_RANGE = [1, 50] as const;
export const WINDOW_DAYS_RANGE = [1, 365] as const;
/** The private bucket and prefix every full-quality file lives under (never public, service role only). */
export const DIRECT_BUCKET = "mcc-gated-audio";
export const DIRECT_PREFIX = "direct-sales/";
export const DIRECT_AUDIO_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  flac: "audio/flac",
};

/**
 * The format a buyer actually receives: the private file's extension, delivered
 * unconverted. Every label (Stripe line item, Buy button, purchase page, owner
 * desk) says this, never a blanket "MP3". null when the path is not a sellable file.
 */
export function audioFormatOf(path: string | null | undefined): string | null {
  const ext = (String(path || "").match(/\.([a-z0-9]{2,5})$/i)?.[1] || "").toLowerCase();
  return DIRECT_AUDIO_TYPES[ext] ? ext : null;
}
export function formatLabel(format: string | null | undefined): string {
  const f = String(format || "").toLowerCase();
  return DIRECT_AUDIO_TYPES[f] ? f.toUpperCase() : "Audio";
}

/** Matthew's property: the only origin that may call these functions from a browser. */
export const SITE = "https://matthew.mccluster.org";
export const ALLOWED_ORIGINS = [SITE];
export function corsHeaders(origin: string | null | undefined, allowAuthorization = false): Record<string, string> {
  const o = origin && ALLOWED_ORIGINS.includes(origin) ? origin : SITE;
  return {
    "Access-Control-Allow-Origin": o,
    "Vary": "Origin",
    "Access-Control-Allow-Headers": allowAuthorization ? "authorization, apikey, content-type" : "apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

export const CATALOG_KEY_RE = /^[a-z0-9-]+:[a-z0-9-]+$/;
export const OFFER_KEY_RE = /^[a-z0-9][a-z0-9-]{2,79}$/;
export const SESSION_ID_RE = /^cs_(?:test|live)_[A-Za-z0-9]+$/;
export const TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One offer per catalogue recording; the key is derived, never chosen. */
export function offerKeyFor(catalogKey: string): string | null {
  if (!CATALOG_KEY_RE.test(String(catalogKey || ""))) return null;
  const key = catalogKey.replace(":", "--");
  return OFFER_KEY_RE.test(key) ? key : null;
}

/** The album page's join: album slug + slugified title, as public.music_catalog_objects keys them. */
export function catalogKeyOf(albumSlug: string, title: string): string {
  const slug = (s: string) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug(albumSlug) + ":" + slug(title);
}

export function priceProblem(cents: unknown): string | null {
  if (!Number.isSafeInteger(cents)) return "price must be whole cents";
  if ((cents as number) < PRICE_MIN_CENTS) return `price must be at least ${PRICE_MIN_CENTS} cents`;
  if ((cents as number) > PRICE_MAX_CENTS) return `price must be at most ${PRICE_MAX_CENTS} cents`;
  return null;
}

/** A full-quality file path the owner may attach: our private prefix, an audio type, no traversal. */
export function assetPathProblem(bucket: unknown, path: unknown): string | null {
  if (bucket !== DIRECT_BUCKET) return "files live in the private direct-sales bucket only";
  const p = String(path || "");
  if (!p.startsWith(DIRECT_PREFIX) || p.includes("..") || p.includes("//") || !/^[a-z0-9][a-z0-9/._-]*$/i.test(p)) return "invalid file path";
  const ext = (p.match(/\.([a-z0-9]{2,5})$/i)?.[1] || "").toLowerCase();
  if (!DIRECT_AUDIO_TYPES[ext]) return "unsupported audio type";
  return null;
}

/** The private path a new upload gets: per recording, a fresh uuid, never overwriting. */
export function directUploadPath(catalogKey: string, fileName: string, uuid: string): string | null {
  if (!CATALOG_KEY_RE.test(catalogKey)) return null;
  const clean = String(fileName || "").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-.]+|-+$/g, "").slice(0, 120);
  const ext = (clean.match(/\.([a-z0-9]{2,5})$/)?.[1] || "");
  if (!clean || !DIRECT_AUDIO_TYPES[ext]) return null;
  const [album, track] = catalogKey.split(":");
  return `${DIRECT_PREFIX}${album}/${track}/${uuid}-${clean}`;
}

export function downloadNameFor(title: string, path: string): string {
  const ext = (String(path).match(/\.([a-z0-9]{2,5})$/i)?.[1] || "mp3").toLowerCase();
  const base = String(title || "track").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 150) || "track";
  return `McCluster - ${base}.${ext}`;
}

export type DirectOffer = {
  offer_key: string;
  active: boolean;
  price_cents: number;
  currency: string;
  sale_starts_at?: string | null;
  sale_ends_at?: string | null;
};
/** Is the offer on sale right now? null = yes, otherwise why not. */
export function offerSaleRefusal(offer: DirectOffer | null | undefined, now = new Date()): string | null {
  if (!offer) return "offer_unavailable";
  if (!offer.active) return "offer_unavailable";
  if (offer.sale_starts_at && new Date(offer.sale_starts_at).getTime() > now.getTime()) return "sale_not_started";
  if (offer.sale_ends_at && new Date(offer.sale_ends_at).getTime() <= now.getTime()) return "sale_ended";
  if (priceProblem(offer.price_cents)) return "offer_price_unavailable";
  if (!/^[a-z]{3}$/.test(String(offer.currency || ""))) return "offer_currency_unavailable";
  return null;
}

export type DirectOrderRow = {
  id: string;
  offer_key: string;
  stripe_checkout_session_id: string | null;
  amount_cents: number;
  currency: string;
  status: string;
  paid_at?: string | null;
};
export type DirectSession = CheckoutSessionLike & { metadata?: Record<string, string> | null };

/**
 * May this Checkout Session pay this direct-sale order? null = yes.
 *
 * The order is found by the SESSION ID the server stored when it created the
 * session (or, in the webhook, by the metadata pointer and then re-bound to
 * the stored session). Metadata is a pointer, never proof: the platform
 * account only (an event from a connected account never fulfils one), the
 * session must be the order's stored session, amount_total and currency must
 * equal the order's, it must be a paid payment-mode session, and the order
 * must still be payable (or already paid under this same session, which
 * makes a replay a no-op rather than an error).
 */
export function directFulfilmentRefusal(
  session: DirectSession | null | undefined,
  event: { account?: string | null } | null | undefined,
  order: DirectOrderRow | null | undefined,
): string | null {
  if (!order) return "order_not_found";
  if (!session || session.metadata?.kind !== MUSIC_DIRECT_KIND) return "not_a_direct_sale";
  if (session.metadata?.music_direct_order_id && session.metadata.music_direct_order_id !== order.id) return "order_mismatch";
  if (session.metadata?.music_direct_offer_key && session.metadata.music_direct_offer_key !== order.offer_key) return "offer_mismatch";
  const binding = checkoutBindingFailure(session, {
    sessionId: order.stripe_checkout_session_id,
    amountCents: Number(order.amount_cents),
    currency: order.currency,
    account: null,
  }, typeof event?.account === "string" ? event.account : null);
  if (binding) return binding;
  if (order.status !== "paid" && !MUSIC_DIRECT_PAYABLE.includes(order.status)) return "order_not_payable";
  return null;
}

export type DirectEntitlementRow = {
  revoked_at?: string | null;
  download_count: number;
  max_downloads: number;
  expires_at: string | null;
};
/**
 * May this entitlement download now? null = yes. Mirrors
 * public.music_direct_claim_download(), which decides under a row lock and
 * counts the download in the same statement; this copy answers the purchase
 * page's status without counting.
 */
export function downloadRefusal(
  ent: DirectEntitlementRow | null | undefined,
  orderStatus: string | null | undefined,
  now = new Date(),
): string | null {
  if (!ent) return "not_found";
  if (ent.revoked_at) return "revoked";
  if (orderStatus !== "paid") return "not_paid";
  if (!ent.expires_at || new Date(ent.expires_at).getTime() <= now.getTime()) return "expired";
  if (!Number.isSafeInteger(ent.max_downloads) || ent.download_count >= ent.max_downloads) return "download_limit";
  return null;
}

/** The checkout session id stops revealing the token this long after payment; the token link is what the buyer keeps. */
export function tokenRevealAllowed(paidAt: string | null | undefined, now = new Date()): boolean {
  if (!paidAt) return false;
  const t = new Date(paidAt).getTime();
  return Number.isFinite(t) && now.getTime() - t <= DIRECT_DEFAULTS.tokenRevealHours * 3600 * 1000;
}

/** HTTP status and buyer-facing words for each refusal. */
export const REFUSAL_HTTP: Record<string, { status: number; message: string }> = {
  not_found: { status: 404, message: "That download link is not recognised." },
  revoked: { status: 403, message: "This purchase was refunded or revoked, so the download is closed." },
  not_paid: { status: 409, message: "The payment for this purchase is not complete." },
  expired: { status: 410, message: "This download window has closed." },
  download_limit: { status: 429, message: "This purchase has used all of its downloads." },
};
