/* Caps: 150 a day from mattmccluster@gmail.com, 50 per frame, counted on Matthew's calendar day (America/New_York).
   The pipeline uses the same numbers to size each day's review queue, and the gated send refuses past them. */
import { FRAME_KEYS, nyDay } from './config.mjs';

export function remainingCapacity({ sends = [], queued = [], config, day = nyDay() }) {
  const perFrame = Object.fromEntries(FRAME_KEYS.map((f) => [f, 0]));
  let total = 0;
  for (const s of sends) if (s.sent_day === day) { perFrame[s.frame] = (perFrame[s.frame] || 0) + 1; total += 1; }
  for (const d of queued) { perFrame[d.frame] = (perFrame[d.frame] || 0) + 1; total += 1; }
  const remainingTotal = Math.max(0, config.dailyCap - total);
  const remaining = Object.fromEntries(FRAME_KEYS.map((f) => [f, Math.max(0, Math.min(config.frameCap - perFrame[f], remainingTotal))]));
  return { day, used: { total, perFrame }, remainingTotal, remaining };
}

export function assertCanSend({ sendsToday, frame, config }) {
  const total = sendsToday.length;
  const inFrame = sendsToday.filter((s) => s.frame === frame).length;
  if (total >= config.dailyCap) throw new Error(`daily cap reached: ${total} of ${config.dailyCap} sent today`);
  if (inFrame >= config.frameCap) throw new Error(`frame ${frame} cap reached: ${inFrame} of ${config.frameCap} sent today`);
}
