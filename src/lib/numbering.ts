import type { Db } from './prisma';

/**
 * Doorlopende nummers zonder gaten. Altijd aanroepen BINNEN de transactie die
 * ook de bon/het Z-rapport opslaat: faalt die transactie, dan wordt ook de
 * ophoging teruggedraaid en ontstaat er geen gat.
 *
 *   nextNumber(tx, 'BON', 2026, 5)    → "BON-2026-00001"
 *   nextNumber(tx, 'CREDIT', 2026, 5) → "CREDIT-2026-00001"
 *   nextNumber(tx, 'Z', 2026, 3)      → "Z-2026-001"
 */
export async function nextNumber(db: Db, prefix: string, year: number, pad: number): Promise<string> {
  const key = `${prefix}-${year}`;
  const seq = await db.numberSequence.upsert({
    where: { key },
    create: { key, last: 1 },
    update: { last: { increment: 1 } },
  });
  return `${key}-${String(seq.last).padStart(pad, '0')}`;
}
