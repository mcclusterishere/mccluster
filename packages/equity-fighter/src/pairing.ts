/* Owner-only pairing, in the spirit of OpenClaw's DM pairing but stricter:
   there is no "approve this stranger" prompt. A pairing code is an HMAC of
   the exact platform user id under EQUITY_FIGHTER_PAIRING_SECRET, made on a
   trusted machine by the owner (`npm run pair-code -- <platform> <user id>`)
   and sent once from that account as `/pair <code>`. A code is useless from
   any other account, a wrong code gets no reply, and pairing can be revoked
   by setting ef_identities.revoked_at. Static allowlists
   (EQUITY_FIGHTER_<PLATFORM>_OWNER_IDS) work without pairing. */

import { hmacSha256Hex, timingSafeEqual } from './crypto.js';
import type { Platform } from './types.js';

export const PAIR_COMMAND = /^\/?pair\s+([A-Za-z0-9-]{8,64})\s*$/i;

export async function pairingCode(secret: string, platform: Platform, platformUserId: string): Promise<string> {
  if (!secret || secret.length < 16) throw new Error('EQUITY_FIGHTER_PAIRING_SECRET must be at least 16 characters');
  const hex = (await hmacSha256Hex(secret, `equity-fighter-pair:v1:${platform}:${platformUserId}`)).slice(0, 16).toUpperCase();
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}`;
}

export async function verifyPairingCode(secret: string, platform: Platform, platformUserId: string, presented: string): Promise<boolean> {
  if (!secret || secret.length < 16) return false;
  const expected = await pairingCode(secret, platform, platformUserId);
  return timingSafeEqual(presented.trim().toUpperCase(), expected);
}
