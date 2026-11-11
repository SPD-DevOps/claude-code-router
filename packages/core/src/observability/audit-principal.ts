import { createHash } from "node:crypto";

export const auditPrincipalHeader = "x-ccr-audit-principal";

/** Server-derived opaque key identity; never a bearer token. Clear spoofed input even when disabled. */
export function setAuditPrincipal(
  headers: Record<string, string | string[] | undefined> | undefined,
  apiKeyId: string | undefined,
  enabled = process.env.CCR_AUDIT_ENABLED === "1"
): void {
  if (!headers) return;
  for (const name of Object.keys(headers)) {
    if (name.toLowerCase() === auditPrincipalHeader) delete headers[name];
  }
  if (enabled && apiKeyId) {
    headers[auditPrincipalHeader] = createHash("sha256").update(apiKeyId).digest("hex");
  }
}
