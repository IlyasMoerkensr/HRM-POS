import { audit } from '../audit';
import type { Db } from '../prisma';

/**
 * Sluit een bon af zodra de betaalde bedragen exact het bontotaal dekken.
 * Werkt voor verkoop (positief) en creditbon (negatief) en voor split-betalingen.
 * Idempotent: twee keer aanroepen (webhook + polling) is veilig.
 *
 * @returns true als de bon (nu of eerder) volledig betaald is.
 */
export async function settleOrderIfFullyPaid(db: Db, orderId: string, userId?: string): Promise<boolean> {
  const order = await db.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { payments: { where: { status: 'PAID' } } },
  });
  if (order.status === 'PAID') return true;
  if (order.status !== 'PENDING_PAYMENT') return false;

  const paid = order.payments.reduce((sum, p) => sum + p.amountCents, 0);
  if (paid !== order.totalInclCents) return false;

  // Voorwaardelijke update: alleen als hij nog PENDING_PAYMENT is (race-veilig)
  const result = await db.order.updateMany({
    where: { id: orderId, status: 'PENDING_PAYMENT' },
    data: { status: 'PAID', paidAt: new Date() },
  });
  if (result.count === 1) {
    await audit(db, {
      action: 'ORDER_PAID',
      userId: userId ?? order.cashierId,
      entity: 'Order',
      entityId: orderId,
      data: { number: order.number, totalInclCents: order.totalInclCents },
    });
  }
  return true;
}

/** Nog te betalen = totaal − betaald − lopende (PENDING) betalingen. */
export async function remainingToPay(db: Db, orderId: string): Promise<number> {
  const order = await db.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { payments: { where: { status: { in: ['PAID', 'PENDING'] } } } },
  });
  const covered = order.payments.reduce((sum, p) => sum + p.amountCents, 0);
  return order.totalInclCents - covered;
}
