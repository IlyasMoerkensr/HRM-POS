import type { Account } from '@prisma/client';

import { prisma } from '../prisma';
import { getAccount } from './accounts';
import { getActiveEmployeeId, isPairedDevice } from './session';

export type ReportAccess =
  | { via: 'account'; account: Account; name: string }
  | { via: 'kassa'; userId: string; name: string; role: 'MEDEWERKER' | 'MANAGER' | 'ADMIN' };

/**
 * Toegang tot Z-rapporten en export:
 *  - ingelogd met e-mail (eigenaar, beheerder of boekhouder) — ook op afstand
 *  - of op de gekoppelde kassa-pc met een medewerker (voor export: manager/beheerder)
 */
export async function getReportAccess(opts: { needManager?: boolean } = {}): Promise<ReportAccess | null> {
  const account = await getAccount();
  if (account) return { via: 'account', account, name: account.name };
  if (!(await isPairedDevice())) return null;
  const id = await getActiveEmployeeId();
  const user = id ? await prisma.user.findUnique({ where: { id } }) : null;
  if (!user || !user.active) return null;
  if (opts.needManager && user.role === 'MEDEWERKER') return null;
  return { via: 'kassa', userId: user.id, name: user.name, role: user.role };
}
