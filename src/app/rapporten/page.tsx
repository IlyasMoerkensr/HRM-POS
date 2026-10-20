import Link from 'next/link';
import { redirect } from 'next/navigation';

import { isPairedDevice } from '@/lib/auth/session';
import { formatEUR } from '@/lib/money';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export default async function RapportenPage() {
  if (!(await isPairedDevice())) redirect('/koppelen');
  const reports = await prisma.zReport.findMany({
    include: { businessDay: { select: { date: true, sequence: true } }, createdBy: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 120,
  });

  return (
    <div className="min-h-dvh">
      <header className="flex items-center gap-3 bg-slate-900 px-4 py-3 text-white">
        <Link href="/kassa" className="rounded-lg bg-slate-800 px-3 py-2 font-semibold">
          ← Kassa
        </Link>
        <h1 className="text-lg font-bold">Z-rapporten</h1>
        <Link href="/export" className="ml-auto rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold">
          Export voor de boekhouder
        </Link>
      </header>
      <main className="mx-auto max-w-5xl p-4">
        {reports.length === 0 ? (
          <p className="py-10 text-center text-slate-500">Nog geen Z-rapporten.</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl bg-white ring-1 ring-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-3 py-2">Nummer</th>
                  <th>Datum</th>
                  <th className="text-right">Omzet</th>
                  <th className="text-right">Contant</th>
                  <th className="text-right">Pin</th>
                  <th className="text-right">Kasverschil</th>
                  <th className="text-right">Pinverschil</th>
                  <th className="px-3">Afgesloten door</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {reports.map((z) => (
                  <tr key={z.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-mono">
                      <Link href={`/rapporten/z/${z.id}`} className="text-blue-700 underline">
                        {z.number}
                      </Link>
                    </td>
                    <td>
                      {new Date(`${z.businessDay.date}T12:00:00`).toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                      {z.businessDay.sequence > 1 && <span className="text-slate-500"> · periode {z.businessDay.sequence}</span>}
                    </td>
                    <td className="text-right tabular">{formatEUR(z.grossRevenueCents)}</td>
                    <td className="text-right tabular">{formatEUR(z.paymentsTotalCents - z.mollieTotalCents)}</td>
                    <td className="text-right tabular">{formatEUR(z.mollieTotalCents)}</td>
                    <td className={`text-right tabular font-semibold ${z.cashDifferenceCents === 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{formatEUR(z.cashDifferenceCents)}</td>
                    <td className={`text-right tabular font-semibold ${z.mollieDifferenceCents === null ? 'text-slate-400' : z.mollieDifferenceCents === 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {z.mollieDifferenceCents === null ? '—' : formatEUR(z.mollieDifferenceCents)}
                    </td>
                    <td className="px-3">{z.createdBy.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
