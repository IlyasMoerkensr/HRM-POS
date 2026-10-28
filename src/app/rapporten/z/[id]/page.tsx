import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { getReportAccess } from '@/lib/auth/access';
import { formatEUR } from '@/lib/money';
import { prisma } from '@/lib/prisma';
import { DENOMINATIONS } from '@/lib/reports/daySummary';
import { getSetting } from '@/lib/settings';

import { PrintButton } from './PrintButton';

export const dynamic = 'force-dynamic';

const VAT: Record<string, string> = { HOOG: '21%', LAAG: '9%', NUL: '0%' };

function Row({ label, cents, bold, muted }: { label: string; cents: number | null; bold?: boolean; muted?: boolean }) {
  return (
    <tr className={`${bold ? 'font-bold' : ''} ${muted ? 'text-slate-500' : ''}`}>
      <td className="py-0.5 pr-4">{label}</td>
      <td className="py-0.5 text-right tabular">{cents === null ? '—' : formatEUR(cents)}</td>
    </tr>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="break-inside-avoid">
      <h2 className="mb-1 border-b border-slate-300 pb-1 text-sm font-bold tracking-wide uppercase">{title}</h2>
      {children}
    </section>
  );
}

/** Z-rapport, geschikt om af te drukken of als PDF op te slaan voor de boekhouder. */
export default async function ZReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await getReportAccess();
  if (!access) redirect(`/login?next=/rapporten/z/${id}`);
  const z = await prisma.zReport.findUnique({
    where: { id },
    include: {
      businessDay: { include: { openedBy: { select: { name: true } } } },
      createdBy: { select: { name: true } },
      vatLines: { orderBy: { vatRateBp: 'desc' } },
      mollieLines: { include: { user: { select: { name: true } } } },
    },
  });
  if (!z) notFound();
  const company = await getSetting('company.name', 'Kassa');
  const accounts = await prisma.ledgerAccount.findMany({ where: { purpose: { in: ['CASH', 'MOLLIE_CLEARING'] } } });
  const account = (purpose: string) => accounts.find((a) => a.purpose === purpose)?.code ?? '?';
  const count = JSON.parse(z.cashCountJson) as Record<string, number>;
  const dateText = new Date(`${z.businessDay.date}T12:00:00`).toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const date = dateText.charAt(0).toUpperCase() + dateText.slice(1) + (z.businessDay.sequence > 1 ? ` · periode ${z.businessDay.sequence}` : '');
  const cashCents = z.paymentsTotalCents - z.mollieTotalCents;

  return (
    <div className="min-h-dvh bg-slate-100 print:bg-white">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 p-4 print:hidden">
        <div className="flex gap-2">
          {access.via === 'kassa' && (
            <Link href="/kassa" className="rounded-xl bg-slate-900 px-4 py-2 font-semibold text-white">
              ← Kassa
            </Link>
          )}
          <Link href="/rapporten" className="rounded-xl bg-white px-4 py-2 font-semibold ring-1 ring-slate-300">
            Alle Z-rapporten
          </Link>
        </div>
        <PrintButton />
      </div>

      <article className="mx-auto max-w-3xl space-y-5 bg-white p-8 text-[13px] shadow-sm print:max-w-none print:p-0 print:shadow-none">
        <header className="flex items-start justify-between border-b-2 border-slate-900 pb-3">
          <div>
            <div className="text-xs tracking-widest text-slate-500 uppercase">{company}</div>
            <h1 className="text-2xl font-extrabold">Z-rapport {z.number}</h1>
            <div>{date}</div>
          </div>
          <div className="text-right text-xs text-slate-600">
            Geopend door {z.businessDay.openedBy.name} om {z.businessDay.openedAt.toLocaleTimeString('nl-NL', { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit' })}
            <br />
            Afgesloten door {z.createdBy.name}
            <br />
            {z.createdAt.toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam' })}
          </div>
        </header>

        <div className="grid gap-6 sm:grid-cols-2 print:grid-cols-2">
          <Section title="Omzet">
            <table className="w-full">
              <tbody>
                <Row label="Omzet incl. btw" cents={z.grossRevenueCents} bold />
                <Row label="Omzet excl. btw" cents={z.netRevenueCents} />
                <Row label="Btw totaal" cents={z.vatTotalCents} />
                <Row label="Waarvan korting gegeven" cents={z.discountTotalCents} muted />
              </tbody>
            </table>
            <p className="mt-1 text-xs text-slate-500">
              {z.saleCount} bonnen · {z.creditCount} creditbonnen · {z.voidedCount} geannuleerd · {z.noSaleCount}× lade zonder verkoop
            </p>
          </Section>

          <Section title="Betaalwijzen">
            <table className="w-full">
              <tbody>
                <Row label="Contant" cents={cashCents} />
                <Row label="Pin (Mollie Tap to Pay)" cents={z.mollieTotalCents} />
                <Row label="Totaal ontvangen" cents={z.paymentsTotalCents} bold />
              </tbody>
            </table>
          </Section>
        </div>

        <Section title="Btw-specificatie">
          <table className="w-full">
            <thead className="text-left text-xs text-slate-500">
              <tr>
                <th>Tarief</th>
                <th>Omzetrekening</th>
                <th>Btw-rekening</th>
                <th className="text-right">Omzet excl.</th>
                <th className="text-right">Btw</th>
                <th className="text-right">Incl. btw</th>
              </tr>
            </thead>
            <tbody>
              {z.vatLines.map((v) => (
                <tr key={v.id}>
                  <td className="py-0.5">{VAT[v.vatCode] ?? `${v.vatRateBp / 100}%`}</td>
                  <td>{v.revenueAccountCode}</td>
                  <td>{v.vatAccountCode ?? '—'}</td>
                  <td className="text-right tabular">{formatEUR(v.totalExclCents)}</td>
                  <td className="text-right tabular">{formatEUR(v.vatCents)}</td>
                  <td className="text-right tabular">{formatEUR(v.totalInclCents)}</td>
                </tr>
              ))}
              <tr className="border-t border-slate-300 font-bold">
                <td className="py-0.5" colSpan={3}>
                  Totaal
                </td>
                <td className="text-right tabular">{formatEUR(z.netRevenueCents)}</td>
                <td className="text-right tabular">{formatEUR(z.vatTotalCents)}</td>
                <td className="text-right tabular">{formatEUR(z.grossRevenueCents)}</td>
              </tr>
            </tbody>
          </table>
        </Section>

        <div className="grid gap-6 sm:grid-cols-2 print:grid-cols-2">
          <Section title="Contante kas">
            <table className="w-full">
              <tbody>
                <Row label="Beginsaldo" cents={z.openingFloatCents} />
                <Row label="+ Contante verkopen" cents={z.cashSalesCents} />
                <Row label="− Contant terugbetaald" cents={Math.abs(z.cashRefundsCents)} />
                <Row label="+ Wisselgeld bijgevuld" cents={z.cashInCents} />
                <Row label="− Afgeroomd naar kluis" cents={Math.abs(z.cashOutCents)} />
                <Row label="Theoretisch kassaldo" cents={z.expectedCashCents} bold />
                <Row label="Geteld kassaldo" cents={z.countedCashCents} bold />
                <Row label="Kasverschil" cents={z.cashDifferenceCents} bold />
              </tbody>
            </table>
            {z.cashDifferenceNote && <p className="mt-1 text-xs">Toelichting: {z.cashDifferenceNote}</p>}
          </Section>

          <Section title="Kastelling">
            <table className="w-full text-xs">
              <tbody>
                {'totaal' in count && (
                  <tr>
                    <td className="py-0.5" colSpan={2}>
                      Alleen totaal geteld
                    </td>
                    <td className="text-right tabular">{formatEUR(count.totaal)}</td>
                  </tr>
                )}
                {DENOMINATIONS.filter((d) => (count[String(d.cents)] ?? 0) > 0).map((d) => (
                  <tr key={d.cents}>
                    <td className="py-0.5">{d.label}</td>
                    <td className="text-right">{count[String(d.cents)]} ×</td>
                    <td className="text-right tabular">{formatEUR(count[String(d.cents)] * d.cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        </div>

        <Section title="Pincontrole per medewerker (Mollie Tap to Pay)">
          {z.mollieLines.length === 0 ? (
            <p className="text-slate-500">Geen pinbetalingen.</p>
          ) : (
            <table className="w-full">
              <thead className="text-left text-xs text-slate-500">
                <tr>
                  <th>Telefoon van</th>
                  <th className="text-right">Aantal kassa</th>
                  <th className="text-right">Kassa</th>
                  <th className="text-right">Mollie</th>
                  <th className="text-right">Verschil</th>
                </tr>
              </thead>
              <tbody>
                {z.mollieLines.map((m) => (
                  <tr key={m.id}>
                    <td className="py-0.5">
                      {m.user.name}
                      {m.manualCount > 0 && <span className="text-xs text-slate-500"> ({m.manualCount} handmatig)</span>}
                    </td>
                    <td className="text-right">{m.posCount}</td>
                    <td className="text-right tabular">{formatEUR(m.posAmountCents)}</td>
                    <td className="text-right tabular">{m.mollieAmountCents === null ? '—' : formatEUR(m.mollieAmountCents)}</td>
                    <td className="text-right font-semibold tabular">{m.differenceCents === null ? '—' : formatEUR(m.differenceCents)}</td>
                  </tr>
                ))}
                <tr className="border-t border-slate-300 font-bold">
                  <td className="py-0.5">Totaal</td>
                  <td />
                  <td className="text-right tabular">{formatEUR(z.mollieTotalCents)}</td>
                  <td className="text-right tabular">{z.mollieApiTotalCents === null ? '—' : formatEUR(z.mollieApiTotalCents)}</td>
                  <td className="text-right tabular">{z.mollieDifferenceCents === null ? '—' : formatEUR(z.mollieDifferenceCents)}</td>
                </tr>
              </tbody>
            </table>
          )}
          {z.mollieApiTotalCents === null && (
            <p className="mt-1 text-xs text-slate-500">Mollie-controle niet beschikbaar bij afsluiten; vergelijk met de Mollie Tap-app of het Mollie Dashboard.</p>
          )}
        </Section>

        <footer className="border-t border-slate-300 pt-2 text-xs text-slate-500">
          Dit Z-rapport is onwijzigbaar vastgelegd. Grootboek: contant → {account('CASH')}, pin → {account('MOLLIE_CLEARING')}; omzet en btw volgens de btw-specificatie.
        </footer>
      </article>
    </div>
  );
}
