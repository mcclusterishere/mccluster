import Anthropic from "npm:@anthropic-ai/sdk@0.71.0";

const SB = Deno.env.get("SUPABASE_URL")!;
const SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ORG_SLUG = Deno.env.get("INTAKE_ORG_SLUG") ?? "jnh-elevate";
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MODEL = "claude-opus-5";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });

async function db(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SRV, Authorization: `Bearer ${SRV}`, "content-type": "application/json", Prefer: "return=representation", ...(init.headers ?? {}) },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`db ${r.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function rpc(name: string, body: Record<string, unknown>) {
  const r = await fetch(`${SB}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: SRV, Authorization: `Bearer ${SRV}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`rpc ${name} ${r.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

function callerId(req: Request): string | null {
  const raw = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const part = raw.split(".")[1];
  if (!part) return null;
  try {
    const pad = part.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(pad + "=".repeat((4 - pad.length % 4) % 4)));
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch { return null; }
}

async function requireCapability(actor: string, org: string, capability: string, resourceType = "org", resourceId = org) {
  const decision = await rpc("control_authorize_service", {
    p_actor: actor,
    p_org: org,
    p_capability: capability,
    p_resource_type: resourceType,
    p_resource_id: resourceId,
    p_request_hash: null,
    p_approval_id: null,
  });
  if (!decision?.allowed) {
    const e = new Error(`forbidden:${decision?.reason ?? "capability_denied"}`);
    (e as Error & { status?: number }).status = 403;
    throw e;
  }
  return decision;
}

async function recordCommand(org: string, actor: string, capability: string, resourceType: string, resourceId: string, action: string, metadata: Record<string, unknown> = {}) {
  return await rpc("control_record_command_service", {
    p_org: org, p_actor: actor, p_actor_kind: "agent", p_capability: capability,
    p_resource_type: resourceType, p_resource_id: resourceId, p_action: action,
    p_request_hash: null, p_idempotency_key: null, p_approval_id: null,
    p_status: "allowed", p_metadata: metadata,
  });
}

async function finishCommand(command: string | null, ok: boolean, result?: unknown, error?: string) {
  if (!command) return;
  await rpc("control_finish_command_service", {
    p_command: command,
    p_status: ok ? "executed" : "failed",
    p_result: ok ? (result ?? null) : null,
    p_error: ok ? null : (error ?? "failed"),
  }).catch(() => {});
}

const TOOL_CAPABILITY: Record<string, string> = {
  list_campaigns: "campaign.read",
  campaign_status: "campaign.read",
  draft_campaign: "campaign.prepare",
  build_campaign_audience: "campaign.prepare",
  pause_campaign: "campaign.pause",
  add_prospects: "campaign.prepare",
  suppress_address: "campaign.prepare",
  list_channels: "social.read",
  queue_social_post: "social.queue",
  recent_inquiries: "campaign.read",
};

const TOOLS: Anthropic.Tool[] = [
  { name: "list_campaigns", description: "List this org's outreach campaigns.", input_schema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "campaign_status", description: "Get delivery state and blockers for one campaign.", input_schema: { type: "object", properties: { campaign_id: { type: "string" } }, required: ["campaign_id"], additionalProperties: false } },
  { name: "draft_campaign", description: "Create a DRAFT campaign. Never sends.", input_schema: { type: "object", properties: { name: { type: "string" }, subject: { type: "string" }, body_text: { type: "string" }, audience_kind: { type: "string", enum: ["warm", "cold"] }, throttle_per_hour: { type: "integer", minimum: 1, maximum: 2000 } }, required: ["name", "subject", "body_text", "audience_kind"], additionalProperties: false } },
  { name: "build_campaign_audience", description: "Resolve recipients, skipping suppressions. Sends nothing.", input_schema: { type: "object", properties: { campaign_id: { type: "string" } }, required: ["campaign_id"], additionalProperties: false } },
  { name: "pause_campaign", description: "Pause a campaign.", input_schema: { type: "object", properties: { campaign_id: { type: "string" } }, required: ["campaign_id"], additionalProperties: false } },
  { name: "add_prospects", description: "Add researched/imported/manual prospect companies and contacts.", input_schema: { type: "object", properties: { source: { type: "string", enum: ["import", "research", "manual"] }, companies: { type: "array", items: { type: "object", properties: { name: { type: "string" }, domain: { type: "string" }, kind: { type: "string", enum: ["nonprofit", "brand", "agency", "government", "media", "other"] }, city: { type: "string" }, contact_email: { type: "string" }, contact_name: { type: "string" } }, required: ["name"], additionalProperties: false } } }, required: ["source", "companies"], additionalProperties: false } },
  { name: "suppress_address", description: "Add an address to the do-not-contact list.", input_schema: { type: "object", properties: { address: { type: "string" }, note: { type: "string" } }, required: ["address"], additionalProperties: false } },
  { name: "list_channels", description: "List social-channel readiness and blockers.", input_schema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "queue_social_post", description: "Queue a post; never publishes inline.", input_schema: { type: "object", properties: { channels: { type: "array", items: { type: "string" } }, body: { type: "string" } }, required: ["channels", "body"], additionalProperties: false } },
  { name: "recent_inquiries", description: "Recent inbound website inquiries.", input_schema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 50 } }, additionalProperties: false } },
];

async function runTool(name: string, input: Record<string, unknown>, org: string, caller: string) {
  const capability = TOOL_CAPABILITY[name];
  if (!capability) throw new Error(`no capability mapping for ${name}`);
  const resourceId = String(input.campaign_id ?? input.address ?? org);
  await requireCapability(caller, org, capability, input.campaign_id ? "campaign" : "org", resourceId);
  const mutating = !["list_campaigns", "campaign_status", "list_channels", "recent_inquiries"].includes(name);
  const command = mutating ? await recordCommand(org, caller, capability, input.campaign_id ? "campaign" : "org", resourceId, name, { tool: name }) : null;
  try {
    let out: unknown;
    switch (name) {
      case "list_campaigns": out = await db(`out_campaigns?org_id=eq.${org}&select=id,name,status,audience_kind,subject,throttle_per_hour,approved_by,created_at&order=created_at.desc&limit=50`); break;
      case "campaign_status":
      case "build_campaign_audience":
      case "pause_campaign": {
        const action = name === "campaign_status" ? "stats" : name === "pause_campaign" ? "pause" : "build";
        const r = await fetch(`${SB}/functions/v1/outreach`, { method: "POST", headers: { Authorization: `Bearer ${SRV}`, "content-type": "application/json" }, body: JSON.stringify({ action, campaign_id: input.campaign_id, control_actor: caller }) });
        out = await r.json();
        break;
      }
      case "draft_campaign": {
        const sender = (await db(`out_sender_identities?org_id=eq.${org}&select=id&limit=1`))?.[0];
        if (!sender) out = { error: "no sender identity configured for this org" };
        else {
          const made = await db("out_campaigns", { method: "POST", body: JSON.stringify({ org_id: org, sender_id: sender.id, name: input.name, subject: input.subject, body_text: input.body_text, audience_kind: input.audience_kind, throttle_per_hour: input.throttle_per_hour ?? (input.audience_kind === "cold" ? 30 : 60), created_by: caller }) });
          out = { campaign: made[0], note: "Created as a draft. Nothing sends until an authorised owner approves and sends it." };
        }
        break;
      }
      case "add_prospects": {
        const list = Array.isArray(input.companies) ? input.companies : [];
        let companies = 0, contacts = 0;
        for (const c of list as Record<string, string>[]) {
          const made = await db("out_companies", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify({ org_id: org, name: c.name, domain: c.domain ?? null, kind: c.kind ?? "nonprofit", city: c.city ?? null, source: input.source, status: "new" }) }).catch(() => null);
          const companyId = made?.[0]?.id ?? null;
          if (companyId) companies++;
          if (c.contact_email) {
            await db("out_contacts", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify({ org_id: org, company_id: companyId, email: String(c.contact_email).toLowerCase(), name: c.contact_name ?? null, consent: "none", consent_source: `added by operator via chat (${input.source})` }) }).catch(() => {});
            contacts++;
          }
        }
        out = { companies_added: companies, contacts_added: contacts };
        break;
      }
      case "suppress_address": await db("out_suppressions", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify({ org_id: org, address: String(input.address).toLowerCase(), reason: "manual", detail: String(input.note ?? "added from ops chat") }) }); out = { suppressed: input.address }; break;
      case "list_channels":
      case "queue_social_post": {
        const body = name === "list_channels" ? { action: "channels", control_actor: caller } : { action: "queue", channels: input.channels, body: input.body, control_actor: caller };
        const r = await fetch(`${SB}/functions/v1/social`, { method: "POST", headers: { Authorization: `Bearer ${SRV}`, "content-type": "application/json" }, body: JSON.stringify(body) });
        out = await r.json();
        break;
      }
      case "recent_inquiries": out = await db(`inbox_conversations?org_id=eq.${org}&select=id,channel,subject_ref,status,created_at,inbox_contacts(display_name,email)&order=created_at.desc&limit=${Math.min(Number(input.limit ?? 10),50)}`); break;
      default: out = { error: `no such tool: ${name}` };
    }
    await finishCommand(command, true, out);
    return out;
  } catch (e) {
    await finishCommand(command, false, null, String(e).slice(0, 400));
    throw e;
  }
}

const SYSTEM = `You are the operations console for ${ORG_SLUG}. Be short and concrete. Check status before promising an external action. You cannot send email or publish social content; you can draft, prepare, pause, suppress, inspect and queue. Never invent contacts or addresses. Never work around approval, suppression, sender identity or compliance controls.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!ANTHROPIC_KEY) return json({ error: "ANTHROPIC_API_KEY is not configured on this project" }, 503);
  const caller = callerId(req);
  if (!caller) return json({ error: "authenticated user required" }, 401);
  let p: { messages?: Anthropic.MessageParam[] };
  try { p = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const history = Array.isArray(p.messages) ? p.messages.slice(-20) : [];
  if (!history.length) return json({ error: "messages[] required" }, 400);
  const started = Date.now();
  try {
    const orgs = await db(`orgs?slug=eq.${encodeURIComponent(ORG_SLUG)}&select=id&limit=1`);
    if (!orgs?.length) return json({ error: "org not configured" }, 500);
    const org = orgs[0].id;
    await requireCapability(caller, org, "ops.use", "org", org);
    const client = new Anthropic({ apiKey: ANTHROPIC_KEY });
    const messages: Anthropic.MessageParam[] = [...history];
    const used: string[] = [];
    let inTokens = 0, outTokens = 0, reply = "";
    for (let turn = 0; turn < 8; turn++) {
      const response = await client.messages.create({ model: MODEL, max_tokens: 8000, system: SYSTEM, thinking: { type: "adaptive" }, tools: TOOLS, messages });
      inTokens += response.usage.input_tokens; outTokens += response.usage.output_tokens;
      messages.push({ role: "assistant", content: response.content });
      if (response.stop_reason !== "tool_use") {
        reply = response.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
        break;
      }
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        used.push(block.name);
        try { results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(await runTool(block.name, block.input as Record<string, unknown>, org, caller)).slice(0,20000) }); }
        catch (e) { results.push({ type: "tool_result", tool_use_id: block.id, content: String(e).slice(0,500), is_error: true }); }
      }
      messages.push({ role: "user", content: results });
    }
    await db("ai_calls", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ org_id: org, purpose: "ops-chat", model: MODEL, pattern: "tool_loop", input_tokens: inTokens, output_tokens: outTokens, cost_micros: inTokens*5 + outTokens*25, latency_ms: Date.now()-started, ok: true }) }).catch(() => {});
    return json({ ok: true, reply: reply || "I ran out of steps before finishing that. Try one operation at a time.", tools_used: used, usage: { input_tokens: inTokens, output_tokens: outTokens } });
  } catch (e) {
    const msg = String(e).slice(0,400);
    const status = (e as Error & { status?: number }).status ?? (msg.startsWith("Error: forbidden:") ? 403 : 500);
    console.error("ops-chat", msg);
    return json({ error: msg }, status);
  }
});
