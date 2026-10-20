import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getActiveEmployeeId, isPairedDevice } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';

import { BeheerApp } from './BeheerApp';

export const dynamic = 'force-dynamic';

export default async function BeheerPage() {
  if (!(await isPairedDevice())) redirect('/koppelen');
  const activeId = await getActiveEmployeeId();
  const user = activeId ? await prisma.user.findUnique({ where: { id: activeId } }) : null;
  if (!user || user.role !== 'ADMIN') {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-lg">Alleen een beheerder kan dit scherm openen. Wissel op de kassa naar een beheerder.</p>
        <Link href="/kassa" className="rounded-xl bg-slate-900 px-4 py-2 font-semibold text-white">
          Terug naar de kassa
        </Link>
      </main>
    );
  }
  return <BeheerApp />;
}
