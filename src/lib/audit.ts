import type { Db } from './prisma';

export interface AuditEntry {
  action: string;
  userId?: string | null;
  entity?: string;
  entityId?: string;
  data?: unknown;
}

/** Audit trail: alleen toevoegen. Er bestaat bewust geen update/delete-functie. */
export async function audit(db: Db, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      action: entry.action,
      userId: entry.userId ?? null,
      entity: entry.entity,
      entityId: entry.entityId,
      data: entry.data === undefined ? null : JSON.stringify(entry.data),
    },
  });
}
