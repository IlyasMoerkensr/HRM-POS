'use server';

import { run } from '@/lib/actionResult';
import { AuthError, requireKassaActor } from '@/lib/auth/session';
import { audit } from '@/lib/audit';
import { mollieErrorMessage, syncSettlements } from '@/lib/mollie/mollieService';
import { PosError } from '@/lib/orders/orderService';
import { prisma } from '@/lib/prisma';
import { shopDayRange } from '@/lib/time';

/** Mollie-uitbetalingen (met ingehouden kosten) ophalen vanaf een datum. */
export async function syncSettlementsAction(fromDate: string) {
  return run(async () => {
    const actor = await requireKassaActor();
    if (actor.role === 'MEDEWERKER') throw new AuthError('Alleen een manager of beheerder');
    // Een maand eerder beginnen: uitbetalingen lopen een paar dagen achter
    const since = new Date(shopDayRange(fromDate).from.getTime() - 31 * 24 * 3600 * 1000);
    try {
      const ids = await syncSettlements(since);
      await audit(prisma, { action: 'MOLLIE_SETTLEMENTS_SYNCED', userId: actor.id, data: { since: since.toISOString(), count: ids.length } });
      return { count: ids.length };
    } catch (err) {
      if (err instanceof Error && err.name === 'MollieNotConfiguredError') throw err;
      throw new PosError(`Uitbetalingen ophalen mislukt: ${mollieErrorMessage(err)}`);
    }
  });
}
