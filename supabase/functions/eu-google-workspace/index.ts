// Google Workspace bridge for the Policy OS.
// Gmail remains a transport/replica. Relevant threads are normalized into
// eu_communications and drive stakeholder stages/events automatically.
import { cors, db, emitEvent, json, orgBySlug, safeEmail, safeText } from "../_shared/eu-policy-os.ts";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const INTERNAL_SECRET = Deno.env.get("EU_GOOGLE_WORKSPACE_SECRET") ?? "";

async function accessToken() {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";
  const refreshToken = Deno.env.get("GOOGLE_REFRESH_TOKEN") ?? "";
  if (!clientId || !clientSecret || !refreshToken) throw new Error("Google OAuth not configured");
  const q = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" });
  const r = await fetch(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: q });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error(`google token ${r.status}`);
  return String(j.access_token);
}

async function gmail(path: string, init: RequestInit = {}) {
  const token = await accessToken();
  const headers = new Headers(init.headers ?? {}); headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const r = await fetch(`${GMAIL}${path}`, { ...init, headers });
  const text = await r.text();
  if (!r.ok) throw new Error(`gmail ${r.status}: ${text.slice(0,800)}`);
  return text ? JSON.parse(text) : null;
}

async function integration(orgId: string) {
  const rows = await db(`eu_integrations?org_id=eq.${orgId}&provider=eq.google-gmail&label=eq.primary&select=*&limit=1`);
  if (rows?.length) return rows[0];
  const made = await db("eu_integrations", { method: "POST", body: JSON.stringify({
    org_id: orgId, provider: "google-gmail", integration_class: "mail", label: "primary",
    account_label: "matthew@mccluster.org", credential_mode: "function-secret",
    token_env: "GOOGLE_REFRESH_TOKEN", scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    capabilities: { watch: true, history: true, read: true }, status: "pending", config: {},
  }) });
  return made[0];
}

async function renewWatch(orgId: string) {
  const topicName = Deno.env.get("GMAIL_PUBSUB_TOPIC") ?? "";
  if (!topicName) throw new Error("GMAIL_PUBSUB_TOPIC missing");
  const result = await gmail("/watch", { method: "POST", body: JSON.stringify({ topicName }) });
  const i = await integration(orgId);
  const config = { ...(i.config || {}), history_id: String(result.historyId || ""), watch_expiration_ms: String(result.expiration || "") };
  await db(`eu_integrations?id=eq.${i.id}`, { method: "PATCH", body: JSON.stringify({ status: "connected", config, last_ok_at: new Date().toISOString(), last_sync_at: new Date().toISOString(), last_error: "" }) });
  await emitEvent({ orgId, eventType: "mail.watch.renewed", entityType: "eu_integrations", entityId: i.id, sourceSystem: "gmail", sourceId: String(result.historyId || ""), data: { expiration: result.expiration } });
  return result;
}

function decode64url(s: string) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  try { return new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))); } catch { return ""; }
}

function header(msg: any, name: string) {
  return String((msg.payload?.headers ?? []).find((h: any) => String(h.name).toLowerCase() === name.toLowerCase())?.value ?? "");
}
function emails(s: string) {
  const found = s.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  return [...new Set(found.map((e) => e.toLowerCase()))];
}
function bodyText(part: any): string {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body?.data) return decode64url(part.body.data);
  const children = Array.isArray(part.parts) ? part.parts : [];
  for (const c of children) { const v = bodyText(c); if (v) return v; }
  if (part.mimeType === "text/html" && part.body?.data) return decode64url(part.body.data).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  return "";
}

async function relationshipByEmail(orgId: string, addresses: string[]) {
  for (const email of addresses) {
    const people = await db(`eu_stakeholders?org_id=eq.${orgId}&email=ilike.${encodeURIComponent(email)}&select=id,email&limit=1`);
    if (!people?.length) continue;
    const links = await db(`eu_stakeholder_links?stakeholder_id=eq.${people[0].id}&select=id,initiative_id,stage,stage_source&order=updated_at.desc&limit=1`);
    if (links?.length) return { stakeholder: people[0], link: links[0] };
  }
  return null;
}

async function normalizeMessage(orgId: string, messageId: string) {
  const msg = await gmail(`/messages/${encodeURIComponent(messageId)}?format=full`);
  const labels: string[] = msg.labelIds ?? [];
  const direction = labels.includes("SENT") ? "out" : "in";
  const from = emails(header(msg, "From"));
  const to = [...emails(header(msg, "To")), ...emails(header(msg, "Cc"))];
  const house = (Deno.env.get("GMAIL_ACCOUNT_EMAIL") || "matthew@mccluster.org").toLowerCase();
  const external = (direction === "in" ? from : to).filter((e) => e !== house);

  const existingThread = await db(`eu_communications?org_id=eq.${orgId}&provider=eq.gmail&external_thread_id=eq.${encodeURIComponent(msg.threadId)}&select=initiative_id,stakeholder_id,stakeholder_link_id&order=occurred_at.desc&limit=1`);
  let rel: any = null;
  if (!existingThread?.length) rel = await relationshipByEmail(orgId, external);
  const initiativeId = existingThread?.[0]?.initiative_id ?? rel?.link?.initiative_id ?? null;
  const stakeholderId = existingThread?.[0]?.stakeholder_id ?? rel?.stakeholder?.id ?? null;
  const linkId = existingThread?.[0]?.stakeholder_link_id ?? rel?.link?.id ?? null;

  // Keep the Policy OS narrow: unrelated personal mail stays in Gmail/the generic inbox.
  if (!initiativeId && !stakeholderId) return { relevant: false, id: messageId };
  const subject = header(msg, "Subject");
  const text = bodyText(msg.payload).slice(0, 10000);
  const occurredAt = new Date(Number(msg.internalDate || Date.now())).toISOString();
  await db("eu_communications", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify({
    org_id: orgId, initiative_id: initiativeId, stakeholder_id: stakeholderId, stakeholder_link_id: linkId,
    channel: "email", provider: "gmail", direction, external_thread_id: msg.threadId, external_message_id: msg.id,
    from_address: from[0] || "", to_addresses: to, subject: safeText(subject, 1000), body_excerpt: safeText(text, 8000),
    classification: {}, occurred_at: occurredAt, raw_ref: { gmail_message_id: msg.id, gmail_thread_id: msg.threadId, label_ids: labels },
  }) });

  if (linkId) {
    const patch = direction === "in"
      ? { stage: "replied", stage_source: "system", stage_reason: "Inbound Gmail reply", last_reply_at: occurredAt, next_action: "Review reply" }
      : { stage: "contacted", stage_source: "system", stage_reason: "Outbound Gmail message", last_contact_at: occurredAt };
    // Preserve a human override to a later/specific stage.
    const current = await db(`eu_stakeholder_links?id=eq.${linkId}&select=stage,stage_source&limit=1`);
    if (current?.[0]?.stage_source !== "human" || ["identified","researching","queued","contacted","replied"].includes(current?.[0]?.stage)) {
      await db(`eu_stakeholder_links?id=eq.${linkId}`, { method: "PATCH", body: JSON.stringify(patch) });
    }
  }
  await emitEvent({
    orgId, initiativeId, eventType: direction === "in" ? "outreach.replied" : "outreach.sent",
    entityType: "eu_communications", entityId: msg.id, sourceSystem: "gmail", sourceId: msg.id,
    data: { stakeholder_id: stakeholderId, stakeholder_link_id: linkId, thread_id: msg.threadId, subject: safeText(subject, 500), occurred_at: occurredAt },
    idempotencyKey: `gmail:${msg.id}:${direction}`,
  });
  return { relevant: true, id: msg.id, direction, initiative_id: initiativeId, stakeholder_id: stakeholderId };
}

async function syncHistory(orgId: string, hintedHistoryId?: string) {
  const i = await integration(orgId);
  let start = String(i.config?.history_id || hintedHistoryId || "");
  if (!start) {
    const profile = await gmail("/profile");
    start = String(profile.historyId || "");
    await db(`eu_integrations?id=eq.${i.id}`, { method: "PATCH", body: JSON.stringify({ status: "connected", config: { ...(i.config || {}), history_id: start }, last_sync_at: new Date().toISOString() }) });
    return { initialized: true, history_id: start, messages: [] };
  }

  let pageToken = "", newest = start;
  const messageIds = new Set<string>();
  for (let pages = 0; pages < 20; pages++) {
    const q = new URLSearchParams({ startHistoryId: start, maxResults: "500", historyTypes: "messageAdded" });
    if (pageToken) q.set("pageToken", pageToken);
    let result: any;
    try { result = await gmail(`/history?${q}`); }
    catch (e) {
      if (String(e).includes("404")) {
        const profile = await gmail("/profile"); newest = String(profile.historyId || start); break;
      }
      throw e;
    }
    for (const item of result.history ?? []) {
      newest = String(item.id || newest);
      for (const ma of item.messagesAdded ?? []) if (ma.message?.id) messageIds.add(String(ma.message.id));
    }
    if (result.historyId) newest = String(result.historyId);
    pageToken = String(result.nextPageToken || "");
    if (!pageToken) break;
  }
  const normalized = [];
  for (const id of [...messageIds].slice(0, 1000)) normalized.push(await normalizeMessage(orgId, id));
  await db(`eu_integrations?id=eq.${i.id}`, { method: "PATCH", body: JSON.stringify({ status: "connected", config: { ...(i.config || {}), history_id: newest }, last_ok_at: new Date().toISOString(), last_sync_at: new Date().toISOString(), last_error: "" }) });
  await emitEvent({ orgId, eventType: "mail.sync.completed", entityType: "eu_integrations", entityId: i.id, sourceSystem: "gmail", sourceId: newest, data: { message_count: messageIds.size, relevant_count: normalized.filter((r) => r.relevant).length } });
  return { history_id: newest, messages: normalized };
}

async function verifyPubSub(req: Request) {
  const expectedAudience = Deno.env.get("GMAIL_PUBSUB_AUDIENCE") ?? "";
  const expectedService = Deno.env.get("GMAIL_PUBSUB_SERVICE_ACCOUNT") ?? "";
  if (!expectedAudience || !expectedService) return false;
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return false;
  const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`);
  if (!r.ok) return false;
  const j = await r.json();
  return j.aud === expectedAudience && j.email === expectedService && (j.email_verified === "true" || j.email_verified === true);
}

async function push(req: Request, body: any) {
  if (!(await verifyPubSub(req))) return json({ error: "invalid Pub/Sub identity" }, 401);
  const data = body?.message?.data ? JSON.parse(decode64url(String(body.message.data))) : {};
  const org = await orgBySlug("mccluster");
  // Acknowledge only after the sync attempt. Pub/Sub retries a non-2xx delivery.
  const result = await syncHistory(org.id, String(data.historyId || ""));
  return json({ ok: true, history_id: result.history_id });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  try {
    const url = new URL(req.url);
    if (url.pathname.endsWith("/push")) {
      if (req.method !== "POST") return json({ error: "POST required" }, 405);
      return await push(req, await req.json());
    }
    if (!INTERNAL_SECRET || req.headers.get("x-eu-google-secret") !== INTERNAL_SECRET) return json({ error: "unauthorized" }, 401);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const org = await orgBySlug("mccluster");
    const action = safeText(body.action, 60);
    if (action === "gmail.watch.renew") return json(await renewWatch(org.id));
    if (action === "gmail.sync") return json(await syncHistory(org.id, safeText(body.history_id, 80)));
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : "google workspace bridge failed" }, 500);
  }
});
