import existing from './entry.js';
import { handlePlatformApi } from './platform-api.js';
import { handlePlatformPlanApi } from './platform-api-plans.js';
import { fail } from './lib/http.js';

export { HereTenantAgent } from './here-tenant-agent.js';

export default {
  async fetch(request, env, ctx) {
    try {
      const planResponse = await handlePlatformPlanApi(request, env);
      if (planResponse) return planResponse;
      const response = await handlePlatformApi(request, env);
      if (response) return response;
    } catch (error) {
      return fail(request, env, error.message || 'Platform API request failed', error.status || 500, error.detail);
    }
    return existing.fetch(request, env, ctx);
  },
  async scheduled(controller, env, ctx) {
    if (existing.scheduled) return existing.scheduled(controller, env, ctx);
  }
};
