import { WebhookAuthError } from '../types.js';

export const MAX_BODY_BYTES = 256 * 1024;

/** Read the raw body once (signatures cover exact bytes), bounded. */
export async function readRawBody(request: Request): Promise<string> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new WebhookAuthError('Request body too large', 413);
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) throw new WebhookAuthError('Request body too large', 413);
  return text;
}

export function parseJsonBody(raw: string): any {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new WebhookAuthError('Body is not JSON', 400);
  }
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

export function textResponse(text: string, status = 200): Response {
  return new Response(text, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

/** Trim to a platform's message limit on a character boundary. */
export function clip(text: string, max: number): string {
  const t = String(text ?? '');
  return t.length <= max ? t : `${t.slice(0, Math.max(0, max - 1))}…`;
}

export async function expectOk(res: Response, what: string): Promise<any> {
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  if (!res.ok) throw new Error(`${what} failed (${res.status})`);
  return body;
}
