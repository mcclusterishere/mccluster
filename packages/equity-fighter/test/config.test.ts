import { describe, expect, it } from 'vitest';
import { loadConfig, publicStatus } from '../src/config.js';
import { pairingCode, verifyPairingCode } from '../src/pairing.js';
import { baseEnv, slackEnv } from './helpers.js';

describe('configuration', () => {
  it('is off with an empty environment, and every platform is off', () => {
    const cfg = loadConfig({});
    expect(cfg.enabled).toBe(false);
    expect(cfg.statuses.every((s) => !s.enabled)).toBe(true);
  });

  it('turns a platform on only with its flag, its secrets and an owner path', () => {
    expect(loadConfig(slackEnv()).statuses.find((s) => s.platform === 'slack')).toMatchObject({ enabled: true });
    expect(loadConfig(slackEnv({ SLACK_SIGNING_SECRET: '' })).statuses.find((s) => s.platform === 'slack')?.reason).toMatch(/SLACK_SIGNING_SECRET/);
    expect(loadConfig(slackEnv({ EQUITY_FIGHTER_SLACK_ENABLED: 'false' })).slack).toBeUndefined();
    const noOwner = loadConfig(slackEnv({ EQUITY_FIGHTER_SLACK_OWNER_IDS: '', EQUITY_FIGHTER_PAIRING_SECRET: '' }));
    expect(noOwner.statuses.find((s) => s.platform === 'slack')?.enabled).toBe(false);
  });

  it('keeps WhatsApp off until the customer-service-only acknowledgement is set', () => {
    const wa = { EQUITY_FIGHTER_WHATSAPP_ENABLED: 'true', WHATSAPP_ACCESS_TOKEN: 'a', WHATSAPP_PHONE_NUMBER_ID: '1', WHATSAPP_VERIFY_TOKEN: 'v', WHATSAPP_APP_SECRET: 's', EQUITY_FIGHTER_WHATSAPP_OWNER_IDS: '1555' };
    expect(loadConfig(baseEnv(wa)).whatsapp).toBeUndefined();
    expect(loadConfig(baseEnv({ ...wa, EQUITY_FIGHTER_WHATSAPP_CUSTOMER_SERVICE_ONLY: 'true' })).whatsapp).toBeDefined();
  });

  it('never enables unimplemented platforms', () => {
    const cfg = loadConfig(baseEnv({ EQUITY_FIGHTER_SIGNAL_ENABLED: 'true', EQUITY_FIGHTER_IMESSAGE_ENABLED: 'true', EQUITY_FIGHTER_MSTEAMS_ENABLED: 'true' }));
    for (const p of ['signal', 'imessage', 'msteams']) expect(cfg.statuses.find((s) => s.platform === p)).toMatchObject({ implemented: false, enabled: false });
  });

  it('requires a transport credential and UUIDs', () => {
    expect(loadConfig(slackEnv({ EQUITY_FIGHTER_OWNER_ACCESS_TOKEN: '' })).enabled).toBe(false);
    expect(loadConfig(slackEnv({ MCCLUSTER_ORG_ID: 'house' })).enabled).toBe(false);
    const core = loadConfig(slackEnv({ EQUITY_FIGHTER_HARNESS_TRANSPORT: 'core' }));
    expect(core.enabled).toBe(false);
    expect(core.problems.join(' ')).toMatch(/CORE_BROKER_URL/);
  });

  it('reports status without any secret value', () => {
    const text = JSON.stringify(publicStatus(loadConfig(slackEnv())));
    for (const secret of ['test-slack-bot-token', 'test-slack-signing-secret', 'test-owner-session', 'test-pairing-secret', 'test-service-key']) expect(text).not.toContain(secret);
  });
});

describe('pairing codes', () => {
  it('bind to one platform account', async () => {
    const secret = 'test-pairing-secret-0123456789';
    const code = await pairingCode(secret, 'telegram', '42');
    expect(code).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
    expect(await verifyPairingCode(secret, 'telegram', '42', code.toLowerCase())).toBe(true);
    expect(await verifyPairingCode(secret, 'telegram', '43', code)).toBe(false);
    expect(await verifyPairingCode(secret, 'slack', '42', code)).toBe(false);
    expect(await verifyPairingCode('short', 'telegram', '42', code)).toBe(false);
  });
});
