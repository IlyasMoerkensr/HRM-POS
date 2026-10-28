/**
 * Dagoverzicht (X-rapport = tussenstand, Z-rapport = definitief).
 * Alles wordt rechtstreeks uit de onwijzigbare bonnen, betalingen en
 * kasmutaties berekend; er worden geen tussentotalen bijgehouden die uit de pas
 * kunnen lopen.
 */
import type { Db } from '../prisma';

/** Coupures in centen, van groot naar klein. */
export const DENOMINATIONS = [
  { cents: 50000, label: '€ 500', kind: 'biljet' },
  { cents: 20000, label: '€ 200', kind: 'biljet' },
  { cents: 10000, label: '€ 100', kind: 'biljet' },
  { cents: 5000, label: '€ 50', kind: 'biljet' },
  { cents: 2000, label: '€ 20', kind: 'biljet' },
  { cents: 1000, label: '€ 10', kind: 'biljet' },
  { cents: 500, label: '€ 5', kind: 'biljet' },
  { cents: 200, label: '€ 2', kind: 'munt' },
  { cents: 100, label: '€ 1', kind: 'munt' },
  { cents: 50, label: '50 ct', kind: 'munt' },
  { cents: 20, label: '20 ct', kind: 'munt' },
  { cents: 10, label: '10 ct', kind: 'munt' },
  { cents: 5, label: '5 ct', kind: 'munt' },
  { cents: 2, label: '2 ct', kind: 'munt' },
  { cents: 1, label: '1 ct', kind: 'munt' },
] as const;

export type CashCount = Record<string, number>;

/** Sleutel voor "alleen het totaal geteld" (sneller, zonder munten en biljetten apart) */
export const TOTAL_KEY = 'totaal';

/** Telling → totaal in centen. Gooit een fout bij ongeldige aantallen. */
export function countTotal(count: CashCount): number {
  if (TOTAL_KEY in count) {
    const t = count[TOTAL_KEY];
    if (!Number.isSafeInteger(t) || t < 0 || t > 100_000_00) throw new Error('Ongeldig geteld totaal');
    if (Object.keys(count).length !== 1) throw new Error('Kies óf het totaal, óf de telling per munt en biljet');
    return t;
  }
  let total = 0;
  for (const d of DENOMINATIONS) {
    const n = count[String(d.cents)] ?? 0;
    if (!Number.isSafeInteger(n) || n < 0 || n > 100000) throw new Error(`Ongeldig aantal bij ${d.label}`);
    total += n * d.cents;
  }
  for (const key of Object.keys(count)) {
    if (!DENOMINATIONS.some((d) => String(d.cents) === key)) throw new Error(`Onbekende coupure ${key}`);
  }
  return total;
}

export interface DaySummary {
  businessDayId: string;
  date: string;
  status: 'OPEN' | 'CLOSED';
  saleCount: number;
  creditCount: number;
  voidedCount: number;
  noSaleCount: number;
  grossRevenueCents: number;
  netRevenueCents: number;
  vatTotalCents: number;
  discountTotalCents: number;
  vatLines: { vatCode: string; vatRateBp: number; revenueAccountCode: string; vatAccountCode: string | null; totalInclCents: number; vatCents: number; totalExclCents: number }[];
  cash: {
    openingFloatCents: number;
    salesCents: number;
    refundsCents: number;
    cashInCents: number;
    cashOutCents: number;
    expectedCents: number;
  };
  cashMovements: { id: string; type: string; amountCents: number; reason: string | null; userName: string; createdAt: Date; drawerOpened: boolean }[];
  payments: { cashCents: number; mollieCents: number; totalCents: number };
  /** Kassa-kant van de pincontrole, per medewerker (eigenaar van de telefoon) */
  mollieByEmployee: { userId: string; name: string; count: number; amountCents: number; manualCount: number }[];
  /** Omzet per medewerker die de bon aansloeg */
  salesByCashier: { userId: string; name: string; count: number; amountCents: number }[];
  /** Dingen die eerst opgelost moeten worden voor een Z-rapport */
  blockers: {
    openOrders: { id: string; number: string | null; totalInclCents: number; paidCents: number; cashier: string }[];
    parkedOrders: { id: string; label: string | null; totalInclCents: number; cashier: string }[];
    pendingPayments: { id: string; orderNumber: string | null; amountCents: number; employee: string }[];
  };
  /** Controle: betalingen = omzet (moet altijd 0 zijn) */
  checkDifferenceCents: number;
}

export async function computeDaySummary(db: Db, businessDayId: string): Promise<DaySummary> {
  const day = await db.businessDay.findUniqueOrThrow({ where: { id: businessDayId } });

  const [paidOrders, voidedCount, vatLines, payments, movements, openOrders] = await Promise.all([
    db.order.findMany({
      where: { businessDayId, status: 'PAID' },
      select: { id: true, type: true, totalInclCents: true, discountCents: true, cashierId: true, cashier: { select: { name: true } } },
    }),
    db.order.count({ where: { businessDayId, status: 'VOIDED' } }),
    db.orderVatLine.findMany({ where: { order: { businessDayId, status: 'PAID' } } }),
    db.payment.findMany({
      where: { status: 'PAID', order: { businessDayId, status: 'PAID' } },
      select: { method: true, amountCents: true, employeeId: true, mollieMode: true, employee: { select: { name: true } } },
    }),
    db.cashMovement.findMany({ where: { businessDayId }, include: { user: { select: { name: true } } }, orderBy: { createdAt: 'asc' } }),
    db.order.findMany({
      where: { businessDayId, status: { in: ['OPEN', 'PARKED', 'PENDING_PAYMENT'] } },
      include: { cashier: { select: { name: true } }, payments: { include: { employee: { select: { name: true } } } } },
    }),
  ]);

  // Btw per tarief
  const vatMap = new Map<string, DaySummary['vatLines'][number]>();
  for (const v of vatLines) {
    const cur = vatMap.get(v.vatCode) ?? {
      vatCode: v.vatCode, vatRateBp: v.vatRateBp, revenueAccountCode: v.revenueAccountCode, vatAccountCode: v.vatAccountCode,
      totalInclCents: 0, vatCents: 0, totalExclCents: 0,
    };
    cur.totalInclCents += v.totalInclCents;
    cur.vatCents += v.vatCents;
    cur.totalExclCents += v.totalExclCents;
    vatMap.set(v.vatCode, cur);
  }
  const vat = [...vatMap.values()].sort((a, b) => b.vatRateBp - a.vatRateBp);

  const sum = (rows: { amountCents: number }[]) => rows.reduce((s, r) => s + r.amountCents, 0);
  const byType = (t: string) => movements.filter((m) => m.type === t);

  const mollieMap = new Map<string, DaySummary['mollieByEmployee'][number]>();
  for (const p of payments.filter((x) => x.method === 'MOLLIE')) {
    const cur = mollieMap.get(p.employeeId) ?? { userId: p.employeeId, name: p.employee.name, count: 0, amountCents: 0, manualCount: 0 };
    cur.count += 1;
    cur.amountCents += p.amountCents;
    if (p.mollieMode === 'MANUAL') cur.manualCount += 1;
    mollieMap.set(p.employeeId, cur);
  }

  const cashierMap = new Map<string, DaySummary['salesByCashier'][number]>();
  for (const o of paidOrders) {
    const cur = cashierMap.get(o.cashierId) ?? { userId: o.cashierId, name: o.cashier.name, count: 0, amountCents: 0 };
    cur.count += 1;
    cur.amountCents += o.totalInclCents;
    cashierMap.set(o.cashierId, cur);
  }

  const grossRevenueCents = paidOrders.reduce((s, o) => s + o.totalInclCents, 0);
  const vatTotalCents = vat.reduce((s, v) => s + v.vatCents, 0);
  const cashCents = sum(payments.filter((p) => p.method === 'CASH'));
  const mollieCents = sum(payments.filter((p) => p.method === 'MOLLIE'));

  return {
    businessDayId: day.id,
    date: day.date,
    status: day.status,
    saleCount: paidOrders.filter((o) => o.type === 'SALE').length,
    creditCount: paidOrders.filter((o) => o.type === 'CREDIT').length,
    voidedCount,
    noSaleCount: byType('NO_SALE').length,
    grossRevenueCents,
    netRevenueCents: grossRevenueCents - vatTotalCents,
    vatTotalCents,
    discountTotalCents: paidOrders.reduce((s, o) => s + o.discountCents, 0),
    vatLines: vat,
    cash: {
      openingFloatCents: sum(byType('OPENING_FLOAT')),
      salesCents: sum(byType('SALE')),
      refundsCents: sum(byType('REFUND')),
      cashInCents: sum(byType('CASH_IN')),
      cashOutCents: sum(byType('CASH_OUT')),
      expectedCents: sum(movements),
    },
    cashMovements: movements
      .filter((m) => m.type !== 'SALE' && m.type !== 'REFUND')
      .map((m) => ({ id: m.id, type: m.type, amountCents: m.amountCents, reason: m.reason, userName: m.user.name, createdAt: m.createdAt, drawerOpened: m.drawerOpened })),
    payments: { cashCents, mollieCents, totalCents: cashCents + mollieCents },
    mollieByEmployee: [...mollieMap.values()].sort((a, b) => a.name.localeCompare(b.name, 'nl')),
    salesByCashier: [...cashierMap.values()].sort((a, b) => a.name.localeCompare(b.name, 'nl')),
    blockers: {
      openOrders: openOrders
        .filter((o) => o.status === 'PENDING_PAYMENT' && o.number)
        .map((o) => ({
          id: o.id,
          number: o.number,
          totalInclCents: o.totalInclCents,
          paidCents: sum(o.payments.filter((p) => p.status === 'PAID')),
          cashier: o.cashier.name,
        })),
      parkedOrders: openOrders
        .filter((o) => o.status === 'PARKED')
        .map((o) => ({ id: o.id, label: o.parkedLabel, totalInclCents: o.totalInclCents, cashier: o.cashier.name })),
      pendingPayments: openOrders.flatMap((o) =>
        o.payments
          .filter((p) => p.status === 'PENDING')
          .map((p) => ({ id: p.id, orderNumber: o.number, amountCents: p.amountCents, employee: p.employee.name })),
      ),
    },
    checkDifferenceCents: cashCents + mollieCents - grossRevenueCents,
  };
}
