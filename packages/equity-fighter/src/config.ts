/* Environment → configuration. Every platform is OFF unless its
   EQUITY_FIGHTER_<PLATFORM>_ENABLED is "true" AND every secret it needs is
   present AND it has an owner allowlist or pairing is configured. WhatsApp
   additionally needs EQUITY_FIGHTER_WHATSAPP_CUSTOMER_SERVICE_ONLY. The whole
   gateway is off unless EQUITY_FIGHTER_ENABLED is "true". Missing values are
   reported by name, never by value. */

import { PLATFORMS, type AdapterStatus, type Platform } from './types.js';
import { PLANNED_PLATFORMS } from './adapters/planned.js';
import type { SlackConfig } from './adapters/slack.js';
import type { TelegramConfig } from './adapters/telegram.js';
import type { WhatsAppConfig } from './adapters/whatsapp.js';
import type { DiscordConfig } from './adapters/discord.js';
import { DEFAULT_EDGE_MCP_URL, type HarnessTransport } from './harness/mcp-client.js';

export type Env = Record<string, string | undefined>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface GatewayConfig {
  enabled: boolean;
  problems: string[];
  orgId: string;
  ownerUserId: string;
  controlUrl: string;
  threadId?: string;
  pairingSecret: string;
  harness: HarnessTransport;
  supabase: { url: string; serviceKey: string };
  owners: Record<Platform, ReadonlySet<string>>;
  statuses: AdapterStatus[];
  slack?: SlackConfig;
  telegram?: TelegramConfig;
  whatsapp?: WhatsAppConfig;
  discord?: DiscordConfig;
}

const IMPLEMENTED: ReadonlySet<Platform> = new Set(['slack', 'telegram', 'whatsapp', 'discord']);

const REQUIRED: Record<'slack' | 'telegram' | 'whatsapp' | 'discord', string[]> = {
  slack: ['SLACK_BOT_TOKEN', 'SLACK_SIGNING_SECRET'],
  telegram: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET'],
  whatsapp: ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_VERIFY_TOKEN', 'WHATSAPP_APP_SECRET'],
  discord: ['DISCORD_APPLICATION_ID', 'DISCORD_PUBLIC_KEY'],
};

function v(env: Env, key: string): string {
  return String(env[key] ?? '').trim();
}

function flag(env: Env, key: string): boolean {
  return v(env, key).toLowerCase() === 'true';
}

export function ownerList(env: Env, platform: Platform): ReadonlySet<string> {
  return new Set(
    v(env, `EQUITY_FIGHTER_${platform.toUpperCase()}_OWNER_IDS`)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

function cfgPairing(env: Env): boolean {
  return v(env, 'EQUITY_FIGHTER_PAIRING_SECRET').length >= 16;
}

export function loadConfig(env: Env): GatewayConfig {
  const problems: string[] = [];
  const master = flag(env, 'EQUITY_FIGHTER_ENABLED');
  if (!master) problems.push('EQUITY_FIGHTER_ENABLED is not "true" (the gateway is off)');

  const orgId = v(env, 'MCCLUSTER_ORG_ID');
  const ownerUserId = v(env, 'EQUITY_FIGHTER_OWNER_USER_ID');
  if (!UUID.test(orgId)) problems.push('MCCLUSTER_ORG_ID must be the house organization UUID');
  if (!UUID.test(ownerUserId)) problems.push('EQUITY_FIGHTER_OWNER_USER_ID must be the house owner auth user UUID');

  const timeoutMs = Number(v(env, 'EQUITY_FIGHTER_HARNESS_TIMEOUT_MS')) || 60_000;
  const transportKind = v(env, 'EQUITY_FIGHTER_HARNESS_TRANSPORT') || 'edge';
  let harness: HarnessTransport;
  if (transportKind === 'core') {
    harness = { kind: 'core', baseUrl: v(env, 'CORE_BROKER_URL'), token: v(env, 'CORE_BROKER_TOKEN'), signingKey: v(env, 'CORE_EDGE_SIGNING_KEY'), timeoutMs };
    for (const key of ['CORE_BROKER_URL', 'CORE_BROKER_TOKEN', 'CORE_EDGE_SIGNING_KEY']) if (!v(env, key)) problems.push(`${key} is missing (transport core)`);
  } else {
    harness = { kind: 'edge', url: v(env, 'EQUITY_FIGHTER_HARNESS_MCP_URL') || DEFAULT_EDGE_MCP_URL, ownerAccessToken: v(env, 'EQUITY_FIGHTER_OWNER_ACCESS_TOKEN'), timeoutMs };
    if (transportKind !== 'edge') problems.push('EQUITY_FIGHTER_HARNESS_TRANSPORT must be edge or core');
    if (!harness.ownerAccessToken) problems.push('EQUITY_FIGHTER_OWNER_ACCESS_TOKEN is missing (transport edge)');
  }

  const supabase = { url: v(env, 'SUPABASE_URL'), serviceKey: v(env, 'SUPABASE_SECRET_KEY') || v(env, 'SUPABASE_SERVICE_ROLE_KEY') };
  if (!supabase.url) problems.push('SUPABASE_URL is missing');
  if (!supabase.serviceKey) problems.push('SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) is missing');

  const owners = Object.fromEntries(PLATFORMS.map((p) => [p, ownerList(env, p)])) as Record<Platform, ReadonlySet<string>>;
  const statuses: AdapterStatus[] = [];
  const cfg: GatewayConfig = {
    enabled: false,
    problems,
    orgId,
    ownerUserId,
    controlUrl: v(env, 'EQUITY_FIGHTER_CONTROL_URL') || 'https://mccluster.org/control.html',
    threadId: UUID.test(v(env, 'EQUITY_FIGHTER_THREAD_ID')) ? v(env, 'EQUITY_FIGHTER_THREAD_ID') : undefined,
    pairingSecret: v(env, 'EQUITY_FIGHTER_PAIRING_SECRET'),
    harness,
    supabase,
    owners,
    statuses,
  };

  for (const platform of PLATFORMS) {
    const wanted = flag(env, `EQUITY_FIGHTER_${platform.toUpperCase()}_ENABLED`);
    if (!IMPLEMENTED.has(platform)) {
      statuses.push({ platform, implemented: false, enabled: false, reason: PLANNED_PLATFORMS[platform]?.reason ?? 'Not implemented.' });
      continue;
    }
    const p = platform as keyof typeof REQUIRED;
    const missing = REQUIRED[p].filter((key) => !v(env, key));
    if (!wanted) {
      statuses.push({ platform, implemented: true, enabled: false, reason: `EQUITY_FIGHTER_${platform.toUpperCase()}_ENABLED is not "true"` });
      continue;
    }
    if (missing.length) {
      statuses.push({ platform, implemented: true, enabled: false, reason: `missing ${missing.join(', ')}` });
      continue;
    }
    if (p === 'whatsapp' && !flag(env, 'EQUITY_FIGHTER_WHATSAPP_CUSTOMER_SERVICE_ONLY')) {
      statuses.push({
        platform,
        implemented: true,
        enabled: false,
        reason:
          'EQUITY_FIGHTER_WHATSAPP_CUSTOMER_SERVICE_ONLY is not "true". WhatsApp Business terms bar general-purpose AI assistants (since Jan 15, 2026); confirm this number is used for McCluster Corp customer service before enabling.',
      });
      continue;
    }
    const pairable = cfgPairing(env);
    if (!owners[platform].size && !pairable) {
      statuses.push({ platform, implemented: true, enabled: false, reason: `EQUITY_FIGHTER_${platform.toUpperCase()}_OWNER_IDS is empty and pairing is off (EQUITY_FIGHTER_PAIRING_SECRET unset)` });
      continue;
    }
    statuses.push({ platform, implemented: true, enabled: true });
    if (p === 'slack') cfg.slack = { botToken: v(env, 'SLACK_BOT_TOKEN'), signingSecret: v(env, 'SLACK_SIGNING_SECRET') };
    if (p === 'telegram') cfg.telegram = { botToken: v(env, 'TELEGRAM_BOT_TOKEN'), webhookSecret: v(env, 'TELEGRAM_WEBHOOK_SECRET') };
    if (p === 'whatsapp')
      cfg.whatsapp = {
        accessToken: v(env, 'WHATSAPP_ACCESS_TOKEN'),
        phoneNumberId: v(env, 'WHATSAPP_PHONE_NUMBER_ID'),
        verifyToken: v(env, 'WHATSAPP_VERIFY_TOKEN'),
        appSecret: v(env, 'WHATSAPP_APP_SECRET'),
        graphVersion: v(env, 'WHATSAPP_GRAPH_VERSION') || 'v21.0',
      };
    if (p === 'discord')
      cfg.discord = { applicationId: v(env, 'DISCORD_APPLICATION_ID'), publicKey: v(env, 'DISCORD_PUBLIC_KEY'), botToken: v(env, 'DISCORD_BOT_TOKEN') || undefined };
  }

  cfg.enabled = master && problems.length === 0;
  return cfg;
}

/** Status without secrets, safe to log or return from /health. */
export function publicStatus(cfg: GatewayConfig) {
  return {
    service: 'equity-fighter',
    enabled: cfg.enabled,
    problems: cfg.problems,
    harness_transport: cfg.harness.kind,
    pairing: cfg.pairingSecret.length >= 16,
    platforms: cfg.statuses,
  };
}
