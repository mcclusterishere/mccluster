// Google Calendar -> ai_context.source_calendar_events. Uses events.list with a sync token, and asks Google for
// only the fields below. Descriptions, location text and raw attendee addresses never reach the database.
import { googleGet } from './google-oauth.mjs';
import { compact, assertAllowed } from './allow-list.mjs';
import { keyedHash, normalizeEmail, redactText, uniq } from './pii.mjs';

const FIELDS = 'items(id,status,summary,start,end,recurringEventId,organizer(self),attendees(email,self),hangoutLink,conferenceData(conferenceId),location,updated),nextPageToken,nextSyncToken';

function when(t) {
  if (!t) return { at: null, allDay: false };
  if (t.dateTime) return { at: new Date(t.dateTime).toISOString(), allDay: false };
  if (t.date) return { at: new Date(`${t.date}T00:00:00Z`).toISOString(), allDay: true };
  return { at: null, allDay: false };
}

export function normalizeCalendarEvent(ev, { hashKey, calendarId = 'primary', includeTitle = true } = {}) {
  if (!ev?.id) return null;
  const start = when(ev.start);
  const end = when(ev.end);
  const attendees = (ev.attendees || []).filter((a) => !a.self).map((a) => normalizeEmail(a.email)).filter(Boolean);
  const status = ['confirmed', 'tentative', 'cancelled'].includes(ev.status) ? ev.status : 'confirmed';
  return assertAllowed('google.calendar', compact({
    external_id: String(ev.id).slice(0, 256),
    calendar_hash: keyedHash(`calendar:${calendarId}`, hashKey),
    recurring_event_id: ev.recurringEventId ? String(ev.recurringEventId).slice(0, 256) : null,
    status,
    starts_at: start.at,
    ends_at: end.at,
    all_day: start.allDay,
    title_redacted: includeTitle ? redactText(ev.summary, 140) : null,
    organizer_self: Boolean(ev.organizer?.self),
    attendee_count: Math.min(1000, (ev.attendees || []).length),
    attendee_hashes: uniq(attendees, 100).map((a) => keyedHash(a, hashKey)),
    has_conference: Boolean(ev.hangoutLink || ev.conferenceData),
    has_location: Boolean(ev.location),
    source_updated_at: ev.updated ? new Date(ev.updated).toISOString() : null,
  }));
}

// Incremental with a sync token; a 410 (token expired) restarts with a bounded window.
export async function pullCalendar({ token, calendarId = 'primary', cursor = {}, now = Date.now(), backfillDays = 180, maxPages = 20, fetchImpl = fetch }) {
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  const run = async (syncToken) => {
    const items = [];
    let pageToken = null;
    let nextSyncToken = null;
    for (let pages = 0; pages < maxPages; pages += 1) {
      const qs = new URLSearchParams({ maxResults: '250', showDeleted: 'true', fields: FIELDS });
      if (syncToken) qs.set('syncToken', syncToken);
      else qs.set('timeMin', new Date(now - backfillDays * 86_400_000).toISOString());
      if (pageToken) qs.set('pageToken', pageToken);
      const body = await googleGet(`${base}?${qs}`, token, fetchImpl);
      items.push(...(body.items || []));
      pageToken = body.nextPageToken || null;
      nextSyncToken = body.nextSyncToken || nextSyncToken;
      if (!pageToken) break;
    }
    return { items, nextSyncToken, complete: !pageToken };
  };
  let out;
  try {
    out = await run(cursor.sync_token || null);
  } catch (err) {
    if (err.status !== 410 || !cursor.sync_token) throw err;
    out = await run(null);
  }
  // Only a finished walk yields a sync token; an unfinished one keeps the old cursor and is repeated (idempotent).
  return { items: out.items, cursor: out.complete && out.nextSyncToken ? { sync_token: out.nextSyncToken } : cursor, complete: out.complete };
}
