/* TABLE READ — clock and take alignment. Pure functions, no DOM: the phone
   page and Prime's alignment step (tools/table-read/prime/align_takes.py
   mirrors the same rules) agree on what a take's timestamps mean.

   Each device keeps its own clock (performance.timeOrigin + performance.now()).
   The room's server stamps pongs; the sample with the shortest round trip
   gives the best offset (server = device + offset). Offsets taken over the
   whole take give the device's drift. The sync cue is one server instant:
   every device beeps and flashes at it, records when that was on its own
   clock, and Prime cross-checks that stamp against the beep it finds in the
   audio. */

/* t0 device send, server_t server stamp, t3 device receive (all ms). */
export function offsetSample(t0, serverT, t3) {
  const rtt = Math.max(0, t3 - t0);
  return { rtt, offset: serverT - (t0 + rtt / 2), at: t3 };
}

/* Keep the best third of samples by round trip, return their median offset. */
export function bestOffset(samples) {
  const good = samples.filter((s) => Number.isFinite(s.offset) && Number.isFinite(s.rtt));
  if (!good.length) return null;
  const sorted = [...good].sort((a, b) => a.rtt - b.rtt).slice(0, Math.max(1, Math.ceil(good.length / 3)));
  const offs = sorted.map((s) => s.offset).sort((a, b) => a - b);
  const mid = offs.length >> 1;
  const offset = offs.length % 2 ? offs[mid] : (offs[mid - 1] + offs[mid]) / 2;
  return { offset, rtt: sorted[0].rtt, n: good.length };
}

/* Least-squares slope of offset over device time, in parts per million. */
export function driftPpm(samples) {
  const s = samples.filter((x) => Number.isFinite(x.offset) && Number.isFinite(x.at));
  if (s.length < 3) return null;
  const n = s.length;
  const mx = s.reduce((a, x) => a + x.at, 0) / n;
  const my = s.reduce((a, x) => a + x.offset, 0) / n;
  let num = 0; let den = 0;
  for (const x of s) { num += (x.at - mx) * (x.offset - my); den += (x.at - mx) ** 2; }
  return den ? (num / den) * 1e6 : null;
}

/* Device time of a server instant. */
export const toDevice = (serverMs, offset) => serverMs - offset;

/* Where, inside one device's recording, a server instant falls (ms from the
   recording's first frame). startedDevice is the device time of the first chunk. */
export function inTake(serverMs, offset, startedDevice) {
  return toDevice(serverMs, offset) - startedDevice;
}

/* Align several takes on one sync cue. Each take: { seat, sync_in_take_ms }.
   Returns a lead per take (ms of its own head to trim) so the cue lines up,
   plus the spread before alignment. */
export function alignOnCue(takes) {
  const xs = takes.filter((t) => Number.isFinite(t.sync_in_take_ms));
  if (!xs.length) return { aligned: [], spread_ms: null };
  const min = Math.min(...xs.map((t) => t.sync_in_take_ms));
  const max = Math.max(...xs.map((t) => t.sync_in_take_ms));
  return {
    aligned: xs.map((t) => ({ seat: t.seat, trim_head_ms: t.sync_in_take_ms - min })),
    spread_ms: max - min,
  };
}

/* Drift between two sync cues inside one take: the recording's own duration
   between the beeps against the server's. Positive ppm = recording runs long. */
export function takeDrift(firstInTake, lastInTake, firstServer, lastServer) {
  const server = lastServer - firstServer;
  if (!(server > 0)) return null;
  return (((lastInTake - firstInTake) - server) / server) * 1e6;
}
