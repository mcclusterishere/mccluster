// Equity Uprise scheduling gateway.
// Public callers can see derived slots only — never event titles or attendees.
// Final event creation is a high-risk control-plane action and requires an
// approved control_approval bound to the exact interview request hash.
import {
  authorize, cors, db, emitEvent, json, orgBySlug, safeText, sha256Hex, verifyCaller, turnstileFailure, verifyTurnstile,
} from "../_shared/eu-policy-os.ts";

const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_CAL = "https://www.googleapis.com/calendar/v3";

async function googleAccessToken() {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";
  const refreshToken = Deno.env.get("GOOGLE_REFRESH_TOKEN") ?? "";
  if (!clientId || !clientSecret || !refreshToken) throw new Error("google calendar not configured");
  const fd = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const r = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: fd,
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error(`google token ${r.status}`);
  return String(j.access_token);
}

async function settings(orgId: string) {
  const rows = await db(`eu_calendar_settings?org_id=eq.${orgId}&select=*&limit=1`);
  if (rows?.length) return rows[0];
  return {
    org_id: orgId,
    calendar_external_id: "primary",
    timezone: "America/New_York",
    interview_minutes: 30,
    buffer_before_minutes: 15,
    buffer_after_minutes: 15,
    minimum_notice_minutes: 1440,
    booking_horizon_days: 30,
    allowed_windows: {
      "1": [["09:00", "17:00"]], "2": [["09:00", "17:00"]],
      "3": [["09:00", "17:00"]], "4": [["09:00", "17:00"]],
      "5": [["09:00", "17:00"]],
    },
    blackout_rules: {},
    reminder_minutes: [60, 30],
  };
}

function localParts(date: Date, zone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const m: Record<string, string> = {};
  for (const p of parts) if (p.type !== "literal") m[p.type] = p.value;
  return m;
}

function zonedToUtc(date: string, time: string, zone: string) {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  let guess = Date.UTC(y, mo - 1, d, h, mi, 0);
  for (let i = 0; i < 3; i++) {
    const p = localParts(new Date(guess), zone);
    const seenAsUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
    const desired = Date.UTC(y, mo - 1, d, h, mi, 0);
    const delta = desired - seenAsUtc;
    if (!delta) break;
    guess += delta;
  }
  return new Date(guess);
}

function dateKey(d: Date) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function addDaysKey(key: string, n: number) {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return dateKey(d);
}

function weekday(key: string) {
  return new Date(`${key}T12:00:00Z`).getUTCDay();
}

function overlaps(a0: number, a1: number, b0: number, b1: number) {
  return a0 < b1 && b0 < a1;
}

async function freeBusy(calendarId: string, timeMin: Date, timeMax: Date, zone: string) {
  const token = await googleAccessToken();
  const r = await fetch(`${GOOGLE_CAL}/freeBusy`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(), timeZone: zone,
      items: [{ id: calendarId }],
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`calendar freebusy ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
  return (j.calendars?.[calendarId]?.busy ?? []) as Array<{ start: string; end: string }>;
}

async function applicationFromCapability(orgId: string, appId: unknown, rawToken: unknown) {
  const id = safeText(appId, 80);
  const token = safeText(rawToken, 200);
  if (!id || !token) throw new Error("application capability required");
  const hash = await sha256Hex(token);
  const rows = await db(`eu_fellowship_applications?id=eq.${encodeURIComponent(id)}&org_id=eq.${orgId}&booking_token_hash=eq.${hash}&select=id,applicant_name,email,stakeholder_id,initiative_ids,stage&limit=1`);
  if (!rows?.length) throw new Error("application capability invalid");
  return rows[0];
}

async function availableSlots(orgId: string, startDate?: string, days?: number) {
  const cfg = await settings(orgId);
  const zone = cfg.timezone || "America/New_York";
  const now = new Date();
  const today = `${localParts(now, zone).year}-${localParts(now, zone).month}-${localParts(now, zone).day}`;
  const start = /^\d{4}-\d{2}-\d{2}$/.test(startDate ?? "") ? String(startDate) : today;
  const horizon = Math.min(Math.max(Number(days) || 14, 1), Number(cfg.booking_horizon_days) || 30);
  const windows = cfg.allowed_windows && Object.keys(cfg.allowed_windows).length ? cfg.allowed_windows : {
    "1": [["09:00", "17:00"]], "2": [["09:00", "17:00"]], "3": [["09:00", "17:00"]],
    "4": [["09:00", "17:00"]], "5": [["09:00", "17:00"]],
  };
  const duration = Number(cfg.interview_minutes) || 30;
  const before = Number(cfg.buffer_before_minutes) || 0;
  const after = Number(cfg.buffer_after_minutes) || 0;
  const minNotice = Number(cfg.minimum_notice_minutes) || 0;
  const earliest = now.getTime() + minNotice * 60000;
  const rangeStart = zonedToUtc(start, "00:00", zone);
  const rangeEnd = zonedToUtc(addDaysKey(start, horizon), "23:59", zone);
  const busy = await freeBusy(cfg.calendar_external_id || "primary", rangeStart, rangeEnd, zone);
  const busyMs = busy.map((b) => [Date.parse(b.start), Date.parse(b.end)] as [number, number]);
  const slots: Array<Record<string, unknown>> = [];

  for (let day = 0; day < horizon; day++) {
    const key = addDaysKey(start, day);
    const dayWindows = windows[String(weekday(key))] ?? [];
    for (const pair of dayWindows) {
      if (!Array.isArray(pair) || pair.length !== 2) continue;
      const ws = zonedToUtc(key, String(pair[0]), zone).getTime();
      const we = zonedToUtc(key, String(pair[1]), zone).getTime();
      for (let s = ws; s + duration * 60000 <= we; s += duration * 60000) {
        const e = s + duration * 60000;
        if (s < earliest) continue;
        const check0 = s - before * 60000, check1 = e + after * 60000;
        if (busyMs.some(([b0, b1]) => overlaps(check0, check1, b0, b1))) continue;
        slots.push({ start: new Date(s).toISOString(), end: new Date(e).toISOString(), timezone: zone });
        if (slots.length >= 80) return { slots, timezone: zone, duration_minutes: duration };
      }
    }
  }
  return { slots, timezone: zone, duration_minutes: duration };
}

async function requestInterview(req: Request, body: Record<string, unknown>) {
  const org = await orgBySlug("mccluster");
  const app = await applicationFromCapability(org.id, body.application_id, body.booking_token);
  const cfg = await settings(org.id);
  const start = new Date(safeText(body.start, 60));
  const end = new Date(safeText(body.end, 60));
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) throw new Error("invalid slot");
  const duration = Math.round((end.getTime() - start.getTime()) / 60000);
  if (duration !== Number(cfg.interview_minutes)) throw new Error("slot duration changed; refresh availability");

  const busy = await freeBusy(cfg.calendar_external_id || "primary", new Date(start.getTime() - Number(cfg.buffer_before_minutes || 0) * 60000), new Date(end.getTime() + Number(cfg.buffer_after_minutes || 0) * 60000), cfg.timezone);
  if (busy.length) throw new Error("slot is no longer available");
  const active = await db(`eu_interview_requests?application_id=eq.${app.id}&state=in.(requested,held,approved,confirmed)&select=id&limit=1`);
  if (active?.length) return { ok: true, request_id: active[0].id, duplicate: true };

  const rows = await db("eu_interview_requests", {
    method: "POST",
    body: JSON.stringify({
      org_id: org.id,
      application_id: app.id,
      stakeholder_id: app.stakeholder_id,
      requested_start: start.toISOString(),
      requested_end: end.toISOString(),
      timezone: cfg.timezone,
      hold_expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      state: "held",
    }),
  });
  const r = rows[0];
  await db(`eu_fellowship_applications?id=eq.${app.id}`, { method: "PATCH", body: JSON.stringify({ stage: "interview-requested" }) });
  await emitEvent({
    orgId: org.id, eventType: "interview.requested", entityType: "eu_interview_requests", entityId: r.id,
    sourceSystem: "web", data: { application_id: app.id, starts_at: start.toISOString(), ends_at: end.toISOString() },
    idempotencyKey: `interview:${r.id}:requested`,
  });
  return { ok: true, request_id: r.id, state: r.state };
}

async function createGoogleEvent(cfg: any, reqRow: any, app: any) {
  const token = await googleAccessToken();
  const reminders = Array.isArray(cfg.reminder_minutes) ? cfg.reminder_minutes.slice(0, 5) : [60, 30];
  const payload = {
    summary: `Equity Uprise Fellowship Interview — ${app.preferred_name || app.applicant_name}`,
    description: `Equity Uprise fellowship interview. Application ${app.id}.`,
    start: { dateTime: reqRow.requested_start, timeZone: cfg.timezone },
    end: { dateTime: reqRow.requested_end, timeZone: cfg.timezone },
    attendees: [{ email: app.email, displayName: app.preferred_name || app.applicant_name }],
    reminders: { useDefault: false, overrides: reminders.map((m: number) => ({ method: "popup", minutes: Number(m) })) },
    extendedProperties: { private: { equity_uprise_application_id: app.id, equity_uprise_interview_request_id: reqRow.id } },
  };
  const calendarId = encodeURIComponent(cfg.calendar_external_id || "primary");
  const r = await fetch(`${GOOGLE_CAL}/calendars/${calendarId}/events?sendUpdates=all&conferenceDataVersion=1`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`calendar create ${r.status}: ${JSON.stringify(j).slice(0, 500)}`);
  return j;
}

async function confirmInterview(req: Request, body: Record<string, unknown>) {
  const caller = await verifyCaller(req);
  if (!caller) throw new Error("authentication required");
  const org = await orgBySlug("mccluster");
  const requestId = safeText(body.request_id, 80);
  const rows = await db(`eu_interview_requests?id=eq.${encodeURIComponent(requestId)}&org_id=eq.${org.id}&select=*&limit=1`);
  if (!rows?.length) throw new Error("interview request not found");
  const interview = rows[0];
  if (!["held","requested","approved"].includes(interview.state)) throw new Error(`request is ${interview.state}`);
  const requestHash = await sha256Hex(JSON.stringify({ id: interview.id, start: interview.requested_start, end: interview.requested_end, action: "calendar.schedule" }));
  const decision = await authorize(caller, org.id, "calendar.schedule", {
    resourceType: "eu_interview_requests", resourceId: interview.id, requestHash, approvalId: safeText(body.approval_id, 80),
  });
  if (!decision.allowed) return { ok: false, approval_required: true, reason: decision.reason, request_hash: requestHash };

  const apps = await db(`eu_fellowship_applications?id=eq.${interview.application_id}&select=id,applicant_name,preferred_name,email,stakeholder_id,initiative_ids,stage&limit=1`);
  if (!apps?.length) throw new Error("application not found");
  const app = apps[0];
  const cfg = await settings(org.id);
  const busy = await freeBusy(cfg.calendar_external_id || "primary", new Date(interview.requested_start), new Date(interview.requested_end), cfg.timezone);
  if (busy.length) {
    await db(`eu_interview_requests?id=eq.${interview.id}`, { method: "PATCH", body: JSON.stringify({ state: "conflict", conflict_reason: "Calendar became busy before approval" }) });
    await emitEvent({ orgId: org.id, eventType: "interview.conflict", entityType: "eu_interview_requests", entityId: interview.id, actorMUid: caller.mUid, actorUserId: caller.authUserId, data: {} });
    return { ok: false, conflict: true };
  }

  const event = await createGoogleEvent(cfg, interview, app);
  const initiativeId = Array.isArray(app.initiative_ids) && app.initiative_ids.length ? app.initiative_ids[0] : null;
  const meetingRows = await db("eu_meetings", {
    method: "POST",
    body: JSON.stringify({
      org_id: org.id, initiative_id: initiativeId, title: `Fellowship interview — ${app.preferred_name || app.applicant_name}`,
      meeting_type: "fellowship-interview", status: "confirmed", starts_at: interview.requested_start,
      ends_at: interview.requested_end, timezone: cfg.timezone, provider: "google-calendar",
      external_event_id: event.id ?? "", external_join_url: event.hangoutLink ?? "", created_by: caller.authUserId,
    }),
  });
  const meeting = meetingRows[0];
  await db("eu_meeting_participants", { method: "POST", body: JSON.stringify({ meeting_id: meeting.id, stakeholder_id: app.stakeholder_id, email: app.email, name: app.preferred_name || app.applicant_name, participant_role: "applicant" }) });
  await db(`eu_interview_requests?id=eq.${interview.id}`, { method: "PATCH", body: JSON.stringify({ state: "confirmed", meeting_id: meeting.id, decided_at: new Date().toISOString(), decided_by: caller.authUserId }) });
  await db(`eu_fellowship_applications?id=eq.${app.id}`, { method: "PATCH", body: JSON.stringify({ stage: "interview-scheduled" }) });
  await emitEvent({ orgId: org.id, initiativeId, eventType: "interview.confirmed", entityType: "eu_interview_requests", entityId: interview.id, sourceSystem: "google-calendar", sourceId: event.id ?? "", actorMUid: caller.mUid, actorUserId: caller.authUserId, data: { meeting_id: meeting.id, starts_at: interview.requested_start }, idempotencyKey: `interview:${interview.id}:confirmed` });
  await emitEvent({ orgId: org.id, initiativeId, eventType: "meeting.confirmed", entityType: "eu_meetings", entityId: meeting.id, sourceSystem: "google-calendar", sourceId: event.id ?? "", actorMUid: caller.mUid, actorUserId: caller.authUserId, data: { application_id: app.id }, idempotencyKey: `meeting:${meeting.id}:confirmed` });
  return { ok: true, meeting_id: meeting.id, event_id: event.id, html_link: event.htmlLink ?? "" };
}

async function declineInterview(req: Request, body: Record<string, unknown>) {
  const caller = await verifyCaller(req);
  if (!caller) throw new Error("authentication required");
  const org = await orgBySlug("mccluster");
  const decision = await authorize(caller, org.id, "policy.write");
  if (!decision.allowed) throw new Error("permission denied");
  const id = safeText(body.request_id, 80);
  const rows = await db(`eu_interview_requests?id=eq.${encodeURIComponent(id)}&org_id=eq.${org.id}&select=id,application_id,state&limit=1`);
  if (!rows?.length) throw new Error("request not found");
  await db(`eu_interview_requests?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ state: "declined", decided_at: new Date().toISOString(), decided_by: caller.authUserId }) });
  await emitEvent({ orgId: org.id, eventType: "interview.declined", entityType: "eu_interview_requests", entityId: id, actorMUid: caller.mUid, actorUserId: caller.authUserId, data: { application_id: rows[0].application_id } });
  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  try {
    const body = await req.json();
    const action = safeText(body.action, 50);
    if (["availability","request"].includes(action)) {
      const verified = await verifyTurnstile(req, body.turnstile_token);
      if (!verified.ok) {
        const failure = turnstileFailure(verified);
        return json(failure.body, failure.status);
      }
      const org = await orgBySlug("mccluster");
      await applicationFromCapability(org.id, body.application_id, body.booking_token);
      if (action === "availability") return json(await availableSlots(org.id, safeText(body.start_date, 10), Number(body.days) || 14));
      return json(await requestInterview(req, body));
    }
    if (action === "confirm") return json(await confirmInterview(req, body));
    if (action === "decline") return json(await declineInterview(req, body));
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : "calendar failed" }, 400);
  }
});
