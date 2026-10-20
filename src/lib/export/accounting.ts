/**
 * Boekhoudexport. Bron = alleen AFGESLOTEN dagen (Z-rapporten) en de
 * onwijzigbare bonnen daarvan, zodat een export nooit meer verandert.
 *
 * Journaalpost per dag (boekstuk = Z-nummer):
 *   Debet  1000 Kas                       contant ontvangen (netto)
 *   Debet  1150 Tussenrekening Mollie     pinomzet (bruto, netto na refunds)
 *   Credit 8000/8010/8020 Omzet            omzet excl. btw per tarief
 *   Credit 1600/1610 Af te dragen btw      btw per tarief
 *   + kasverschil (8990) en afromen/bijvullen (1090) als aparte regels
 *
 * Journaalpost per Mollie-uitbetaling (boekstuk = settlement-referentie):
 *   Debet  1100 Bank                      uitbetaald bedrag
 *   Debet  4610 Transactiekosten          kosten excl. btw
 *   Debet  1520 Voorbelasting             btw op kosten
 *   Credit 1150 Tussenrekening Mollie     bruto bedrag (uitbetaald + kosten)
 * Zo loopt 1150 leeg zodra Mollie alles heeft uitbetaald.
 *
 * Rekeningnummers komen uit Beheer → Grootboek (instelbaar).
 */
import { prisma } from '../prisma';
import { shopDayRange } from '../time';

export interface Period {
  /** "2026-10-01" (inclusief) */
  from: string;
  /** "2026-10-31" (inclusief) */
  to: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parsePeriod(from: string | null, to: string | null): Period {
  if (!from || !to || !DATE.test(from) || !DATE.test(to)) throw new Error('Kies een geldige periode (van en tot)');
  if (from > to) throw new Error('De begindatum ligt na de einddatum');
  return { from, to };
}

/** "2026-10" → 1 t/m laatste dag van de maand */
export function monthPeriod(month: string): Period {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) throw new Error('Ongeldige maand');
  const last = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

export const VAT_CODES = ['HOOG', 'LAAG', 'NUL'] as const;
export const VAT_LABEL: Record<string, string> = { HOOG: '21%', LAAG: '9%', NUL: '0%' };
/** Rubriek op de btw-aangifte (ter info; de boekhouder beslist) */
export const VAT_RUBRIEK: Record<string, string> = { HOOG: '1a', LAAG: '1b', NUL: '1e / vrijgesteld (controleren)' };

// ===========================================================================

export async function loadAccounts() {
  const [accounts, vatRates] = await Promise.all([prisma.ledgerAccount.findMany(), prisma.vatRate.findMany()]);
  const byPurpose = (purpose: string) => accounts.find((a) => a.purpose === purpose && a.active) ?? accounts.find((a) => a.purpose === purpose);
  const need = (purpose: string) => {
    const a = byPurpose(purpose);
    if (!a) throw new Error(`Geen grootboekrekening ingesteld voor ${purpose} (Beheer → Grootboek)`);
    return a;
  };
  const name = new Map(accounts.map((a) => [a.code, a.name]));
  return {
    cash: need('CASH'),
    clearing: need('MOLLIE_CLEARING'),
    bank: need('BANK'),
    fees: need('PAYMENT_FEES'),
    vatReceivable: need('VAT_RECEIVABLE'),
    difference: need('CASH_DIFFERENCE'),
    transfer: need('CASH_TRANSFER'),
    /** Huidige koppeling btw-code → omzet- en btw-rekening */
    vat: new Map(vatRates.map((v) => [v.code, { revenue: v.revenueAccountCode, vat: v.vatAccountCode }])),
    name: (code: string) => name.get(code) ?? '',
  };
}

export async function loadPeriod(period: Period) {
  const days = await prisma.businessDay.findMany({
    where: { date: { gte: period.from, lte: period.to } },
    include: {
      zReport: { include: { vatLines: true, mollieLines: { include: { user: { select: { name: true } } } } } },
    },
    orderBy: { date: 'asc' },
  });
  const closed = days.filter((d) => d.status === 'CLOSED' && d.zReport);
  const open = days.filter((d) => !(d.status === 'CLOSED' && d.zReport)).map((d) => d.date);

  const orders = await prisma.order.findMany({
    where: { businessDayId: { in: closed.map((d) => d.id) }, number: { not: null } },
    include: {
      businessDay: { select: { date: true } },
      vatLines: true,
      payments: { where: { status: 'PAID' }, include: { employee: { select: { name: true } } } },
      cashier: { select: { name: true } },
      creditOf: { select: { number: true } },
    },
    orderBy: { numberedAt: 'asc' },
  });

  const range = { from: shopDayRange(period.from).from, until: shopDayRange(period.to).until };
  const settlements = await prisma.mollieSettlement.findMany({
    where: { OR: [{ settledAt: { gte: range.from, lt: range.until } }, { settledAt: null, createdAt: { gte: range.from, lt: range.until } }] },
    include: { lines: true },
    orderBy: { createdAt: 'asc' },
  });

  return { closed, open, orders, settlements };
}

export type PeriodData = Awaited<ReturnType<typeof loadPeriod>>;

// ===========================================================================
//  Tabellen
// ===========================================================================

export function dayRows(data: PeriodData) {
  return data.closed.map((d) => {
    const z = d.zReport!;
    const vat = (code: string) => z.vatLines.find((v) => v.vatCode === code);
    return {
      datum: d.date,
      zRapport: z.number,
      bonnen: z.saleCount,
      creditbonnen: z.creditCount,
      geannuleerd: z.voidedCount,
      omzetIncl: z.grossRevenueCents,
      omzetExcl: z.netRevenueCents,
      btw: z.vatTotalCents,
      ...Object.fromEntries(
        VAT_CODES.flatMap((c) => [
          [`omzetExcl_${c}`, vat(c)?.totalExclCents ?? 0],
          [`btw_${c}`, vat(c)?.vatCents ?? 0],
        ]),
      ),
      contant: z.paymentsTotalCents - z.mollieTotalCents,
      pin: z.mollieTotalCents,
      pinVolgensMollie: z.mollieApiTotalCents,
      pinVerschil: z.mollieDifferenceCents,
      beginsaldo: z.openingFloatCents,
      bijgevuld: z.cashInCents,
      afgeroomd: z.cashOutCents,
      kasTheoretisch: z.expectedCashCents,
      kasGeteld: z.countedCashCents,
      kasverschil: z.cashDifferenceCents,
      toelichting: z.cashDifferenceNote ?? '',
      korting: z.discountTotalCents,
      ladeZonderVerkoop: z.noSaleCount,
    } as Record<string, string | number | null>;
  });
}

export function orderRows(data: PeriodData) {
  return data.orders.map((o) => {
    const vat = (code: string) => o.vatLines.find((v) => v.vatCode === code);
    const time = (o.paidAt ?? o.numberedAt ?? o.createdAt).toLocaleTimeString('nl-NL', { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit' });
    return {
      bonnummer: o.number,
      datum: o.businessDay.date,
      tijd: time,
      soort: o.type === 'CREDIT' ? 'Creditbon' : 'Verkoop',
      status: o.status === 'PAID' ? 'Betaald' : o.status === 'VOIDED' ? 'Geannuleerd' : o.status,
      medewerker: o.cashier.name,
      totaalIncl: o.status === 'PAID' ? o.totalInclCents : 0,
      totaalExcl: o.status === 'PAID' ? o.subtotalExclCents : 0,
      btw: o.status === 'PAID' ? o.vatCents : 0,
      ...Object.fromEntries(VAT_CODES.map((c) => [`incl_${c}`, o.status === 'PAID' ? vat(c)?.totalInclCents ?? 0 : 0])),
      contant: o.payments.filter((p) => p.method === 'CASH').reduce((s, p) => s + p.amountCents, 0),
      pin: o.payments.filter((p) => p.method === 'MOLLIE').reduce((s, p) => s + p.amountCents, 0),
      pinMedewerker: [...new Set(o.payments.filter((p) => p.method === 'MOLLIE').map((p) => p.employee.name))].join(', '),
      molliePaymentId: o.payments.map((p) => p.molliePaymentId ?? p.reconciledMolliePaymentId ?? p.mollieRefundId).filter(Boolean).join(', '),
      korting: o.discountCents,
      creditVan: o.creditOf?.number ?? '',
      reden: o.voidReason ?? (o.type === 'CREDIT' ? o.note ?? '' : ''),
    } as Record<string, string | number | null>;
  });
}

export function vatTotals(data: PeriodData) {
  return VAT_CODES.map((code) => {
    const lines = data.closed.flatMap((d) => d.zReport!.vatLines.filter((v) => v.vatCode === code));
    return {
      code,
      tarief: VAT_LABEL[code],
      rubriek: VAT_RUBRIEK[code],
      omzetExcl: lines.reduce((s, v) => s + v.totalExclCents, 0),
      btw: lines.reduce((s, v) => s + v.vatCents, 0),
      omzetIncl: lines.reduce((s, v) => s + v.totalInclCents, 0),
    };
  }).filter((r) => r.omzetIncl !== 0 || r.btw !== 0);
}

export function settlementRows(data: PeriodData) {
  return data.settlements.map((s) => ({
    referentie: s.reference,
    mollieId: s.id,
    status: s.status,
    aangemaakt: s.createdAt.toISOString().slice(0, 10),
    uitbetaald: s.settledAt ? s.settledAt.toISOString().slice(0, 10) : '',
    omzetBruto: s.revenueGrossCents,
    kostenExcl: s.costsNetCents,
    kostenBtw: s.costsVatCents,
    kostenIncl: s.costsGrossCents,
    uitbetaaldBedrag: s.amountCents,
    factuur: s.invoiceId ?? '',
  }));
}

// ===========================================================================
//  Journaal (dubbel boekhouden)
// ===========================================================================

export interface JournalLine {
  datum: string;
  dagboek: 'Kas' | 'Memoriaal' | 'Bank';
  boekstuk: string;
  rekening: string;
  rekeningNaam: string;
  omschrijving: string;
  debet: number;
  credit: number;
  btwCode: string;
}

export async function journalLines(data: PeriodData): Promise<JournalLine[]> {
  const acc = await loadAccounts();
  const lines: JournalLine[] = [];

  const post = (base: Omit<JournalLine, 'debet' | 'credit' | 'rekeningNaam'>, amount: number) => {
    if (amount === 0) return;
    lines.push({ ...base, rekeningNaam: acc.name(base.rekening), debet: amount > 0 ? amount : 0, credit: amount < 0 ? -amount : 0 });
  };

  for (const d of data.closed) {
    const z = d.zReport!;
    const base = { datum: d.date, dagboek: 'Kas' as const, boekstuk: z.number, btwCode: '' };
    const cash = z.paymentsTotalCents - z.mollieTotalCents;

    post({ ...base, rekening: acc.cash.code, omschrijving: `Contante ontvangsten ${z.number}` }, cash);
    post({ ...base, rekening: acc.clearing.code, omschrijving: `Pinomzet Mollie Tap to Pay ${z.number}` }, z.mollieTotalCents);
    for (const v of z.vatLines) {
      const map = acc.vat.get(v.vatCode);
      post({ ...base, rekening: map?.revenue ?? v.revenueAccountCode, omschrijving: `Omzet ${VAT_LABEL[v.vatCode] ?? v.vatCode} ${z.number}`, btwCode: v.vatCode }, -v.totalExclCents);
      const vatAccount = map?.vat ?? v.vatAccountCode;
      if (vatAccount) post({ ...base, rekening: vatAccount, omschrijving: `Btw ${VAT_LABEL[v.vatCode] ?? v.vatCode} ${z.number}`, btwCode: v.vatCode }, -v.vatCents);
    }
    if (z.cashDifferenceCents !== 0) {
      const note = z.cashDifferenceNote ? ` (${z.cashDifferenceNote})` : '';
      post({ ...base, rekening: acc.cash.code, omschrijving: `Kasverschil ${z.number}${note}` }, z.cashDifferenceCents);
      post({ ...base, rekening: acc.difference.code, omschrijving: `Kasverschil ${z.number}${note}` }, -z.cashDifferenceCents);
    }
    if (z.cashOutCents !== 0) {
      post({ ...base, rekening: acc.transfer.code, omschrijving: `Afgeroomd naar kluis ${z.number}` }, -z.cashOutCents);
      post({ ...base, rekening: acc.cash.code, omschrijving: `Afgeroomd naar kluis ${z.number}` }, z.cashOutCents);
    }
    if (z.cashInCents !== 0) {
      post({ ...base, rekening: acc.cash.code, omschrijving: `Wisselgeld bijgevuld ${z.number}` }, z.cashInCents);
      post({ ...base, rekening: acc.transfer.code, omschrijving: `Wisselgeld bijgevuld ${z.number}` }, -z.cashInCents);
    }
  }

  for (const s of data.settlements) {
    if (s.status === 'open') continue;
    const datum = (s.settledAt ?? s.createdAt).toISOString().slice(0, 10);
    const base = { datum, dagboek: 'Bank' as const, boekstuk: s.reference, btwCode: '' };
    post({ ...base, rekening: acc.bank.code, omschrijving: `Uitbetaling Mollie ${s.reference}` }, s.amountCents);
    post({ ...base, rekening: acc.fees.code, omschrijving: `Transactiekosten Mollie ${s.reference}` }, s.costsNetCents);
    post({ ...base, rekening: acc.vatReceivable.code, omschrijving: `Btw op Mollie-kosten ${s.reference}`, btwCode: 'VOORBELASTING' }, s.costsVatCents);
    post({ ...base, rekening: acc.clearing.code, omschrijving: `Afboeking tussenrekening ${s.reference}` }, -(s.amountCents + s.costsGrossCents));
  }

  // Elke boekstuk moet sluiten; zo niet, dan is er een fout in de kassa (niet stil exporteren)
  const balance = new Map<string, number>();
  for (const l of lines) balance.set(l.boekstuk, (balance.get(l.boekstuk) ?? 0) + l.debet - l.credit);
  for (const [boekstuk, diff] of balance) {
    if (diff !== 0) throw new Error(`Journaalpost ${boekstuk} sluit niet (verschil ${diff} cent). Export afgebroken.`);
  }
  return lines;
}

/** Saldo van de tussenrekening Mollie in de periode (pin geboekt − afgeboekt door uitbetalingen). */
export function clearingSummary(data: PeriodData) {
  const pin = data.closed.reduce((s, d) => s + d.zReport!.mollieTotalCents, 0);
  const settled = data.settlements.filter((s) => s.status !== 'open').reduce((s, x) => s + x.amountCents + x.costsGrossCents, 0);
  const fees = data.settlements.reduce((s, x) => s + x.costsGrossCents, 0);
  return { pinCents: pin, settledGrossCents: settled, feesCents: fees, openCents: pin - settled };
}
