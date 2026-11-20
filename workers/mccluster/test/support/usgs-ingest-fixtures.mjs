/* The recorded USGS answers behind the E=UP USGS ingest's tests (slice S3, docs/control-plane/EUP-EVENT-TIMELINE.md), and the
   few things built from them. Each fixture under test/fixtures/environment/usgs-ingest/ is one real answer, wrapped as
   { recorded: { request, retrieved_at, http_status, content_type, cache_control, trimmed, credit }, body }: retrieved from
   earthquake.usgs.gov on 2026-11-19 between 04:50:41 and 05:02:16 UTC, trimmed only by removing whole rows or bulky product
   listings (`recorded.trimmed` says what). U.S. Geological Survey data, public domain. Nothing here reaches a network: the
   tests serve these answers from their own fetch doubles, and the Worker suite's offline guard refuses anything else.

   BUILT (labelled where used): a summary-feed envelope around recorded rows at a chosen generation time (the real feed keeps
   one day, so an earlier day can only be rebuilt from recorded rows), the event as ComCat showed it at an earlier moment,
   rebuilt from the recorded includesuperseded history, and a deleted event's row as it read before USGS deleted it,
   rebuilt from the recorded deleted record. */
import { readFileSync } from 'node:fs';

const DIR = new URL('../fixtures/environment/usgs-ingest/', import.meta.url);
export const USGS_FIXTURES = Object.freeze({
  feed: 'summary-2.5_day.json',                          // the M2.5+ past day, 15 of its 35 rows
  alias: 'eventid-attn6uqd.json',                        // FDSN eventid=attn6uqd (jsonerror=true): the preferred us6000u3jl
  deletedJson: 'eventid-aka2026wpvhsf-jsonerror.json',   // a deleted event, jsonerror=true: 200 with metadata.status 409
  deletedPlain: 'eventid-aka2026wpvhsf.json',            // the same without jsonerror: HTTP 409, text/plain
  deletedRecord: 'eventid-aka2026wpvhsf-includedeleted.json', // the deleted record (includedeleted=true)
  unknownJson: 'eventid-us0000zzzz99-jsonerror.json',    // an id USGS does not know, jsonerror=true: metadata.status 404
  history: 'history-us6000u3jl-includesuperseded.json',  // every product version of us6000u3jl (includesuperseded=true)
  sweep: 'sweep-includedeleted.json',                    // updatedafter + includedeleted=true over the deletion's hour
  detail: 'detail-aka2026wpvhsf.json'                    // the realtime detail feed for the deleted event: HTTP 409, text/plain
});

/* { recorded, body } as stored */
export function recorded(name) {
  return JSON.parse(readFileSync(new URL(name, DIR), 'utf8'));
}
/* the recorded answer as a Response, with its recorded status and content type unless told otherwise */
export function usgsAnswer(name, { status } = {}) {
  const f = recorded(name);
  const body = typeof f.body === 'string' ? f.body : JSON.stringify(f.body);
  return new Response(body, { status: status ?? f.recorded.http_status, headers: { 'content-type': f.recorded.content_type || 'application/json' } });
}

/* BUILT: a summary-feed envelope holding the given rows, generated at `generatedMs` */
export const feedOf = (features, generatedMs) => ({
  type: 'FeatureCollection',
  metadata: { generated: generatedMs, status: 200, title: 'BUILT for a test from recorded USGS rows', count: features.length },
  features
});

/* Every moment the recorded history changed: the update times of all its product versions, in order. */
export function historyTimes(history) {
  return [...new Set(Object.values(history.properties.products).flat().map((p) => p.updateTime))].sort((a, b) => a - b);
}

/* BUILT: the event as ComCat showed it at time `t` (ms), from the recorded includesuperseded history. The preferred origin is
   the latest version of each origin, highest preferredWeight first, the most recent update on a tie (ComCat's rule,
   https://earthquake.usgs.gov/data/comcat/products.php); its values, its place text and its code are the event's; `ids` are the
   codes of every origin present by then; `updated` is the newest product update by then; the PAGER alert is the newest
   losspager version's. The tsunami flag is held at its recorded value (the history does not carry it) and significance is
   left out (ComCat computes it; the history does not carry it either). */
export function historyView(history, t) {
  const products = history.properties.products;
  const present = Object.values(products).flat().filter((p) => p.updateTime <= t);
  if (!present.length) throw new Error('nothing in the history by then');
  const latest = new Map();
  for (const o of products.origin.filter((p) => p.updateTime <= t).sort((a, b) => a.updateTime - b.updateTime)) latest.set(`${o.source}:${o.code}`, o);
  const origins = [...latest.values()];
  const pref = [...origins].sort((a, b) => b.preferredWeight - a.preferredWeight || b.updateTime - a.updateTime)[0];
  const pager = (products.losspager || []).filter((p) => p.updateTime <= t).sort((a, b) => b.updateTime - a.updateTime)[0];
  const q = pref.properties;
  const mag = Number(q.magnitude);
  return {
    type: 'Feature', id: pref.code,
    geometry: { type: 'Point', coordinates: [Number(q.longitude), Number(q.latitude), Number(q.depth)] },
    properties: {
      mag, magType: q['magnitude-type'], place: q.title, time: Date.parse(q.eventtime), updated: Math.max(...present.map((p) => p.updateTime)),
      url: `https://earthquake.usgs.gov/earthquakes/eventpage/${pref.code}`, status: String(q['review-status']).toLowerCase(),
      ids: `,${[...new Set(origins.map((o) => o.code))].join(',')},`, alert: pager ? pager.properties.alertlevel : null,
      tsunami: history.properties.tsunami, sig: null, net: q.eventsource, code: q.eventsourcecode, title: `M ${mag} - ${q.title}`
    }
  };
}

/* BUILT: a deleted event's row as the feed showed it before USGS deleted it: the recorded deleted record with its status
   set back (USGS keeps no earlier status in the record; Alaska's automatic events start 'automatic'). */
export function beforeDeletion(record, status = 'automatic') {
  return { ...record, properties: { ...record.properties, status } };
}
