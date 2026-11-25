/* Platforms OpenClaw-style gateways commonly reach that Equity Fighter does
   not implement yet. Each one is registered so status reporting is honest,
   and each refuses every request: enabling one by env does nothing until a
   real, ToS-compliant adapter replaces the stub. */

import { WebhookAuthError, type ChannelAdapter, type Platform } from '../types.js';

export const PLANNED_PLATFORMS: Readonly<Record<string, { reason: string }>> = Object.freeze({
  msteams: {
    reason:
      'Planned: needs an Azure Bot registration (Bot Framework) and validation of Microsoft-signed JWTs from the Bot Connector OpenID metadata before any message is trusted.',
  },
  googlechat: {
    reason:
      'Planned: needs a Google Workspace Chat app (HTTP endpoint) and validation of Google-signed bearer JWTs; only available to Workspace accounts.',
  },
  matrix: {
    reason:
      'Planned: the Matrix client-server API is a long-lived /sync client with an access token, so it belongs in a persistent process rather than this webhook gateway.',
  },
  signal: {
    reason:
      'Not offered: Signal has no official bot API. Bridges such as signal-cli are unofficial clients that register a phone number; not used here.',
  },
  imessage: {
    reason:
      'Not offered: Apple has no public iMessage bot API. Apple Messages for Business needs an approved messaging service provider; macOS relay apps are unofficial.',
  },
});

export function createPlannedAdapter(platform: Platform): ChannelAdapter {
  const reason = PLANNED_PLATFORMS[platform]?.reason ?? 'Not implemented.';
  return {
    platform,
    implemented: false,
    async handleWebhook() {
      throw new WebhookAuthError(`${platform} is not implemented: ${reason}`, 404);
    },
    async send() {
      throw new Error(`${platform} is not implemented`);
    },
  };
}
