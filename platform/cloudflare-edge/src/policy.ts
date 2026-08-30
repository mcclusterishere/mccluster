export const MAX_KNOWLEDGE_BYTES = 25 * 1024 * 1024;

const KNOWLEDGE_CONTENT_TYPES = new Set([
  "application/json",
  "application/pdf",
  "text/csv",
  "text/html",
  "text/markdown",
  "text/plain",
]);

export function normalizeTenantId(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(normalized)) {
    throw new Error("tenantId must be 1-63 lowercase letters, numbers, or hyphens");
  }
  return normalized;
}

export function normalizeObjectPath(value: string): string {
  const parts = value.normalize("NFKC").split("/");
  if (!parts.length || parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error("object path contains an empty or unsafe segment");
  }

  const clean = parts.map((part) => {
    const trimmed = part.trim();
    if (!trimmed || trimmed.length > 160 || /[\u0000-\u001f\u007f]/.test(trimmed)) {
      throw new Error("object path contains an invalid segment");
    }
    return trimmed;
  });

  const path = clean.join("/");
  if (path.length > 900) throw new Error("object path is too long");
  return path;
}

export function knowledgeKey(tenantId: string, path: string): string {
  return `tenants/${normalizeTenantId(tenantId)}/knowledge/${normalizeObjectPath(path)}`;
}

export function tenantSearchInstanceId(tenantId: string): string {
  return `tenant-${normalizeTenantId(tenantId)}`;
}

export function isKnowledgeContentType(value: string): boolean {
  return KNOWLEDGE_CONTENT_TYPES.has(value.split(";", 1)[0].trim().toLowerCase());
}
