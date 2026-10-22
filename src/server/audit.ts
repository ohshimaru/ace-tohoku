import type { Tx } from "@/db";
import { auditLog } from "@/db/schema";
import type { Actor } from "@/lib/access";

const REDACT = new Set(["password", "passwordHash", "token", "tokenHash", "content", "bytes", "accountNumber"]);

function redact(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(redact);
  if (v && typeof v === "object" && !(v instanceof Date)) {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, REDACT.has(k) ? "[REDACTED]" : redact(x)]));
  }
  return v;
}

export async function writeAudit(
  tx: Tx,
  actor: Pick<Actor, "userId" | "name"> | null,
  e: { action: string; entityType: string; entityId?: string | null; divisionId?: string | null; summary: string; changes?: unknown },
) {
  await tx.insert(auditLog).values({
    actorId: actor?.userId ?? null,
    actorName: actor?.name ?? "システム",
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId ?? null,
    divisionId: e.divisionId ?? null,
    summary: e.summary,
    changes: e.changes === undefined ? null : (redact(e.changes) as object),
  });
}

export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>) {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const [k, v] of Object.entries(after)) {
    if (k === "updatedAt") continue;
    if (JSON.stringify(before[k]) !== JSON.stringify(v)) out[k] = { from: before[k], to: v };
  }
  return out;
}
