'use server';

/**
 * Server actions voor kassa-pc en telefoon. Elke actie controleert zelf wie
 * hem uitvoert (requireKassaActor / requireAnyActor), nooit de browser.
 */
import { run, type ActionResult } from '@/lib/actionResult';
import {
  AuthError,
  clearActiveEmployee,
  pairDevice,
  phoneLogin,
  phoneLogout,
  requireAnyActor,
  requireKassaActor,
  requirePhoneActor,
  switchActiveEmployee,
} from '@/lib/auth/session';
import {
  cancelTerminalPayment,
  confirmManualTapPayment,
  isMollieConfigured,
  pendingPaymentsForPhone,
  refundViaMollie,
  startTerminalPayment,
} from '@/lib/mollie/mollieService';
import {
  backToCart,
  confirmDrawer,
  createCreditOrder,
  discardDraft,
  findOrderForReturn,
  getOrderForCheckout,
  listParkedOrders,
  loadOrderForCart,
  parkOrder,
  payCash,
  prepareCheckout,
  refundCash,
  registerNoSale,
  startBusinessDay,
  todaysOrders,
  voidOrder,
  type CartRequest,
} from '@/lib/orders/orderService';
import { prisma } from '@/lib/prisma';
import { shopDateString } from '@/lib/time';
import type { CheckoutState } from '@/lib/types';

// ===========================================================================
//  Inloggen
// ===========================================================================

export async function pairDeviceAction(code: string): Promise<ActionResult<true>> {
  return run(async () => {
    await pairDevice(code);
    return true as const;
  });
}

export async function switchEmployeeAction(userId: string, pin: string | null) {
  return run(async () => {
    const u = await switchActiveEmployee(userId, pin);
    return { id: u.id, name: u.name };
  });
}

export async function logoutEmployeeAction() {
  return run(async () => {
    await clearActiveEmployee();
    return true as const;
  });
}

export async function phoneLoginAction(input: { userId: string; pin: string; pairingCode?: string; newPin?: string }) {
  return run(async () => {
    const u = await phoneLogin(input);
    return { id: u.id, name: u.name };
  });
}

export async function phoneLogoutAction() {
  return run(async () => {
    await phoneLogout();
    return true as const;
  });
}

// ===========================================================================
//  Kassadag
// ===========================================================================

export async function startDayAction(openingFloatCents: number) {
  return run(async () => {
    const actor = await requireKassaActor();
    const day = await startBusinessDay(actor.id, openingFloatCents);
    return { id: day.id, date: day.date };
  });
}

// ===========================================================================
//  Winkelwagen, parkeren en afrekenen
// ===========================================================================

export async function parkAction(input: { orderId: string | null; cart: CartRequest; label: string }) {
  return run(async () => {
    const actor = await requireAnyActor();
    const order = await parkOrder({ orderId: input.orderId, cart: input.cart, parkedLabel: input.label, cashierId: actor.id });
    return { id: order.id };
  });
}

export async function listParkedAction() {
  return run(async () => {
    await requireAnyActor();
    const orders = await listParkedOrders();
    return orders.map((o) => ({
      id: o.id,
      label: o.parkedLabel,
      totalInclCents: o.totalInclCents,
      lineCount: o._count.lines,
      cashier: o.cashier.name,
      cashierColor: o.cashier.color,
      updatedAt: o.updatedAt,
    }));
  });
}

/** Geparkeerde bon terug in de winkelwagen. Geeft de regels terug zoals de browser ze kent. */
export async function resumeOrderAction(orderId: string) {
  return run(async () => {
    await requireAnyActor();
    const order = await loadOrderForCart(orderId);
    return {
      id: order.id,
      note: order.note,
      label: order.parkedLabel,
      discount: order.discountType && order.discountValue !== null ? { type: order.discountType, value: order.discountValue } : null,
      lines: order.lines.map((l) => ({
        productId: l.productId!,
        quantity: l.quantity,
        unitPriceInclCents: l.unitPriceInclCents,
        lineDiscountCents: l.lineDiscountCents,
        note: l.note,
      })),
    };
  });
}

export async function discardDraftAction(orderId: string) {
  return run(async () => {
    const actor = await requireAnyActor();
    await discardDraft(orderId, actor.id);
    return true as const;
  });
}

async function checkoutState(orderId: string): Promise<CheckoutState> {
  const { order, paidCents, pendingCents, remainingCents } = await getOrderForCheckout(orderId);
  return {
    orderId: order.id,
    number: order.number,
    type: order.type,
    status: order.status,
    totalInclCents: order.totalInclCents,
    paidCents,
    pendingCents,
    remainingCents,
    payments: order.payments.map((p) => ({
      id: p.id,
      method: p.method,
      status: p.status,
      amountCents: p.amountCents,
      employeeName: p.employee.name,
      mollieMode: p.mollieMode,
      changeCents: p.changeCents,
      reason: p.mollieStatusReason,
    })),
    vatLines: order.vatLines.map((v) => ({
      vatCode: v.vatCode,
      vatRateBp: v.vatRateBp,
      totalInclCents: v.totalInclCents,
      vatCents: v.vatCents,
      totalExclCents: v.totalExclCents,
    })),
    lines: order.lines.map((l) => ({ description: l.description, quantity: l.quantity, totalInclCents: l.totalInclCents })),
  };
}

export async function checkoutAction(input: { orderId: string | null; cart: CartRequest }) {
  return run(async () => {
    const actor = await requireAnyActor();
    const order = await prepareCheckout({ orderId: input.orderId, cart: input.cart, cashierId: actor.id });
    return checkoutState(order.id);
  });
}

export async function checkoutStateAction(orderId: string) {
  return run(async () => {
    await requireAnyActor();
    return checkoutState(orderId);
  });
}

export async function backToCartAction(orderId: string) {
  return run(async () => {
    const actor = await requireAnyActor();
    await backToCart(orderId, actor.id);
    return true as const;
  });
}

export async function voidOrderAction(orderId: string, reason: string) {
  return run(async () => {
    const actor = await requireAnyActor();
    await voidOrder(orderId, actor.id, reason);
    return true as const;
  });
}

// ===========================================================================
//  Contant + kassalade (alleen kassa-pc: daar staat de lade)
// ===========================================================================

export async function payCashAction(input: { orderId: string; tenderedCents: number; amountCents: number | null; idempotencyKey: string }) {
  return run(async () => {
    const actor = await requireKassaActor();
    const result = await payCash({ ...input, userId: actor.id });
    return { ...result, state: await checkoutState(input.orderId) };
  });
}

export async function confirmDrawerAction(movementId: string, opened: boolean, error?: string) {
  return run(async () => {
    const actor = await requireKassaActor();
    await confirmDrawer(movementId, actor.id, opened, error);
    return true as const;
  });
}

export async function noSaleAction(reason: string) {
  return run(async () => {
    const actor = await requireKassaActor();
    return registerNoSale(actor.id, reason);
  });
}

// ===========================================================================
//  Pinnen via Mollie Tap to Pay
// ===========================================================================

export async function startPinAction(input: { orderId: string; amountCents: number; employeeId: string; idempotencyKey: string }) {
  return run(async () => {
    const actor = await requireAnyActor();
    // Op de telefoon kan een medewerker alleen naar de eigen telefoon pushen (modus B)
    if (actor.channel === 'telefoon' && input.employeeId !== actor.id) throw new AuthError('Je kunt alleen op je eigen telefoon pinnen');
    const started = await startTerminalPayment({
      ...input,
      initiatedById: actor.id,
      mode: actor.channel === 'telefoon' ? 'PUSH' : 'API',
    });
    return { ...started, state: await checkoutState(input.orderId) };
  });
}

export async function confirmManualPinAction(input: { orderId: string; amountCents: number; employeeId: string; idempotencyKey: string }) {
  return run(async () => {
    const actor = await requireAnyActor();
    if (actor.channel === 'telefoon' && input.employeeId !== actor.id) throw new AuthError('Je kunt alleen je eigen pinbetaling bevestigen');
    await confirmManualTapPayment({ ...input, confirmedById: actor.id });
    return checkoutState(input.orderId);
  });
}

export async function cancelPinAction(paymentId: string) {
  return run(async () => {
    const actor = await requireAnyActor();
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    await cancelTerminalPayment(paymentId, actor.id);
    return checkoutState(payment.orderId);
  });
}

// ===========================================================================
//  Retour / creditbon (alleen kassa-pc, manager of beheerder)
// ===========================================================================

export async function findReturnAction(number: string) {
  return run(async () => {
    await requireKassaActor();
    return findOrderForReturn(number);
  });
}

export async function createCreditAction(input: { originalOrderId: string; items: { lineId: string; quantity: number }[]; reason: string }) {
  return run(async () => {
    const actor = await requireKassaActor();
    const credit = await createCreditOrder({ ...input, userId: actor.id });
    return checkoutState(credit.id);
  });
}

export async function refundCashAction(input: { creditOrderId: string; amountCents: number | null; idempotencyKey: string }) {
  return run(async () => {
    const actor = await requireKassaActor();
    const result = await refundCash({ ...input, userId: actor.id });
    return { ...result, state: await checkoutState(input.creditOrderId) };
  });
}

export async function refundMollieAction(input: { creditOrderId: string; originalPaymentId: string; amountCents: number; idempotencyKey: string }) {
  return run(async () => {
    const actor = await requireKassaActor();
    if (actor.role === 'MEDEWERKER') throw new AuthError('Retouren mogen alleen door een manager of beheerder');
    await refundViaMollie({ ...input, userId: actor.id });
    return checkoutState(input.creditOrderId);
  });
}

// ===========================================================================
//  Overzichten
// ===========================================================================

export async function recentOrdersAction() {
  return run(async () => {
    await requireKassaActor();
    const orders = await todaysOrders(40);
    return orders.map((o) => ({
      id: o.id,
      number: o.number,
      type: o.type,
      status: o.status,
      totalInclCents: o.totalInclCents,
      cashier: o.cashier.name,
      at: o.paidAt ?? o.numberedAt,
      cash: o.payments.filter((p) => p.method === 'CASH').reduce((s, p) => s + p.amountCents, 0),
      pin: o.payments.filter((p) => p.method === 'MOLLIE').reduce((s, p) => s + p.amountCents, 0),
      voidReason: o.voidReason,
    }));
  });
}

/** Alles wat de telefoon van een medewerker moet tonen (wordt elke paar seconden opgevraagd). */
export async function phoneStateAction() {
  return run(async () => {
    const actor = await requirePhoneActor();
    const [pending, mine, open] = await Promise.all([
      pendingPaymentsForPhone(actor.id),
      prisma.payment.findMany({
        where: { employeeId: actor.id, method: 'MOLLIE', status: 'PAID', order: { businessDay: { date: shopDateString() } } },
        include: { order: { select: { number: true } } },
        orderBy: { paidAt: 'desc' },
      }),
      prisma.order.findMany({
        where: { cashierId: actor.id, status: 'PENDING_PAYMENT', businessDay: { date: shopDateString() } },
        select: { id: true, number: true, totalInclCents: true },
        orderBy: { updatedAt: 'desc' },
      }),
    ]);
    const day = await prisma.businessDay.findUnique({ where: { date: shopDateString() } });
    return {
      me: { id: actor.id, name: actor.name },
      dayOpen: day?.status === 'OPEN',
      mollieConfigured: isMollieConfigured(),
      hasPhoneLinked: Boolean((await prisma.user.findUniqueOrThrow({ where: { id: actor.id } })).mollieTerminalId),
      pending: pending.map((p) => ({ id: p.id, orderId: p.orderId, number: p.order.number, amountCents: p.amountCents, createdAt: p.createdAt })),
      openOrders: open,
      today: {
        count: mine.length,
        totalCents: mine.reduce((s, p) => s + p.amountCents, 0),
        payments: mine.slice(0, 20).map((p) => ({ id: p.id, number: p.order.number, amountCents: p.amountCents, paidAt: p.paidAt, mode: p.mollieMode })),
      },
    };
  });
}
