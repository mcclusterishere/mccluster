import { createToolRegistry } from './tools/registry.mjs';
import { createCapabilityRegistry } from './capabilities/registry.mjs';

const DEFAULT_REQUIRED = [
  'image.generate',
  'video.generate',
  'audio.generate',
  'model3d.generate',
  'world.generate',
  'deploy.preview'
];

function requiredCapabilities() {
  const raw = process.env.MCCLUSTER_SOVEREIGN_AUDIT_CAPABILITIES;
  if (!raw) return DEFAULT_REQUIRED;
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === 'string' && value.trim())) {
    throw new Error('MCCLUSTER_SOVEREIGN_AUDIT_CAPABILITIES must be a JSON string array');
  }
  return [...new Set(parsed.map((value) => value.trim()))];
}

function sovereign(binding) {
  const hosting = binding?.economics?.hosting;
  const billing = binding?.economics?.billing;
  return ['owned', 'self-hosted'].includes(hosting)
    && ['free', 'compute'].includes(billing)
    && binding?.provider !== 'fal';
}

async function main() {
  const toolRegistry = createToolRegistry();
  const capabilityRegistry = createCapabilityRegistry({ toolRegistry });
  const required = requiredCapabilities();
  const checks = [];

  for (const capability of required) {
    try {
      const resolved = await capabilityRegistry.resolve(capability, { force: true, preferOwned: true });
      checks.push({
        capability,
        ok: sovereign(resolved.binding),
        binding: resolved.binding.id,
        provider: resolved.binding.provider,
        tool: resolved.binding.tool,
        hosting: resolved.binding.economics?.hosting || null,
        billing: resolved.binding.economics?.billing || null,
        alternatives: resolved.alternatives.map((item) => ({
          id: item.id,
          provider: item.provider,
          hosting: item.economics?.hosting || null,
          billing: item.economics?.billing || null
        }))
      });
    } catch (error) {
      checks.push({ capability, ok: false, error: error.message, code: error.code || null });
    }
  }

  const violations = checks.filter((check) => !check.ok);
  const report = {
    ok: violations.length === 0,
    mode: 'sovereign-media',
    checked_at: new Date().toISOString(),
    required,
    checks,
    violations: violations.map((item) => item.capability)
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 2;
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  process.exitCode = 1;
});
