'use server';

import { run } from '@/lib/actionResult';
import { getReportAccess } from '@/lib/auth/access';
import { AuthError } from '@/lib/auth/session';
import { audit } from '@/lib/audit';
import { settlementErrorMessage, syncSettlements } from '@/lib/mollie/mollieService';
import { PosError } from '@/lib/orders/orderService';
import { prisma } from '@/lib/prisma';
import { shopDayRange } from '@/lib/time';

/** Mollie-uitbetalingen (met ingehouden kosten) ophalen vanaf een datum. */
export async function syncSettlementsAction(fromDate: string) {
  return run(async () => {
    const access = await getReportAccess({ needManager: true });
    if (!access) throw new AuthError('Log in om uitbetalingen op te halen');
    // Een maand eerder beginnen: uitbetalingen lopen een paar dagen achter
    const since = new Date(shopDayRange(fromDate).from.getTime() - 31 * 24 * 3600 * 1000);
    try {
      const r = await syncSettlements(since);
      await audit(prisma, {
        action: 'MOLLIE_SETTLEMENTS_SYNCED',
        userId: access.via === 'kassa' ? access.userId : null,
        accountId: access.via === 'account' ? access.account.id : null,
        data: { since: since.toISOString(), count: r.synced.length, open: r.openCount, linkWarning: r.linkWarning },
      });
      return { count: r.synced.length, openCount: r.openCount, linkWarning: r.linkWarning };
    } catch (err) {
      if (err instanceof Error && err.name === 'MollieNotConfiguredError') throw new PosError(err.message);
      throw new PosError(`Uitbetalingen ophalen mislukt: ${settlementErrorMessage(err)}`);
    }
  });
}
