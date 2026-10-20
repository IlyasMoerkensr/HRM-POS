/**
 * Achtergrondtaken zolang de kassa-server draait (lokaal op de pc):
 *  - backup bij start en elke 4 uur
 *  - automatische Mollie-dagcontrole: elk uur kijken of gisteren al
 *    gecontroleerd is; zo niet, dan nu (vangt ook een pc op die 's nachts uit staat)
 */
import { backupDatabase } from './backup';
import { prisma } from './prisma';
import { shopDateString } from './time';

let started = false;

export function startBackgroundJobs() {
  if (started) return;
  started = true;

  const safe = (name: string, fn: () => Promise<unknown>) => () =>
    fn().catch((err) => console.error(`[${name}]`, err instanceof Error ? err.message : err));

  const backup = safe('backup', async () => {
    const file = await backupDatabase('auto');
    if (file) console.log(`[backup] ${file}`);
  });
  const reconcile = safe('mollie-controle', async () => {
    const { isMollieConfigured, reconcileBusinessDay } = await import('./mollie/mollieService');
    if (!isMollieConfigured()) return;
    const yesterday = shopDateString(new Date(Date.now() - 24 * 3600 * 1000));
    const day = await prisma.businessDay.findUnique({ where: { date: yesterday } });
    if (!day) return;
    const done = await prisma.mollieReconciliation.count({ where: { businessDayId: day.id, trigger: 'cron', status: { not: 'ERROR' } } });
    if (done > 0) return;
    const result = await reconcileBusinessDay(day.id, 'cron');
    console.log(`[mollie-controle] ${yesterday}: ${result.status}, verschil ${result.differenceCents} cent`);
  });

  setTimeout(backup, 5_000);
  setInterval(backup, 4 * 3600 * 1000);
  setTimeout(reconcile, 60_000);
  setInterval(reconcile, 3600 * 1000);
}
