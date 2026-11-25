import type { GatewayConfig } from '../config.js';
import type { ChannelAdapter, Platform } from '../types.js';
import { createDiscordAdapter } from './discord.js';
import { createSlackAdapter } from './slack.js';
import { createTelegramAdapter } from './telegram.js';
import { createWhatsAppAdapter } from './whatsapp.js';

export { createDiscordAdapter, ASK_COMMAND } from './discord.js';
export { createSlackAdapter } from './slack.js';
export { createTelegramAdapter } from './telegram.js';
export { createWhatsAppAdapter } from './whatsapp.js';
export { createPlannedAdapter, PLANNED_PLATFORMS } from './planned.js';

/** Only adapters that are enabled, fully configured and have an owner allowlist. Planned platforms are never built. */
export function buildAdapters(config: GatewayConfig, deps: { fetch?: typeof fetch } = {}): Map<Platform, ChannelAdapter> {
  const map = new Map<Platform, ChannelAdapter>();
  if (config.slack) map.set('slack', createSlackAdapter(config.slack, deps));
  if (config.telegram) map.set('telegram', createTelegramAdapter(config.telegram, deps));
  if (config.whatsapp) map.set('whatsapp', createWhatsAppAdapter(config.whatsapp, deps));
  if (config.discord) map.set('discord', createDiscordAdapter(config.discord, deps));
  return map;
}
