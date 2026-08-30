import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Config } from "../config.js";
import { createImageToModelTask, getTripoTask } from "./tripo.js";

const GenerateBody = z.object({
  imageDataUrl: z.string().min(32),
  fileName: z.string().min(1).max(160).default("reference.png"),
  textureQuality: z.enum(["standard", "detailed"]).default("standard"),
});

function deny(reply: FastifyReply, code: number, message: string) {
  return reply.code(code).send({ ok: false, error: message });
}

function authorize(req: FastifyRequest, reply: FastifyReply, cfg: Config): boolean {
  if (!cfg.TRIPO_API_KEY || !cfg.ASSET_LAB_TOKEN) {
    deny(reply, 503, "3D Asset Lab is not configured on this environment");
    return false;
  }
  const supplied = req.headers["x-asset-lab-token"];
  if (typeof supplied !== "string" || supplied !== cfg.ASSET_LAB_TOKEN) {
    deny(reply, 401, "Invalid Asset Lab token");
    return false;
  }
  return true;
}

export function registerThreeDRoutes(app: FastifyInstance, cfg: Config, apiVersion: string) {
  app.post(`/api/${apiVersion}/3d/generate`, async (req, reply) => {
    if (!authorize(req, reply, cfg)) return;
    const parsed = GenerateBody.safeParse(req.body);
    if (!parsed.success) return deny(reply, 400, parsed.error.issues.map((i) => i.message).join("; "));

    try {
      const taskId = await createImageToModelTask(cfg, parsed.data);
      return reply.code(202).send({ ok: true, provider: "tripo", taskId });
    } catch (error) {
      req.log.error({ error }, "3D generation task creation failed");
      return deny(reply, 502, error instanceof Error ? error.message : "3D provider request failed");
    }
  });

  app.get<{ Params: { taskId: string } }>(`/api/${apiVersion}/3d/tasks/:taskId`, async (req, reply) => {
    if (!authorize(req, reply, cfg)) return;

    try {
      const task = await getTripoTask(cfg, req.params.taskId);
      return {
        ok: true,
        provider: "tripo",
        task: {
          id: task.task_id,
          status: task.status,
          progress: task.progress ?? 0,
          modelUrl: task.output?.pbr_model ?? task.output?.model ?? task.output?.base_model ?? null,
          previewUrl: task.output?.rendered_image ?? task.output?.generated_image ?? null,
          creditsConsumed: task.consumed_credit ?? null,
          error: task.error_message ?? null,
        },
      };
    } catch (error) {
      req.log.error({ error }, "3D generation task lookup failed");
      return deny(reply, 502, error instanceof Error ? error.message : "3D provider request failed");
    }
  });
}
