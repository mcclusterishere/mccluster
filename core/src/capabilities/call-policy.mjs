// The tool broker's per-call policy for stable capabilities, kept pure so it
// is testable without the broker's server: ai.chat images are validated at
// the edge of Core and become a vision requirement; a vision request that no
// live node can serve answers AI_CHAT_NO_VISION_NODE rather than a generic
// binding error (never a text model); and a capability whose interfaces
// exclude the calling path (browser.act is ['agent']) is refused there before
// any resolution.
import { validateChatImages } from '../compute/ai-chat-images.mjs';

const NO_NODE_CODES = new Set(['NO_CAPABILITY_BINDING', 'COMPUTE_NO_LIVE_NODE']);

export function capabilityCallPolicy(registry, name, args = {}, options = {}) {
  const capability = registry?.get?.(name);
  if (!capability || name !== 'ai.chat') return { options, vision: false, images: 0 };
  const { images } = validateChatImages(args);
  if (!images) return { options, vision: false, images: 0 };
  return {
    options: { ...options, requirements: { ...(options?.requirements || {}), vision: true } },
    vision: true,
    images
  };
}

export function mapCapabilityCallError(error, { vision = false } = {}) {
  if (!vision || !error || !NO_NODE_CODES.has(error.code)) return error;
  return Object.assign(new Error('No live node advertises a vision-capable ai.chat implementation right now; the images were not sent to a text model (AI_CHAT_NO_VISION_NODE)'), {
    status: 503, code: 'AI_CHAT_NO_VISION_NODE', retryable: false, detail: error.detail ?? null, ...(error.tried ? { tried: error.tried } : {})
  });
}

// `iface` may be one interface or a list: the loopback call route serves both
// plain HTTP callers and the agent capability client, so it accepts either;
// a capability that lists neither (workstream.checkpoint is ['mcp'], because
// only the MCP path carries the actor it needs) is refused there by name
// instead of failing later for a reason the catalog did not state.
export function requireCapabilityInterface(registry, name, iface) {
  const capability = registry?.get?.(name);
  if (!capability) return true;
  const interfaces = Array.isArray(capability.interfaces) ? capability.interfaces : [];
  const wanted = Array.isArray(iface) ? iface : [iface];
  if (wanted.some((entry) => interfaces.includes(entry))) return true;
  throw Object.assign(new Error(`Capability ${name} is not exposed over ${wanted.join(' or ')}`), { status: 403, code: 'CAPABILITY_INTERFACE_REFUSED', retryable: false });
}
