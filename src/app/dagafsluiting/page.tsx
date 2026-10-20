import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getActiveEmployeeId, isPairedDevice } from '@/lib/auth/session';
import { isMollieConfigured } from '@/lib/mollie/mollieService';
import { prisma } from '@/lib/prisma';
import { computeDaySummary } from '@/lib/reports/daySummary';
import { shopDateString } from '@/lib/time';

import { DagafsluitingApp } from './DagafsluitingApp';

export const dynamic = 'force-dynamic';

export default async function DagafsluitingPage() {
  if (!(await isPairedDevice())) redirect('/koppelen');
  const activeId = await getActiveEmployeeId();
  const user = activeId ? await prisma.user.findUnique({ where: { id: activeId } }) : null;
  if (!user) redirect('/kassa');

  // De lopende kassaperiode (er is er hoogstens één open)
  const day = await prisma.businessDay.findFirst({ where: { status: 'OPEN' }, orderBy: { openedAt: 'asc' } });
  if (!day) {
    const today = await prisma.businessDay.findFirst({ where: { date: shopDateString() }, orderBy: { sequence: 'desc' }, include: { zReport: true } });
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-lg">{today?.zReport ? `Vandaag is al afgesloten met ${today.zReport.number}.` : 'Er is geen open kassadag om af te sluiten.'}</p>
        <div className="flex gap-2">
          {today?.zReport && (
            <Link href={`/rapporten/z/${today.zReport.id}`} className="rounded-xl bg-blue-600 px-4 py-2 font-semibold text-white">
              Z-rapport bekijken
            </Link>
          )}
          <Link href="/kassa" className="rounded-xl bg-slate-900 px-4 py-2 font-semibold text-white">
            Terug naar de kassa
          </Link>
        </div>
      </main>
    );
  }

  const summary = await computeDaySummary(prisma, day.id);
  return (
    <DagafsluitingApp
      initial={summary}
      canClose={user.role !== 'MEDEWERKER'}
      mollieConfigured={isMollieConfigured()}
      isToday={day.date === shopDateString()}
      sequence={day.sequence}
    />
  );
}
