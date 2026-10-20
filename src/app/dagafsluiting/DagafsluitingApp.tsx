'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { closeDayAction, daySummaryAction, reconcileAction } from '@/app/actions/day';
import { discardDraftAction, voidOrderAction } from '@/app/actions/pos';
import { vatLabel } from '@/components/CartView';
import { Button, cx, ErrorBox, Modal, Money } from '@/components/ui';
import { formatEUR } from '@/lib/money';
import type { ReconciliationResult } from '@/lib/mollie/mollieService';
import { DENOMINATIONS, type DaySummary } from '@/lib/reports/daySummary';

type Step = 'overzicht' | 'tellen' | 'controle';

const MOVEMENT_LABEL: Record<string, string> = {
  OPENING_FLOAT: 'Beginsaldo',
  CASH_IN: 'Wisselgeld bijgevuld',
  CASH_OUT: 'Afgeroomd',
  NO_SALE: 'Lade geopend (geen verkoop)',
};

export function DagafsluitingApp({
  initial,
  canClose,
  mollieConfigured,
  isToday,
  sequence,
}: {
  initial: DaySummary;
  canClose: boolean;
  mollieConfigured: boolean;
  isToday: boolean;
  sequence: number;
}) {
  const router = useRouter();
  const [summary, setSummary] = useState(initial);
  const [step, setStep] = useState<Step>('overzicht');
  const [count, setCount] = useState<Record<string, number>>({});
  const [note, setNote] = useState('');
  const [rec, setRec] = useState<ReconciliationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [voiding, setVoiding] = useState<{ id: string; number: string | null } | null>(null);

  const counted = useMemo(() => DENOMINATIONS.reduce((s, d) => s + (count[String(d.cents)] ?? 0) * d.cents, 0), [count]);
  const difference = counted - summary.cash.expectedCents;
  const blockers = summary.blockers.openOrders.length + summary.blockers.parkedOrders.length + summary.blockers.pendingPayments.length;

  const refresh = async () => {
    const r = await daySummaryAction(summary.businessDayId);
    if (r.ok) setSummary(r.data);
    else setError(r.error);
  };

  const guard = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const dateLabel =
    new Date(`${summary.date}T12:00:00`).toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) +
    (sequence > 1 ? ` (periode ${sequence})` : '');

  return (
    <div className="min-h-dvh">
      <header className="flex flex-wrap items-center gap-3 bg-slate-900 px-4 py-3 text-white">
        <Link href="/kassa" className="rounded-lg bg-slate-800 px-3 py-2 font-semibold">
          ← Kassa
        </Link>
        <h1 className="text-lg font-bold">Dagafsluiting · {dateLabel}</h1>
        <div className="ml-auto flex gap-1">
          {(['overzicht', 'tellen', 'controle'] as const).map((s, i) => (
            <span key={s} className={cx('rounded-lg px-3 py-1.5 text-sm font-semibold', step === s ? 'bg-white text-slate-900' : 'text-slate-400')}>
              {i + 1}. {s === 'overzicht' ? 'Tussenstand' : s === 'tellen' ? 'Kas tellen' : 'Controle & afsluiten'}
            </span>
          ))}
        </div>
        <Link href="/rapporten" className="rounded-lg px-3 py-2 text-sm font-semibold hover:bg-slate-800">
          Eerdere Z-rapporten
        </Link>
        {canClose && (
          <Link href="/export" className="rounded-lg px-3 py-2 text-sm font-semibold hover:bg-slate-800">
            Export
          </Link>
        )}
      </header>

      <main className="mx-auto max-w-5xl space-y-4 p-4">
        {!isToday && (
          <div className="rounded-xl bg-amber-100 px-4 py-3 text-amber-900">
            Deze kassadag is gestart op een eerdere datum en loopt nog. Sluit hem af; daarna start je een nieuwe dag.
          </div>
        )}
        <ErrorBox message={error} onClose={() => setError(null)} />

        {step === 'overzicht' && (
          <>
            <XReport summary={summary} />

            {blockers > 0 && (
              <section className="space-y-2 rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200">
                <h2 className="font-bold text-amber-900">Eerst afronden</h2>
                {summary.blockers.pendingPayments.map((p) => (
                  <div key={p.id} className="flex items-center justify-between rounded-lg bg-white px-3 py-2">
                    <span>Lopende pinbetaling {p.orderNumber} op telefoon van {p.employee}</span>
                    <Money cents={p.amountCents} />
                  </div>
                ))}
                {summary.blockers.openOrders.map((o) => (
                  <div key={o.id} className="flex items-center gap-3 rounded-lg bg-white px-3 py-2">
                    <span className="flex-1">
                      Niet afgerekend: {o.number} ({o.cashier}){o.paidCents !== 0 && ` — al ${formatEUR(o.paidCents)} betaald, reken het restant af op de kassa`}
                    </span>
                    <Money cents={o.totalInclCents} />
                    {o.paidCents === 0 && (
                      <Button size="sm" variant="danger" onClick={() => setVoiding({ id: o.id, number: o.number })}>
                        Annuleren
                      </Button>
                    )}
                  </div>
                ))}
                {summary.blockers.parkedOrders.map((o) => (
                  <div key={o.id} className="flex items-center gap-3 rounded-lg bg-white px-3 py-2">
                    <span className="flex-1">
                      Geparkeerd: {o.label || 'zonder naam'} ({o.cashier})
                    </span>
                    <Money cents={o.totalInclCents} />
                    <Button size="sm" variant="danger" onClick={() => guard(async () => {
                      const r = await discardDraftAction(o.id);
                      if (!r.ok) return setError(r.error);
                      await refresh();
                    })}>
                      Verwijderen
                    </Button>
                  </div>
                ))}
                <p className="text-sm text-amber-800">Geparkeerde bonnen kun je ook op de kassa ophalen en afrekenen.</p>
              </section>
            )}

            <div className="flex flex-wrap justify-end gap-2">
              <Button onClick={() => guard(refresh)}>Vernieuwen</Button>
              {canClose ? (
                <Button variant="primary" size="lg" disabled={blockers > 0} onClick={() => setStep('tellen')}>
                  Kas tellen →
                </Button>
              ) : (
                <p className="self-center text-sm text-slate-500">Afsluiten kan alleen door een manager of beheerder.</p>
              )}
            </div>
          </>
        )}

        {step === 'tellen' && (
          <section className="space-y-4">
            <p className="text-slate-600">
              Tel het geld in de lade per munt en biljet. Het verwachte bedrag zie je pas na het tellen, zodat de telling eerlijk blijft.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              {(['biljet', 'munt'] as const).map((kind) => (
                <div key={kind} className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
                  <h2 className="mb-2 font-bold">{kind === 'biljet' ? 'Biljetten' : 'Munten'}</h2>
                  <ul className="space-y-1.5">
                    {DENOMINATIONS.filter((d) => d.kind === kind).map((d) => {
                      const key = String(d.cents);
                      const n = count[key] ?? 0;
                      const set = (v: number) => setCount({ ...count, [key]: Math.max(0, Math.min(99999, v)) });
                      return (
                        <li key={key} className="flex items-center gap-2">
                          <span className="w-16 font-semibold">{d.label}</span>
                          <button type="button" className="h-11 w-11 rounded-lg bg-slate-100 text-xl font-bold active:bg-slate-300" onClick={() => set(n - 1)} aria-label={`${d.label} minder`}>
                            −
                          </button>
                          <input
                            inputMode="numeric"
                            value={n || ''}
                            onChange={(e) => set(Number(e.target.value.replace(/\D/g, '') || 0))}
                            className="h-11 w-20 rounded-lg border border-slate-300 text-center text-lg font-semibold"
                            placeholder="0"
                            aria-label={`Aantal ${d.label}`}
                          />
                          <button type="button" className="h-11 w-11 rounded-lg bg-slate-100 text-xl font-bold active:bg-slate-300" onClick={() => set(n + 1)} aria-label={`${d.label} meer`}>
                            +
                          </button>
                          <Money cents={n * d.cents} className="ml-auto text-slate-600" />
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between rounded-2xl bg-slate-900 px-5 py-4 text-white">
              <span className="text-lg">Geteld</span>
              <Money cents={counted} className="text-4xl font-extrabold" />
            </div>
            <div className="flex justify-between">
              <Button onClick={() => setStep('overzicht')}>← Terug</Button>
              <Button variant="primary" size="lg" onClick={() => setStep('controle')}>
                Telling klaar →
              </Button>
            </div>
          </section>
        )}

        {step === 'controle' && (
          <section className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2 rounded-2xl bg-white p-5 ring-1 ring-slate-200">
                <h2 className="font-bold">Contante kas</h2>
                <Line label="Verwacht (theoretisch)" cents={summary.cash.expectedCents} />
                <Line label="Geteld" cents={counted} />
                <div className={cx('flex items-baseline justify-between rounded-xl px-3 py-2', difference === 0 ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800')}>
                  <span className="font-semibold">Kasverschil</span>
                  <Money cents={difference} className="text-3xl font-extrabold" />
                </div>
                {difference !== 0 && (
                  <label className="block">
                    <span className="text-sm font-semibold">Toelichting (verplicht bij verschil)</span>
                    <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} className="mt-1 w-full rounded-xl border border-slate-300 p-2" placeholder="Bijv. €5 te veel wisselgeld gegeven" />
                  </label>
                )}
                <p className="text-sm text-slate-500">
                  Tip: laat het beginsaldo voor morgen in de lade en room de rest af naar de kluis via “Kas” op het kassascherm, vóór je telt.
                </p>
              </div>

              <div className="space-y-2 rounded-2xl bg-white p-5 ring-1 ring-slate-200">
                <div className="flex items-center justify-between">
                  <h2 className="font-bold">Pincontrole per medewerker</h2>
                  {mollieConfigured && (
                    <Button size="sm" disabled={busy} onClick={() => guard(async () => {
                      const r = await reconcileAction(summary.businessDayId);
                      if (!r.ok) return setError(r.error);
                      setRec(r.data);
                    })}>
                      Controleer met Mollie
                    </Button>
                  )}
                </div>
                <PinTable summary={summary} rec={rec} />
                {!mollieConfigured && (
                  <p className="text-sm text-slate-500">
                    Geen Mollie-koppeling: vergelijk per medewerker het bedrag met het dagtotaal in de eigen Mollie Tap-app.
                  </p>
                )}
                {rec?.status === 'ERROR' && <ErrorBox message={`Mollie-controle mislukt: ${rec.errorMessage}`} />}
                {rec && rec.issues.length > 0 && (
                  <ul className="space-y-1 text-sm">
                    {rec.issues.map((i, k) => (
                      <li key={k} className="rounded-lg bg-rose-50 px-3 py-1.5 text-rose-900">
                        {ISSUE_LABEL[i.type] ?? i.type}: {i.note ?? ''}{' '}
                        {i.posAmountCents != null && `(kassa ${formatEUR(i.posAmountCents)})`} {i.mollieAmountCents != null && `(Mollie ${formatEUR(i.mollieAmountCents)})`}
                      </li>
                    ))}
                  </ul>
                )}
                {rec?.status === 'MATCHED' && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-800">Kassa en Mollie sluiten exact.</p>}
              </div>
            </div>

            <div className="flex justify-between">
              <Button onClick={() => setStep('tellen')}>← Opnieuw tellen</Button>
              <Button variant="danger" size="lg" disabled={busy || (difference !== 0 && note.trim().length < 3)} onClick={() => setConfirmClose(true)}>
                Dag afsluiten (Z-rapport)
              </Button>
            </div>
          </section>
        )}
      </main>

      {confirmClose && (
        <Modal title="Dag definitief afsluiten?" onClose={() => setConfirmClose(false)}>
          <div className="space-y-4">
            <p>
              Na het afsluiten kun je op <strong>{dateLabel}</strong> geen bonnen, betalingen of kasmutaties meer doen. Het Z-rapport kan niet meer worden gewijzigd.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button size="lg" onClick={() => setConfirmClose(false)}>
                Nee, terug
              </Button>
              <Button variant="danger" size="lg" disabled={busy} onClick={() => guard(async () => {
                const r = await closeDayAction({ businessDayId: summary.businessDayId, count, note: note || null });
                if (!r.ok) {
                  setConfirmClose(false);
                  return setError(r.error);
                }
                router.push(`/rapporten/z/${r.data.id}`);
              })}>
                Ja, afsluiten
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {voiding && (
        <VoidDialog
          number={voiding.number}
          onClose={() => setVoiding(null)}
          onConfirm={async (reason) => {
            const r = await voidOrderAction(voiding.id, reason);
            if (!r.ok) return setError(r.error);
            setVoiding(null);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

const ISSUE_LABEL: Record<string, string> = {
  AMOUNT_MISMATCH: 'Bedrag wijkt af',
  ONLY_IN_POS: 'Alleen in kassa',
  ONLY_IN_MOLLIE: 'Alleen in Mollie',
  REFUND_ONLY_IN_POS: 'Terugstorting alleen in kassa',
  REFUND_ONLY_IN_MOLLIE: 'Terugstorting alleen in Mollie',
};

function Line({ label, cents, className }: { label: string; cents: number; className?: string }) {
  return (
    <div className={cx('flex justify-between', className)}>
      <span>{label}</span>
      <Money cents={cents} />
    </div>
  );
}

/** Tussenstand: omzet, btw, betaalwijzen, kas. */
export function XReport({ summary }: { summary: DaySummary }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section className="space-y-1.5 rounded-2xl bg-white p-5 ring-1 ring-slate-200">
        <h2 className="mb-1 font-bold">Omzet</h2>
        <Line label="Totaal incl. btw" cents={summary.grossRevenueCents} className="text-lg font-bold" />
        {summary.vatLines.map((v) => (
          <div key={v.vatCode} className="text-sm text-slate-600">
            <Line label={`${vatLabel(v.vatCode, v.vatRateBp)} — omzet excl.`} cents={v.totalExclCents} />
            <Line label={`${vatLabel(v.vatCode, v.vatRateBp)} — btw`} cents={v.vatCents} />
          </div>
        ))}
        <Line label="Totaal btw" cents={summary.vatTotalCents} />
        <Line label="Totaal korting gegeven" cents={summary.discountTotalCents} className="text-sm text-slate-600" />
        <div className="pt-2 text-sm text-slate-600">
          {summary.saleCount} bonnen · {summary.creditCount} creditbonnen · {summary.voidedCount} geannuleerd · lade {summary.noSaleCount}× zonder verkoop geopend
        </div>
      </section>

      <section className="space-y-1.5 rounded-2xl bg-white p-5 ring-1 ring-slate-200">
        <h2 className="mb-1 font-bold">Betaalwijzen</h2>
        <Line label="Contant" cents={summary.payments.cashCents} />
        <Line label="Pin (Mollie Tap to Pay)" cents={summary.payments.mollieCents} />
        <Line label="Totaal" cents={summary.payments.totalCents} className="font-bold" />
        <h2 className="mt-4 mb-1 font-bold">Kas (lade)</h2>
        <Line label="Beginsaldo" cents={summary.cash.openingFloatCents} />
        <Line label="Contante verkopen" cents={summary.cash.salesCents} />
        <Line label="Contant terugbetaald" cents={summary.cash.refundsCents} />
        <Line label="Wisselgeld bijgevuld" cents={summary.cash.cashInCents} />
        <Line label="Afgeroomd" cents={summary.cash.cashOutCents} />
      </section>

      <section className="rounded-2xl bg-white p-5 ring-1 ring-slate-200 md:col-span-2">
        <h2 className="mb-2 font-bold">Per medewerker</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="py-1">Medewerker</th>
              <th className="text-right">Bonnen</th>
              <th className="text-right">Omzet</th>
              <th className="text-right">Pinbetalingen</th>
              <th className="text-right">Gepind</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {mergeEmployees(summary).map((e) => (
              <tr key={e.userId}>
                <td className="py-1.5">{e.name}</td>
                <td className="text-right">{e.orders}</td>
                <td className="text-right tabular">{formatEUR(e.revenue)}</td>
                <td className="text-right">{e.pinCount}{e.manual > 0 && <span className="text-amber-700"> ({e.manual} handm.)</span>}</td>
                <td className="text-right tabular">{formatEUR(e.pinAmount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {summary.cashMovements.length > 0 && (
        <section className="rounded-2xl bg-white p-5 ring-1 ring-slate-200 md:col-span-2">
          <h2 className="mb-2 font-bold">Kasmutaties en ladeopeningen</h2>
          <ul className="divide-y divide-slate-100 text-sm">
            {summary.cashMovements.map((m) => (
              <li key={m.id} className="flex gap-3 py-1.5">
                <span className="w-12 text-slate-500">{new Date(m.createdAt).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}</span>
                <span className="flex-1">
                  {MOVEMENT_LABEL[m.type] ?? m.type} — {m.userName}
                  {m.reason && m.type !== 'OPENING_FLOAT' && <span className="text-slate-500"> · {m.reason}</span>}
                  {!m.drawerOpened && m.type !== 'OPENING_FLOAT' && <span className="text-amber-700"> · lade niet aangestuurd</span>}
                </span>
                {m.amountCents !== 0 && <Money cents={m.amountCents} />}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function mergeEmployees(summary: DaySummary) {
  const map = new Map<string, { userId: string; name: string; orders: number; revenue: number; pinCount: number; pinAmount: number; manual: number }>();
  for (const s of summary.salesByCashier) map.set(s.userId, { userId: s.userId, name: s.name, orders: s.count, revenue: s.amountCents, pinCount: 0, pinAmount: 0, manual: 0 });
  for (const m of summary.mollieByEmployee) {
    const e = map.get(m.userId) ?? { userId: m.userId, name: m.name, orders: 0, revenue: 0, pinCount: 0, pinAmount: 0, manual: 0 };
    e.pinCount = m.count;
    e.pinAmount = m.amountCents;
    e.manual = m.manualCount;
    map.set(m.userId, e);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'nl'));
}

function PinTable({ summary, rec }: { summary: DaySummary; rec: ReconciliationResult | null }) {
  const rows = new Map<string, { name: string; pos: number; mollie: number | null }>();
  for (const m of summary.mollieByEmployee) rows.set(m.userId, { name: m.name, pos: m.amountCents, mollie: null });
  if (rec && rec.status !== 'ERROR') {
    for (const p of rec.perEmployee) {
      const key = p.userId ?? 'onbekend';
      const row = rows.get(key) ?? { name: p.name, pos: 0, mollie: null };
      row.mollie = p.mollieAmountCents;
      rows.set(key, row);
    }
    for (const row of rows.values()) row.mollie ??= 0;
  }
  if (rows.size === 0) return <p className="text-sm text-slate-500">Vandaag geen pinbetalingen.</p>;
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-slate-500">
        <tr>
          <th className="py-1">Telefoon van</th>
          <th className="text-right">Kassa</th>
          <th className="text-right">Mollie</th>
          <th className="text-right">Verschil</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {[...rows.entries()].map(([key, r]) => {
          const diff = r.mollie === null ? null : r.mollie - r.pos;
          return (
            <tr key={key}>
              <td className="py-1.5">{r.name}</td>
              <td className="text-right tabular">{formatEUR(r.pos)}</td>
              <td className="text-right tabular">{r.mollie === null ? '—' : formatEUR(r.mollie)}</td>
              <td className={cx('text-right font-semibold tabular', diff === null ? 'text-slate-400' : diff === 0 ? 'text-emerald-700' : 'text-rose-700')}>
                {diff === null ? '—' : formatEUR(diff)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function VoidDialog({ number, onClose, onConfirm }: { number: string | null; onClose: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState('');
  return (
    <Modal
      title={`${number ?? 'Bon'} annuleren`}
      onClose={onClose}
      footer={
        <Button variant="danger" className="w-full" disabled={reason.trim().length < 3} onClick={() => onConfirm(reason)}>
          Annuleren
        </Button>
      }
    >
      <input value={reason} onChange={(e) => setReason(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2" placeholder="Reden (verplicht)" autoFocus />
    </Modal>
  );
}
