import type { Config } from "../config.js";

export type TripoTextureQuality = "standard" | "detailed";

export interface CreateImageModelInput {
  imageDataUrl: string;
  fileName: string;
  textureQuality?: TripoTextureQuality;
}

export interface TripoTask {
  task_id: string;
  type?: string;
  status?: "queued" | "running" | "success" | "failed" | "cancelled" | "unknown" | "banned" | "expired";
  progress?: number;
  output?: {
    model?: string;
    base_model?: string;
    pbr_model?: string;
    rendered_image?: string;
    generated_image?: string;
    [key: string]: unknown;
  };
  consumed_credit?: number;
  error_code?: number;
  error_message?: string;
  [key: string]: unknown;
}

type ImageFormat = "png" | "jpeg" | "webp";

function providerHeaders(cfg: Config): Record<string, string> {
  if (!cfg.TRIPO_API_KEY) throw new Error("TRIPO_API_KEY is not configured");
  return { Authorization: `Bearer ${cfg.TRIPO_API_KEY}` };
}

function decodeDataUrl(dataUrl: string): { mime: string; format: ImageFormat; bytes: Uint8Array } {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw new Error("Expected a PNG, JPEG, or WebP data URL");
  const mime = match[1];
  const bytes = Uint8Array.from(Buffer.from(match[2], "base64"));
  if (!bytes.length) throw new Error("Image payload is empty");
  if (bytes.length > 20 * 1024 * 1024) throw new Error("Image exceeds Tripo's 20 MB limit");
  return { mime, format: mime.slice("image/".length) as ImageFormat, bytes };
}

async function parseProviderResponse(response: Response) {
  const body = (await response.json()) as { code?: number; data?: unknown; message?: string; suggestion?: string };
  if (!response.ok || body.code !== 0) {
    const traceId = response.headers.get("x-tripo-trace-id");
    const detail = [body.message, body.suggestion, traceId ? `trace ${traceId}` : undefined].filter(Boolean).join(" · ");
    throw new Error(detail || `Tripo request failed with HTTP ${response.status}`);
  }
  return body.data;
}

export async function uploadImageToTripo(
  cfg: Config,
  dataUrl: string,
  fileName: string,
): Promise<{ token: string; format: ImageFormat }> {
  const { mime, format, bytes } = decodeDataUrl(dataUrl);
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mime }), fileName || `reference.${format}`);

  const response = await fetch(`${cfg.TRIPO_BASE_URL}/upload/sts`, {
    method: "POST",
    headers: providerHeaders(cfg),
    body: form,
  });
  const data = (await parseProviderResponse(response)) as { image_token?: string; file_token?: string };
  const token = data?.file_token ?? data?.image_token;
  if (!token) throw new Error("Tripo did not return an upload token");
  return { token, format };
}

export async function createImageToModelTask(cfg: Config, input: CreateImageModelInput): Promise<string> {
  const { token, format } = await uploadImageToTripo(cfg, input.imageDataUrl, input.fileName);
  const response = await fetch(`${cfg.TRIPO_BASE_URL}/task`, {
    method: "POST",
    headers: { ...providerHeaders(cfg), "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "image_to_model",
      model_version: "v3.1-20260211",
      file: { type: format, file_token: token },
      texture: true,
      pbr: true,
      texture_quality: input.textureQuality ?? "standard",
      geometry_quality: "detailed",
      orientation: "align_image",
      enable_image_autofix: true,
      render_image: true,
    }),
  });
  const data = (await parseProviderResponse(response)) as { task_id?: string };
  if (!data?.task_id) throw new Error("Tripo did not return a task id");
  return data.task_id;
}

export async function getTripoTask(cfg: Config, taskId: string): Promise<TripoTask> {
  if (!/^[A-Za-z0-9-]{8,128}$/.test(taskId)) throw new Error("Invalid task id");
  const response = await fetch(`${cfg.TRIPO_BASE_URL}/task/${encodeURIComponent(taskId)}`, {
    headers: providerHeaders(cfg),
  });
  return (await parseProviderResponse(response)) as TripoTask;
}
