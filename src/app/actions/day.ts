'use server';

/** Kasmutaties, tussenstand (X), Mollie-controle en dagafsluiting (Z). Alleen vanaf de kassa-pc. */
import { run } from '@/lib/actionResult';
import { AuthError, requireKassaActor } from '@/lib/auth/session';
import { backupDatabase } from '@/lib/backup';
import { isMollieConfigured, reconcileBusinessDay, type ReconciliationResult } from '@/lib/mollie/mollieService';
import { registerCashMovement } from '@/lib/orders/orderService';
import { prisma } from '@/lib/prisma';
import { closeBusinessDay } from '@/lib/reports/closeDay';
import { computeDaySummary, type CashCount } from '@/lib/reports/daySummary';

export async function cashMovementAction(input: { type: 'CASH_IN' | 'CASH_OUT'; amountCents: number; reason: string }) {
  return run(async () => {
    const actor = await requireKassaActor();
    if (input.type !== 'CASH_IN' && input.type !== 'CASH_OUT') throw new AuthError('Ongeldig type');
    return registerCashMovement({ ...input, userId: actor.id });
  });
}

export async function daySummaryAction(businessDayId: string) {
  return run(async () => {
    await requireKassaActor();
    return computeDaySummary(prisma, businessDayId);
  });
}

/** Pincontrole vóór het afsluiten: kassa naast de echte Mollie-transacties. */
export async function reconcileAction(businessDayId: string) {
  return run(async () => {
    await requireKassaActor();
    if (!isMollieConfigured()) throw new AuthError('Er is geen Mollie API-sleutel ingesteld; vergelijk handmatig met de Mollie Tap-app.');
    return reconcileBusinessDay(businessDayId, 'manual');
  });
}

export async function closeDayAction(input: { businessDayId: string; count: CashCount; note: string | null }) {
  return run(async () => {
    const actor = await requireKassaActor();
    if (actor.role === 'MEDEWERKER') throw new AuthError('Alleen een manager of beheerder kan de dag afsluiten');

    // Laatste Mollie-controle meenemen in het Z-rapport (lukt dat niet, dan zonder)
    let reconciliation: ReconciliationResult | null = null;
    if (isMollieConfigured()) {
      try {
        reconciliation = await reconcileBusinessDay(input.businessDayId, 'z-report');
      } catch (err) {
        console.error('[dagafsluiting] Mollie-controle mislukt:', err);
      }
    }
    const z = await closeBusinessDay({ ...input, userId: actor.id, reconciliation });
    await backupDatabase('z-rapport').catch((err) => console.error('[backup]', err));
    return { id: z.id, number: z.number };
  });
}
