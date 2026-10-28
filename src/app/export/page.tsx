import { redirect } from 'next/navigation';

import { PortalHeader } from '@/components/PortalHeader';
import { getReportAccess } from '@/lib/auth/access';
import { clearingSummary, dayRows, loadPeriod, monthPeriod, parsePeriod, VAT_LABEL, VAT_RUBRIEK, vatTotals, type Period } from '@/lib/export/accounting';
import { EXPORT_KINDS } from '@/lib/export/build';
import { formatEUR } from '@/lib/money';
import { hasOrgAccessToken } from '@/lib/mollie/mollieService';
import { getSetting } from '@/lib/settings';
import { shopDateString } from '@/lib/time';

import { MollieSyncButton, PrintPageButton } from './ExportControls';

export const dynamic = 'force-dynamic';

const money = (cents: number | null) => (cents === null ? '—' : formatEUR(cents));
const nlDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' });

export default async function ExportPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const access = await getReportAccess({ needManager: true });
  if (!access) redirect('/login?next=/export');

  const sp = await searchParams;
  const month = sp.maand ?? shopDateString().slice(0, 7);
  let period: Period;
  let periodError: string | null = null;
  try {
    period = sp.van && sp.tot ? parsePeriod(sp.van, sp.tot) : monthPeriod(month);
  } catch (err) {
    periodError = err instanceof Error ? err.message : String(err);
    period = monthPeriod(shopDateString().slice(0, 7));
  }

  const [data, company, orgToken] = await Promise.all([loadPeriod(period), getSetting('company.name', 'Kassa'), Promise.resolve(hasOrgAccessToken())]);
  const days = dayRows(data);
  const vat = vatTotals(data);
  const clearing = clearingSummary(data);
  const sum = (key: string) => days.reduce((s, d) => s + (Number(d[key]) || 0), 0);
  const qs = `van=${period.from}&tot=${period.to}`;
  const title = sp.van && sp.tot ? `${nlDate(period.from)} t/m ${nlDate(period.to)}` : new Date(`${period.from}T12:00:00`).toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' });

  return (
    <div className="min-h-dvh bg-slate-100 print:bg-white">
      <PortalHeader access={access} title="Export voor de boekhouder" active="export" />

      <main className="mx-auto max-w-6xl space-y-4 p-4 print:max-w-none print:p-0 print:text-[11px]">
        {/* Periode kiezen */}
        <section className="flex flex-wrap items-end gap-4 rounded-2xl bg-white p-4 ring-1 ring-slate-200 print:hidden">
          <form method="get" className="flex items-end gap-2">
            <label className="text-sm font-semibold">
              Maand
              <input type="month" name="maand" defaultValue={sp.van ? '' : month} className="mt-1 block rounded-xl border border-slate-300 px-3 py-2" />
            </label>
            <button className="rounded-xl bg-slate-900 px-4 py-2 font-semibold text-white">Toon</button>
          </form>
          <form method="get" className="flex items-end gap-2">
            <label className="text-sm font-semibold">
              Van
              <input type="date" name="van" defaultValue={period.from} className="mt-1 block rounded-xl border border-slate-300 px-3 py-2" />
            </label>
            <label className="text-sm font-semibold">
              Tot en met
              <input type="date" name="tot" defaultValue={period.to} className="mt-1 block rounded-xl border border-slate-300 px-3 py-2" />
            </label>
            <button className="rounded-xl bg-white px-4 py-2 font-semibold ring-1 ring-slate-300">Toon periode</button>
          </form>
          <div className="ml-auto">
            <PrintPageButton />
          </div>
        </section>
        {periodError && <p className="rounded-xl bg-rose-50 px-4 py-2 text-rose-800 print:hidden">{periodError}</p>}

        {/* Downloads */}
        <section className="space-y-3 rounded-2xl bg-white p-4 ring-1 ring-slate-200 print:hidden">
          <div className="flex flex-wrap items-center gap-2">
            <a href={`/api/export?soort=alles&${qs}`} className="rounded-xl bg-emerald-600 px-4 py-3 font-bold text-white">
              ⬇ Alles in één Excel-bestand
            </a>
            {Object.entries(EXPORT_KINDS).map(([kind, label]) => (
              <a key={kind} href={`/api/export?soort=${kind}&formaat=csv&${qs}`} className="rounded-xl bg-white px-3 py-2 text-sm font-semibold ring-1 ring-slate-300">
                {label} (CSV)
              </a>
            ))}
          </div>
          <p className="text-sm text-slate-500">
            Alleen afgesloten dagen (met Z-rapport) worden geëxporteerd. CSV opent direct in Excel (puntkomma, decimale komma). Journaalposten zijn per dag en per Mollie-uitbetaling sluitend.
          </p>
          {data.open.length > 0 && (
            <p className="rounded-xl bg-amber-50 px-4 py-2 text-amber-900">
              Nog niet afgesloten en dus niet in de export: {data.open.map(nlDate).join(', ')}.
            </p>
          )}
        </section>

        {/* Maandrapport */}
        <article className="space-y-5 rounded-2xl bg-white p-6 ring-1 ring-slate-200 print:rounded-none print:p-0 print:ring-0">
          <header className="border-b-2 border-slate-900 pb-2">
            <div className="text-xs tracking-widest text-slate-500 uppercase">{company}</div>
            <h2 className="text-2xl font-extrabold">Kassarapport {title}</h2>
            <div className="text-sm text-slate-600">
              {nlDate(period.from)} t/m {nlDate(period.to)} · {data.closed.length} afgesloten dag(en) · gemaakt op {new Date().toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam' })}
            </div>
          </header>

          <div className="grid gap-6 md:grid-cols-3 print:grid-cols-3">
            <Block title="Omzet">
              <Row label="Omzet incl. btw" value={money(sum('omzetIncl'))} bold />
              <Row label="Omzet excl. btw" value={money(sum('omzetExcl'))} />
              <Row label="Btw" value={money(sum('btw'))} />
              <Row label="Korting gegeven" value={money(sum('korting'))} muted />
              <Row label="Bonnen / creditbonnen" value={`${sum('bonnen')} / ${sum('creditbonnen')}`} muted />
            </Block>
            <Block title="Ontvangen">
              <Row label="Contant" value={money(sum('contant'))} />
              <Row label="Pin (Mollie Tap to Pay)" value={money(sum('pin'))} />
              <Row label="Totaal" value={money(sum('contant') + sum('pin'))} bold />
            </Block>
            <Block title="Kas">
              <Row label="Afgeroomd naar kluis" value={money(Math.abs(sum('afgeroomd')))} />
              <Row label="Wisselgeld bijgevuld" value={money(sum('bijgevuld'))} />
              <Row label="Kasverschillen totaal" value={money(sum('kasverschil'))} bold />
            </Block>
          </div>

          <Block title="Btw-specificatie (voor de aangifte)">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr><th>Tarief</th><th>Rubriek</th><th className="text-right">Omzet excl.</th><th className="text-right">Btw</th><th className="text-right">Incl. btw</th></tr>
              </thead>
              <tbody>
                {vat.length === 0 && <tr><td colSpan={5} className="py-1 text-slate-500">Geen omzet in deze periode.</td></tr>}
                {vat.map((v) => (
                  <tr key={v.code}>
                    <td className="py-0.5">{VAT_LABEL[v.code]}</td>
                    <td>{VAT_RUBRIEK[v.code]}</td>
                    <td className="text-right tabular">{money(v.omzetExcl)}</td>
                    <td className="text-right tabular">{money(v.btw)}</td>
                    <td className="text-right tabular">{money(v.omzetIncl)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Block>

          <Block title="Per dag">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-slate-500">
                  <tr>
                    <th>Datum</th><th>Z-rapport</th><th className="text-right">Omzet</th><th className="text-right">Contant</th>
                    <th className="text-right">Pin kassa</th><th className="text-right">Pin Mollie</th><th className="text-right">Pinverschil</th><th className="text-right">Kasverschil</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {days.length === 0 && <tr><td colSpan={8} className="py-2 text-slate-500">Geen afgesloten dagen in deze periode.</td></tr>}
                  {days.map((d) => (
                    <tr key={String(d.zRapport)}>
                      <td className="py-1">{nlDate(String(d.datum))}</td>
                      <td className="font-mono">{d.zRapport}</td>
                      <td className="text-right tabular">{money(d.omzetIncl as number)}</td>
                      <td className="text-right tabular">{money(d.contant as number)}</td>
                      <td className="text-right tabular">{money(d.pin as number)}</td>
                      <td className="text-right tabular">{money(d.pinVolgensMollie as number | null)}</td>
                      <td className={`text-right tabular ${d.pinVerschil ? 'font-bold text-rose-700' : ''}`}>{money(d.pinVerschil as number | null)}</td>
                      <td className={`text-right tabular ${d.kasverschil ? 'font-bold text-rose-700' : ''}`}>{money(d.kasverschil as number)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Block>

          <Block title="Mollie-uitbetalingen en transactiekosten">
            <div className="mb-2"><MollieSyncButton from={period.from} /></div>
            {!orgToken && (
              <p className="mb-2 text-sm text-slate-500 print:hidden">
                Voor uitbetalingen en kosten is een Mollie “advanced access token” nodig (Mollie Dashboard → Developers → API keys, met de rechten settlements.read en payments.read). Zet hem in .env als MOLLIE_ORG_ACCESS_TOKEN en herstart daarna de kassa: een wijziging in .env telt pas na een herstart.
              </p>
            )}
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr><th>Referentie</th><th>Uitbetaald op</th><th className="text-right">Bruto</th><th className="text-right">Kosten excl.</th><th className="text-right">Btw kosten</th><th className="text-right">Uitbetaald</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.settlements.length === 0 && <tr><td colSpan={6} className="py-2 text-slate-500">Geen uitbetalingen opgehaald voor deze periode.</td></tr>}
                {data.settlements.map((s) => (
                  <tr key={s.id}>
                    <td className="py-1 font-mono">{s.reference}</td>
                    <td>{s.settledAt ? s.settledAt.toLocaleDateString('nl-NL') : s.status}</td>
                    <td className="text-right tabular">{money(s.revenueGrossCents)}</td>
                    <td className="text-right tabular">{money(s.costsNetCents)}</td>
                    <td className="text-right tabular">{money(s.costsVatCents)}</td>
                    <td className="text-right tabular">{money(s.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 grid gap-1 text-sm sm:max-w-md">
              <Row label="Pinomzet geboekt op tussenrekening" value={money(clearing.pinCents)} />
              <Row label="Afgeboekt door uitbetalingen (incl. kosten)" value={money(clearing.settledGrossCents)} />
              <Row label="Waarvan Mollie-kosten" value={money(clearing.feesCents)} muted />
              <Row label="Nog op tussenrekening (onderweg)" value={money(clearing.openCents)} bold />
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Mollie betaalt een paar dagen later uit; aan het eind van de maand staat het bedrag van de laatste dagen nog “onderweg”. Uitbetalingen bevatten alle Mollie-betalingen van het account (ook eventuele webshop).
            </p>
          </Block>
        </article>
      </main>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="break-inside-avoid">
      <h3 className="mb-1 border-b border-slate-300 pb-1 text-sm font-bold tracking-wide uppercase">{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, value, bold, muted }: { label: string; value: string; bold?: boolean; muted?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${bold ? 'font-bold' : ''} ${muted ? 'text-slate-500' : ''}`}>
      <span>{label}</span>
      <span className="tabular">{value}</span>
    </div>
  );
}
