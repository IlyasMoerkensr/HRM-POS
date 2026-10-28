/**
 * Dagafsluiting met Z-rapport. Na afsluiten is de dag op slot: geen bonnen,
 * betalingen of kasmutaties meer (de database bewaakt dit ook met triggers).
 */
import { audit } from '../audit';
import type { ReconciliationResult } from '../mollie/mollieService';
import { formatEUR } from '../money';
import { nextNumber } from '../numbering';
import { PosError } from '../orders/orderService';
import { prisma } from '../prisma';
import { computeDaySummary, countTotal, type CashCount } from './daySummary';

export interface CloseDayInput {
  businessDayId: string;
  userId: string;
  count: CashCount;
  note?: string | null;
  /** Resultaat van de Mollie-controle vlak vóór het afsluiten (null = niet beschikbaar) */
  reconciliation: ReconciliationResult | null;
}

export async function closeBusinessDay(input: CloseDayInput) {
  let counted: number;
  try {
    counted = countTotal(input.count);
  } catch (err) {
    throw new PosError(err instanceof Error ? err.message : String(err));
  }

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: input.userId } });
    if (!user.active) throw new PosError('Deze medewerker is niet actief');
    const day = await tx.businessDay.findUniqueOrThrow({ where: { id: input.businessDayId } });
    if (day.status !== 'OPEN') throw new PosError('Deze dag is al afgesloten');

    // Vergeten concepten zonder bonnummer (nooit afgerekend) opruimen; geparkeerde bonnen niet.
    const drafts = await tx.order.findMany({
      where: { businessDayId: day.id, number: null, status: { in: ['OPEN', 'PENDING_PAYMENT'] } },
      select: { id: true, totalInclCents: true },
    });
    for (const d of drafts) {
      await audit(tx, { action: 'ORDER_DRAFT_DISCARDED', userId: user.id, entity: 'Order', entityId: d.id, data: { reason: 'Dagafsluiting', totalInclCents: d.totalInclCents } });
      await tx.order.delete({ where: { id: d.id } });
    }

    const summary = await computeDaySummary(tx, day.id);
    const { openOrders, parkedOrders, pendingPayments } = summary.blockers;
    if (pendingPayments.length) throw new PosError(`Er loopt nog een pinbetaling (${pendingPayments.map((p) => p.orderNumber).join(', ')}). Rond die eerst af.`);
    if (openOrders.length) throw new PosError(`Nog niet afgerekende bonnen: ${openOrders.map((o) => o.number).join(', ')}. Reken af of annuleer ze eerst.`);
    if (parkedOrders.length) throw new PosError(`Er ${parkedOrders.length === 1 ? 'staat nog 1 geparkeerde bon' : `staan nog ${parkedOrders.length} geparkeerde bonnen`}. Reken af of verwijder ze eerst.`);
    if (summary.checkDifferenceCents !== 0) {
      // Zou nooit mogen gebeuren; liever niet afsluiten dan een niet-sluitende Z.
      throw new PosError(`Interne controle mislukt: betalingen wijken ${formatEUR(summary.checkDifferenceCents)} af van de omzet. Neem contact op met de beheerder.`);
    }

    const difference = counted - summary.cash.expectedCents;
    const note = input.note?.trim() || null;
    if (difference !== 0 && (!note || note.length < 3)) {
      throw new PosError(`Er is een kasverschil van ${formatEUR(difference)}. Vul een toelichting in.`);
    }

    const rec = input.reconciliation && input.reconciliation.status !== 'ERROR' ? input.reconciliation : null;
    const number = await nextNumber(tx, 'Z', Number(day.date.slice(0, 4)), 3);
    const z = await tx.zReport.create({
      data: {
        number,
        businessDayId: day.id,
        createdById: user.id,
        saleCount: summary.saleCount,
        creditCount: summary.creditCount,
        voidedCount: summary.voidedCount,
        noSaleCount: summary.noSaleCount,
        grossRevenueCents: summary.grossRevenueCents,
        netRevenueCents: summary.netRevenueCents,
        vatTotalCents: summary.vatTotalCents,
        discountTotalCents: summary.discountTotalCents,
        openingFloatCents: summary.cash.openingFloatCents,
        cashSalesCents: summary.cash.salesCents,
        cashRefundsCents: summary.cash.refundsCents,
        cashInCents: summary.cash.cashInCents,
        cashOutCents: summary.cash.cashOutCents,
        expectedCashCents: summary.cash.expectedCents,
        countedCashCents: counted,
        cashDifferenceCents: difference,
        cashCountJson: JSON.stringify(input.count),
        cashDifferenceNote: note,
        mollieTotalCents: summary.payments.mollieCents,
        mollieApiTotalCents: rec ? rec.mollieTotalCents : null,
        mollieDifferenceCents: rec ? rec.mollieTotalCents - summary.payments.mollieCents : null,
        paymentsTotalCents: summary.payments.totalCents,
        vatLines: { create: summary.vatLines },
      },
    });

    // Pincontrole per medewerker: kassa-kant + (indien beschikbaar) Mollie-kant
    const userIds = new Set([
      ...summary.mollieByEmployee.map((m) => m.userId),
      ...(rec?.perEmployee.filter((p) => p.userId).map((p) => p.userId!) ?? []),
    ]);
    for (const userId of userIds) {
      const pos = summary.mollieByEmployee.find((m) => m.userId === userId);
      const mol = rec?.perEmployee.find((p) => p.userId === userId);
      await tx.zReportMollieLine.create({
        data: {
          zReportId: z.id,
          userId,
          posCount: pos?.count ?? 0,
          posAmountCents: pos?.amountCents ?? 0,
          mollieCount: rec ? mol?.mollieCount ?? 0 : null,
          mollieAmountCents: rec ? mol?.mollieAmountCents ?? 0 : null,
          differenceCents: rec ? (mol?.mollieAmountCents ?? 0) - (pos?.amountCents ?? 0) : null,
          manualCount: pos?.manualCount ?? 0,
        },
      });
    }

    await tx.businessDay.update({ where: { id: day.id }, data: { status: 'CLOSED', closedById: user.id, closedAt: new Date() } });
    await audit(tx, {
      action: 'DAY_CLOSED',
      userId: user.id,
      entity: 'BusinessDay',
      entityId: day.id,
      data: { zNumber: number, grossRevenueCents: summary.grossRevenueCents, cashDifferenceCents: difference, mollieDifferenceCents: z.mollieDifferenceCents },
    });
    return z;
  });

  return result;
}
