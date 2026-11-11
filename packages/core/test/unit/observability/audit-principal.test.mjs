import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { setAuditPrincipal } from "@ccr/core/observability/audit-principal.ts";
import { isSensitiveRequestLogHeaderName } from "@ccr/core/observability/sensitive-headers.ts";

test("audit principal is server derived, not a token or spoofable header", () => {
  const h = { "X-CCR-Audit-Principal": "forged", authorization: "Bearer SECRET" };
  setAuditPrincipal(h, "key-id", true);
  assert.equal(h["X-CCR-Audit-Principal"], undefined);
  assert.equal(h["x-ccr-audit-principal"], createHash("sha256").update("key-id").digest("hex"));
  assert.equal(h.authorization, "Bearer SECRET");
  assert.equal(isSensitiveRequestLogHeaderName("authorization"), true);
  assert.equal(isSensitiveRequestLogHeaderName("x-auth-api-key-id"), true);
  assert.equal(isSensitiveRequestLogHeaderName("x-ccr-audit-principal"), false);
});

test("disabled or bypass auth cannot retain a client-supplied principal", () => {
  for (const [id, enabled] of [["id", false], [undefined, true]]) {
    const h = { "x-ccr-audit-principal": "forged" };
    setAuditPrincipal(h, id, enabled);
    assert.deepEqual(h, {});
  }
});
