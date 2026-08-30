import { describe, expect, it } from "vitest";
import {
  isKnowledgeContentType,
  knowledgeKey,
  normalizeObjectPath,
  normalizeTenantId,
  tenantSearchInstanceId,
} from "../src/policy";

describe("tenant isolation policy", () => {
  it("normalizes tenant identifiers", () => {
    expect(normalizeTenantId(" First-Baptist ")).toBe("first-baptist");
    expect(tenantSearchInstanceId("First-Baptist")).toBe("tenant-first-baptist");
  });

  it("rejects tenant and object traversal", () => {
    expect(() => normalizeTenantId("../other-tenant")).toThrow();
    expect(() => normalizeObjectPath("docs/../secret.txt")).toThrow();
    expect(() => normalizeObjectPath("docs//secret.txt")).toThrow();
  });

  it("always prefixes knowledge with the tenant boundary", () => {
    expect(knowledgeKey("client-a", "guides/start.md")).toBe(
      "tenants/client-a/knowledge/guides/start.md",
    );
  });

  it("allows only indexable knowledge formats", () => {
    expect(isKnowledgeContentType("text/markdown; charset=utf-8")).toBe(true);
    expect(isKnowledgeContentType("application/pdf")).toBe(true);
    expect(isKnowledgeContentType("application/octet-stream")).toBe(false);
  });
});
