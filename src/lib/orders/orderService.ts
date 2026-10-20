/**
 * Bonnen, kassadag en contant geld. ALLEEN SERVER-SIDE.
 *
 * Levenscyclus van een bon:
 *   OPEN/PARKED ──afrekenen──▶ PENDING_PAYMENT ──eerste betaling──▶ krijgt bonnummer
 *        ▲                          │                                    │
 *        └──"terug naar bon"────────┘ (alleen zolang er nog geen nummer is)
 *                                                                        ▼
 *                                   VOIDED ◀── annuleren (zonder betaling) ── PAID (onwijzigbaar)
 *
 * Het bonnummer wordt pas bij de eerste betaling toegekend. Zo kan de klant
 * nog iets toevoegen zolang er niet betaald is, zonder vervallen bonnummers.
 */
import type { Order, Prisma, UserRole } from '@prisma/client';

import { audit } from '../audit';
import { formatEUR, summarizeVat, vatFromInclusive } from '../money';
import { nextNumber } from '../numbering';
import { prisma, type Db } from '../prisma';
import { getNumberSetting } from '../settings';
import { shopDateString, shopYear } from '../time';
import { calculateOrder, CartError, discountBp, type CartLineInput, type OrderDiscount } from './calc';
import { remainingToPay, settleOrderIfFullyPaid } from './settle';

export class PosError extends Error {
  readonly name = 'PosError';
}

// ===========================================================================
//  Kassadag
// ===========================================================================

/**
 * De lopende kassaperiode. Er is er hoogstens één open, ongeacht de datum:
 * een dag die om 08:00 start en na middernacht doorloopt, blijft dezelfde
 * kassadag tot het Z-rapport.
 */
export async function getOpenDay(db: Db = prisma) {
  return db.businessDay.findFirst({ where: { status: 'OPEN' }, orderBy: { openedAt: 'desc' } });
}

/** Voor het kassascherm: de lopende periode, anders de laatste van vandaag (kan afgesloten zijn). */
export async function getToday() {
  return (await getOpenDay()) ?? prisma.businessDay.findFirst({ where: { date: shopDateString() }, orderBy: { sequence: 'desc' } });
}

/** Een open periode die op een eerdere datum is gestart (Z-rapport vergeten). */
export async function getUnclosedEarlierDays() {
  return prisma.businessDay.findMany({
    where: { status: 'OPEN', date: { lt: shopDateString() } },
    orderBy: { date: 'asc' },
  });
}

/** Voorstel voor het beginsaldo: wat er bij de laatste afsluiting in de lade is geteld. */
export async function suggestedOpeningFloat(): Promise<number> {
  const last = await prisma.zReport.findFirst({ orderBy: { createdAt: 'desc' }, select: { countedCashCents: true } });
  return last?.countedCashCents ?? 0;
}

/**
 * Kassadag (periode) starten.
 * `afterClose`: bewust een nieuwe periode starten op een datum die al een
 * Z-rapport heeft (bijv. per ongeluk afgesloten, of na sluiting toch nog verkopen).
 */
export async function startBusinessDay(userId: string, openingFloatCents: number, options: { afterClose?: boolean } = {}) {
  if (!Number.isSafeInteger(openingFloatCents) || openingFloatCents < 0) {
    throw new PosError('Vul een geldig beginsaldo in');
  }
  const date = shopDateString();
  return prisma.$transaction(async (tx) => {
    const open = await getOpenDay(tx);
    if (open) return open;

    const last = await tx.businessDay.findFirst({ where: { date }, orderBy: { sequence: 'desc' } });
    if (last && !options.afterClose) {
      throw new PosError('Vandaag is al afgesloten met een Z-rapport. Kies “Nieuwe kassaperiode starten” als je toch nog moet verkopen.');
    }
    const sequence = (last?.sequence ?? 0) + 1;
    const day = await tx.businessDay.create({ data: { date, sequence, openingFloatCents, openedById: userId } });
    await tx.cashMovement.create({
      data: { businessDayId: day.id, type: 'OPENING_FLOAT', amountCents: openingFloatCents, userId, reason: sequence > 1 ? `Beginsaldo periode ${sequence}` : 'Beginsaldo' },
    });
    await audit(tx, { action: 'DAY_OPENED', userId, entity: 'BusinessDay', entityId: day.id, data: { date, sequence, openingFloatCents, afterClose: Boolean(options.afterClose) } });
    return day;
  });
}

async function requireOpenToday(db: Db) {
  const day = await getOpenDay(db);
  if (day) return day;
  const last = await db.businessDay.findFirst({ where: { date: shopDateString() }, orderBy: { sequence: 'desc' } });
  if (last?.status === 'CLOSED') {
    throw new PosError('De kassadag is al afgesloten. Start een nieuwe kassaperiode als je toch nog moet verkopen.');
  }
  throw new PosError('Start eerst de kassadag (beginsaldo invoeren)');
}

// ===========================================================================
//  Bonregels opbouwen (server bepaalt prijs en btw, nooit de browser)
// ===========================================================================

export interface CartLineRequest {
  productId: string;
  quantity: number;
  /** Alleen gebruikt bij producten met vrije prijs */
  unitPriceInclCents?: number;
  lineDiscountCents?: number;
  note?: string | null;
}

export interface CartRequest {
  lines: CartLineRequest[];
  discount: OrderDiscount;
  note?: string | null;
}

const DEFAULT_MAX_DISCOUNT_BP: Record<UserRole, number | null> = { MEDEWERKER: 1000, MANAGER: null, ADMIN: null };

async function buildLines(db: Db, cart: CartRequest, cashierId: string) {
  if (cart.lines.length === 0) throw new PosError('De bon is leeg');
  if (cart.lines.length > 200) throw new PosError('Te veel regels op één bon');

  const productIds = [...new Set(cart.lines.map((l) => l.productId))];
  const products = await db.product.findMany({ where: { id: { in: productIds } }, omit: { imageData: true }, include: { vatRate: true } });
  const byId = new Map(products.map((p) => [p.id, p]));

  const lines: CartLineInput[] = cart.lines.map((l) => {
    const p = byId.get(l.productId);
    if (!p || !p.active) throw new PosError('Een product op de bon bestaat niet meer of is uitgeschakeld');
    const unit = p.openPrice ? l.unitPriceInclCents ?? 0 : p.priceInclCents;
    if (p.openPrice && (!Number.isSafeInteger(unit) || unit <= 0)) throw new PosError(`Vul een bedrag in bij ${p.name}`);
    return {
      productId: p.id,
      description: p.name,
      quantity: l.quantity,
      unitPriceInclCents: unit,
      vatCode: p.vatRate.code,
      vatRateBp: p.vatRate.rateBp,
      revenueAccountCode: p.vatRate.revenueAccountCode,
      vatAccountCode: p.vatRate.vatAccountCode,
      lineDiscountCents: l.lineDiscountCents ?? 0,
      note: l.note?.slice(0, 200) || null,
    };
  });

  let calc;
  try {
    calc = calculateOrder(lines, cart.discount);
  } catch (err) {
    if (err instanceof CartError) throw new PosError(err.message);
    throw err;
  }

  // Kortingslimiet per medewerker
  const cashier = await db.user.findUniqueOrThrow({ where: { id: cashierId } });
  const limit = cashier.maxDiscountBp ?? (cashier.role === 'MEDEWERKER'
    ? await getNumberSetting('pos.maxDiscountBpWithoutManager', DEFAULT_MAX_DISCOUNT_BP.MEDEWERKER!)
    : DEFAULT_MAX_DISCOUNT_BP[cashier.role]);
  if (limit !== null && calc.discountCents > 0 && discountBp(calc) > limit) {
    throw new PosError(`${cashier.name} mag maximaal ${limit / 100}% korting geven. Laat een manager afrekenen.`);
  }
  return calc;
}

async function writeOrderContents(tx: Prisma.TransactionClient, orderId: string, calc: ReturnType<typeof calculateOrder>) {
  await tx.orderLine.deleteMany({ where: { orderId } });
  await tx.orderVatLine.deleteMany({ where: { orderId } });
  await tx.orderLine.createMany({
    data: calc.lines.map((l, i) => ({
      orderId,
      productId: l.productId,
      position: i,
      description: l.description,
      quantity: l.quantity,
      unitPriceInclCents: l.unitPriceInclCents,
      vatCode: l.vatCode,
      vatRateBp: l.vatRateBp,
      revenueAccountCode: l.revenueAccountCode,
      vatAccountCode: l.vatAccountCode,
      lineDiscountCents: l.lineDiscountCents,
      orderDiscountCents: l.orderDiscountCents,
      note: l.note ?? null,
      totalInclCents: l.totalInclCents,
      vatCents: l.vatCents,
      totalExclCents: l.totalExclCents,
    })),
  });
  await tx.orderVatLine.createMany({
    data: calc.vatLines.map((v) => ({ orderId, ...v })),
  });
}

function discountFields(discount: OrderDiscount) {
  return { discountType: discount?.type ?? null, discountValue: discount?.value ?? null };
}

/** Bon mag alleen aangepast worden zolang hij nog geen nummer heeft. */
async function loadEditableOrder(tx: Prisma.TransactionClient, orderId: string) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { payments: true } });
  if (order.number || order.payments.some((p) => p.status === 'PAID' || p.status === 'PENDING')) {
    throw new PosError('Deze bon heeft al een betaling en kan niet meer aangepast worden');
  }
  if (!['OPEN', 'PARKED', 'PENDING_PAYMENT'].includes(order.status)) throw new PosError('Deze bon kan niet meer aangepast worden');
  return order;
}

// ===========================================================================
//  Parkeren
// ===========================================================================

export async function parkOrder(input: { orderId?: string | null; cart: CartRequest; parkedLabel?: string | null; cashierId: string }) {
  return prisma.$transaction(async (tx) => {
    const day = await requireOpenToday(tx);
    const calc = await buildLines(tx, input.cart, input.cashierId);
    const label = input.parkedLabel?.trim().slice(0, 60) || null;
    const data = {
      status: 'PARKED' as const,
      parkedLabel: label,
      note: input.cart.note?.slice(0, 500) || null,
      ...discountFields(input.cart.discount),
      subtotalExclCents: calc.subtotalExclCents,
      vatCents: calc.vatCents,
      totalInclCents: calc.totalInclCents,
      discountCents: calc.discountCents,
    };
    const order = input.orderId
      ? (await loadEditableOrder(tx, input.orderId), await tx.order.update({ where: { id: input.orderId }, data }))
      : await tx.order.create({ data: { ...data, businessDayId: day.id, cashierId: input.cashierId } });
    await writeOrderContents(tx, order.id, calc);
    await audit(tx, { action: 'ORDER_PARKED', userId: input.cashierId, entity: 'Order', entityId: order.id, data: { label, totalInclCents: calc.totalInclCents } });
    return order;
  });
}

export async function listParkedOrders() {
  return prisma.order.findMany({
    where: { status: 'PARKED', businessDay: { status: 'OPEN' } },
    include: { cashier: { select: { name: true, color: true } }, _count: { select: { lines: true } } },
    orderBy: { updatedAt: 'desc' },
  });
}

/** Geparkeerde of onafgemaakte bon terughalen in de winkelwagen. */
export async function loadOrderForCart(orderId: string) {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { lines: { orderBy: { position: 'asc' } } },
  });
  if (order.number) throw new PosError('Deze bon is al genummerd en kan niet meer bewerkt worden');
  return order;
}

/** Ongenummerde concepten mogen weg (er is nog niets geboekt), wel gelogd. */
export async function discardDraft(orderId: string, userId: string) {
  await prisma.$transaction(async (tx) => {
    const order = await loadEditableOrder(tx, orderId);
    await audit(tx, {
      action: 'ORDER_DRAFT_DISCARDED',
      userId,
      entity: 'Order',
      entityId: orderId,
      data: { status: order.status, totalInclCents: order.totalInclCents, label: order.parkedLabel },
    });
    await tx.order.delete({ where: { id: orderId } });
  });
}

// ===========================================================================
//  Afrekenen
// ===========================================================================

/**
 * Zet de winkelwagen vast als bon die betaald moet worden. De bon krijgt nog
 * geen nummer; dat gebeurt bij de eerste betaling (ensureOrderNumber).
 * Totaal € 0,00 (100% korting) → direct afgerond.
 */
export async function prepareCheckout(input: { orderId?: string | null; cart: CartRequest; cashierId: string }) {
  return prisma.$transaction(async (tx) => {
    const day = await requireOpenToday(tx);
    const calc = await buildLines(tx, input.cart, input.cashierId);
    const data = {
      status: 'PENDING_PAYMENT' as const,
      parkedLabel: null,
      note: input.cart.note?.slice(0, 500) || null,
      ...discountFields(input.cart.discount),
      subtotalExclCents: calc.subtotalExclCents,
      vatCents: calc.vatCents,
      totalInclCents: calc.totalInclCents,
      discountCents: calc.discountCents,
    };
    let order: Order;
    if (input.orderId) {
      await loadEditableOrder(tx, input.orderId);
      // Geparkeerd door collega? Dan rekent de huidige medewerker af.
      order = await tx.order.update({ where: { id: input.orderId }, data: { ...data, cashierId: input.cashierId, businessDayId: day.id } });
    } else {
      order = await tx.order.create({ data: { ...data, businessDayId: day.id, cashierId: input.cashierId } });
    }
    await writeOrderContents(tx, order.id, calc);

    if (calc.totalInclCents === 0) {
      order = await ensureOrderNumber(tx, order.id, input.cashierId);
      await settleOrderIfFullyPaid(tx, order.id, input.cashierId);
      order = await tx.order.findUniqueOrThrow({ where: { id: order.id } });
    }
    return order;
  });
}

/** Ken een doorlopend bonnummer toe als de bon er nog geen heeft. */
export async function ensureOrderNumber(tx: Prisma.TransactionClient, orderId: string, userId: string): Promise<Order> {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
  if (order.number) return order;
  const number = await nextNumber(tx, order.type === 'CREDIT' ? 'CREDIT' : 'BON', shopYear(), 5);
  const updated = await tx.order.update({ where: { id: orderId }, data: { number, numberedAt: new Date() } });
  await audit(tx, { action: 'ORDER_NUMBERED', userId, entity: 'Order', entityId: orderId, data: { number, totalInclCents: order.totalInclCents } });
  return updated;
}

/** Terug naar de winkelwagen (klant wil nog iets). Alleen zonder bonnummer. */
export async function backToCart(orderId: string, userId: string) {
  return prisma.$transaction(async (tx) => {
    const order = await loadEditableOrder(tx, orderId);
    if (order.status !== 'PENDING_PAYMENT') return order;
    const updated = await tx.order.update({ where: { id: orderId }, data: { status: 'OPEN' } });
    await audit(tx, { action: 'ORDER_BACK_TO_CART', userId, entity: 'Order', entityId: orderId });
    return updated;
  });
}

/**
 * Bon annuleren. Zonder nummer: concept weg. Met nummer (er is een betaling
 * geprobeerd maar niets geslaagd): VOIDED met reden, het nummer blijft zichtbaar.
 */
export async function voidOrder(orderId: string, userId: string, reason: string) {
  const why = reason.trim();
  if (why.length < 3) throw new PosError('Vul een reden in');
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { payments: true } });
    if (order.status === 'PAID' || order.status === 'VOIDED') throw new PosError('Deze bon is al afgerond');
    if (order.payments.some((p) => p.status === 'PENDING')) throw new PosError('Er loopt nog een pinbetaling. Annuleer die eerst.');
    if (order.payments.some((p) => p.status === 'PAID')) {
      throw new PosError('Er is al (deels) betaald op deze bon. Reken hem af en maak daarna een creditbon.');
    }
    if (!order.number) {
      await audit(tx, { action: 'ORDER_DRAFT_DISCARDED', userId, entity: 'Order', entityId: orderId, data: { reason: why } });
      await tx.order.delete({ where: { id: orderId } });
      return null;
    }
    const updated = await tx.order.update({ where: { id: orderId }, data: { status: 'VOIDED', voidReason: why, voidedById: userId } });
    await audit(tx, { action: 'ORDER_VOIDED', userId, entity: 'Order', entityId: orderId, data: { number: order.number, reason: why } });
    return updated;
  });
}

export async function getOrderForCheckout(orderId: string) {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: {
      lines: { orderBy: { position: 'asc' } },
      vatLines: true,
      payments: { orderBy: { createdAt: 'asc' }, include: { employee: { select: { name: true } } } },
    },
  });
  const paidCents = order.payments.filter((p) => p.status === 'PAID').reduce((s, p) => s + p.amountCents, 0);
  const pendingCents = order.payments.filter((p) => p.status === 'PENDING').reduce((s, p) => s + p.amountCents, 0);
  return { order, paidCents, pendingCents, remainingCents: order.totalInclCents - paidCents - pendingCents };
}

// ===========================================================================
//  Contant
// ===========================================================================

export interface CashPaymentInput {
  orderId: string;
  /** Wat de klant geeft (bijv. 5000 voor een briefje van €50) */
  tenderedCents: number;
  /**
   * Split-betaling: welk deel contant (bijv. €20). Leeg = alles wat nog openstaat
   * (tot maximaal het gegeven bedrag).
   */
  amountCents?: number | null;
  userId: string;
  idempotencyKey: string;
}

export async function payCash(input: CashPaymentInput) {
  if (!Number.isSafeInteger(input.tenderedCents) || input.tenderedCents <= 0) throw new PosError('Vul het ontvangen bedrag in');
  return prisma.$transaction(async (tx) => {
    const existing = await tx.payment.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { cashMovement: true } });
    if (existing) {
      const order = await tx.order.findUniqueOrThrow({ where: { id: existing.orderId } });
      return { paymentId: existing.id, movementId: existing.cashMovement?.id ?? null, changeCents: existing.changeCents ?? 0, orderPaid: order.status === 'PAID', orderNumber: order.number };
    }

    const day = await requireOpenToday(tx);
    const order = await tx.order.findUniqueOrThrow({ where: { id: input.orderId } });
    if (order.status !== 'PENDING_PAYMENT' || order.type !== 'SALE') throw new PosError('Deze bon kan niet (meer) contant betaald worden');

    const remaining = await remainingToPay(tx, order.id);
    if (remaining <= 0) throw new PosError('Er staat niets meer open (loopt er nog een pinbetaling?)');
    const amount = input.amountCents ?? Math.min(input.tenderedCents, remaining);
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new PosError('Ongeldig contant bedrag');
    if (amount > remaining) throw new PosError(`Contant deel (${formatEUR(amount)}) is hoger dan het restant (${formatEUR(remaining)})`);
    if (input.tenderedCents < amount) throw new PosError('Ontvangen bedrag is lager dan het contante deel');

    const numbered = await ensureOrderNumber(tx, order.id, input.userId);
    const changeCents = input.tenderedCents - amount;
    const payment = await tx.payment.create({
      data: {
        orderId: order.id,
        method: 'CASH',
        status: 'PAID',
        amountCents: amount,
        tenderedCents: input.tenderedCents,
        changeCents,
        employeeId: input.userId,
        paidAt: new Date(),
        idempotencyKey: input.idempotencyKey,
      },
    });
    // In de lade komt netto het bedrag van de bon (gegeven − wisselgeld)
    const movement = await tx.cashMovement.create({
      data: { businessDayId: day.id, type: 'SALE', amountCents: amount, userId: input.userId, orderId: order.id, paymentId: payment.id },
    });
    await audit(tx, {
      action: 'CASH_PAYMENT',
      userId: input.userId,
      entity: 'Payment',
      entityId: payment.id,
      data: { orderNumber: numbered.number, amountCents: amount, tenderedCents: input.tenderedCents, changeCents },
    });
    const orderPaid = await settleOrderIfFullyPaid(tx, order.id, input.userId);
    return { paymentId: payment.id, movementId: movement.id, changeCents, orderPaid, orderNumber: numbered.number };
  });
}

/** Vastleggen of de lade echt open ging (USB verbonden / foutmelding). */
export async function confirmDrawer(movementId: string, userId: string, opened: boolean, error?: string) {
  await prisma.cashMovement.update({ where: { id: movementId }, data: { drawerOpened: opened } });
  await audit(prisma, {
    action: opened ? 'DRAWER_OPENED' : 'DRAWER_FAILED',
    userId,
    entity: 'CashMovement',
    entityId: movementId,
    data: error ? { error } : undefined,
  });
}

/** "Open kassalade (geen verkoop)": eerst registreren, dan pas openen. */
export async function registerNoSale(userId: string, reason: string) {
  const why = reason.trim();
  if (why.length < 3) throw new PosError('Vul een reden in (minimaal 3 tekens)');
  return prisma.$transaction(async (tx) => {
    const day = await requireOpenToday(tx);
    const movement = await tx.cashMovement.create({
      data: { businessDayId: day.id, type: 'NO_SALE', amountCents: 0, userId, reason: why.slice(0, 200) },
    });
    await audit(tx, { action: 'NO_SALE', userId, entity: 'CashMovement', entityId: movement.id, data: { reason: why } });
    return { movementId: movement.id };
  });
}

/**
 * Kasmutatie: wisselgeld bijvullen (CASH_IN) of afromen naar de kluis (CASH_OUT).
 * Bedrag altijd positief invoeren; reden verplicht.
 */
export async function registerCashMovement(input: { userId: string; type: 'CASH_IN' | 'CASH_OUT'; amountCents: number; reason: string }) {
  const why = input.reason.trim();
  if (why.length < 3) throw new PosError('Vul een reden in (minimaal 3 tekens)');
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) throw new PosError('Vul een bedrag in');
  if (input.amountCents > 10_000_00) throw new PosError('Bedrag is onwaarschijnlijk hoog; controleer de invoer');
  return prisma.$transaction(async (tx) => {
    const day = await requireOpenToday(tx);
    if (input.type === 'CASH_OUT') {
      const inDrawer = await tx.cashMovement.aggregate({ where: { businessDayId: day.id }, _sum: { amountCents: true } });
      const available = inDrawer._sum.amountCents ?? 0;
      if (input.amountCents > available) throw new PosError(`Er zit volgens de kassa maar ${formatEUR(available)} in de lade`);
    }
    const amount = input.type === 'CASH_IN' ? input.amountCents : -input.amountCents;
    const movement = await tx.cashMovement.create({
      data: { businessDayId: day.id, type: input.type, amountCents: amount, userId: input.userId, reason: why.slice(0, 200) },
    });
    await audit(tx, { action: input.type, userId: input.userId, entity: 'CashMovement', entityId: movement.id, data: { amountCents: amount, reason: why } });
    return { movementId: movement.id };
  });
}

// ===========================================================================
//  Retour / creditbon
// ===========================================================================

export async function findOrderForReturn(number: string) {
  const order = await prisma.order.findUnique({
    where: { number: number.trim().toUpperCase() },
    include: {
      lines: { orderBy: { position: 'asc' }, include: { credits: { include: { order: { select: { status: true } } } } } },
      payments: { where: { status: 'PAID' }, include: { employee: { select: { name: true } } } },
    },
  });
  if (!order) throw new PosError(`Bon ${number} niet gevonden`);
  if (order.type !== 'SALE' || order.status !== 'PAID') throw new PosError('Alleen afgeronde verkoopbonnen kunnen retour');

  const lines = order.lines.map((l) => {
    const returned = l.credits.filter((c) => c.order.status !== 'VOIDED').reduce((s, c) => s - c.quantity, 0);
    return {
      id: l.id,
      description: l.description,
      quantity: l.quantity,
      returnedQuantity: returned,
      returnableQuantity: l.quantity - returned,
      totalInclCents: l.totalInclCents,
      unitPaidCents: Math.round(l.totalInclCents / l.quantity),
    };
  });
  const molliePayments = order.payments
    .filter((p) => p.method === 'MOLLIE' && p.amountCents > 0)
    .map((p) => ({ id: p.id, amountCents: p.amountCents, employee: p.employee.name, linked: Boolean(p.molliePaymentId ?? p.reconciledMolliePaymentId) }));
  return { order: { id: order.id, number: order.number!, paidAt: order.paidAt, totalInclCents: order.totalInclCents }, lines, molliePayments };
}

export async function createCreditOrder(input: {
  originalOrderId: string;
  items: { lineId: string; quantity: number }[];
  userId: string;
  reason: string;
}) {
  const why = input.reason.trim();
  if (why.length < 3) throw new PosError('Vul een reden voor de retour in');
  const items = input.items.filter((i) => i.quantity > 0);
  if (items.length === 0) throw new PosError('Kies minimaal één product om terug te nemen');

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: input.userId } });
    if (user.role === 'MEDEWERKER') throw new PosError('Retouren mogen alleen door een manager of beheerder');
    const day = await requireOpenToday(tx);
    const original = await tx.order.findUniqueOrThrow({
      where: { id: input.originalOrderId },
      include: { lines: { include: { credits: { include: { order: { select: { status: true } } } } } } },
    });
    if (original.type !== 'SALE' || original.status !== 'PAID') throw new PosError('Alleen afgeronde verkoopbonnen kunnen retour');

    const creditLines = items.map((item, position) => {
      const line = original.lines.find((l) => l.id === item.lineId);
      if (!line) throw new PosError('Onbekende bonregel');
      const returned = line.credits.filter((c) => c.order.status !== 'VOIDED').reduce((s, c) => s - c.quantity, 0);
      const refundedSoFar = line.credits.filter((c) => c.order.status !== 'VOIDED').reduce((s, c) => s - c.totalInclCents, 0);
      const left = line.quantity - returned;
      if (!Number.isSafeInteger(item.quantity) || item.quantity > left) {
        throw new PosError(`Van ${line.description} kunnen nog maximaal ${left} stuks terug`);
      }
      // Terugbetalen wat de klant echt betaalde (incl. kortingen). Bij de
      // laatste stuks het exacte restant, zodat er nooit meer terug gaat dan betaald is.
      const refund = item.quantity === left
        ? line.totalInclCents - refundedSoFar
        : Math.round((line.totalInclCents * item.quantity) / line.quantity);
      const totalInclCents = -refund;
      const gross = -item.quantity * line.unitPriceInclCents;
      const vatCents = vatFromInclusive(totalInclCents, line.vatRateBp);
      return {
        productId: line.productId,
        position,
        description: line.description,
        quantity: -item.quantity,
        unitPriceInclCents: line.unitPriceInclCents,
        vatCode: line.vatCode,
        vatRateBp: line.vatRateBp,
        revenueAccountCode: line.revenueAccountCode,
        vatAccountCode: line.vatAccountCode,
        lineDiscountCents: 0,
        // totaal = aantal × prijs − korting  →  korting = bruto − totaal (negatief bij credit)
        orderDiscountCents: gross - totalInclCents,
        totalInclCents,
        vatCents,
        totalExclCents: totalInclCents - vatCents,
        creditOfLineId: line.id,
      };
    });

    // Btw-specificatie per tarief over de creditbedragen
    const byCode = new Map<string, { vatCode: string; vatRateBp: number; revenueAccountCode: string; vatAccountCode: string | null; totalInclCents: number }>();
    for (const l of creditLines) {
      const v = byCode.get(l.vatCode) ?? { vatCode: l.vatCode, vatRateBp: l.vatRateBp, revenueAccountCode: l.revenueAccountCode, vatAccountCode: l.vatAccountCode, totalInclCents: 0 };
      v.totalInclCents += l.totalInclCents;
      byCode.set(l.vatCode, v);
    }
    const vatLines = summarizeVat([...byCode.values()]);
    const totalInclCents = creditLines.reduce((s, l) => s + l.totalInclCents, 0);
    const vatCents = vatLines.reduce((s, v) => s + v.vatCents, 0);

    const credit = await tx.order.create({
      data: {
        type: 'CREDIT',
        status: 'PENDING_PAYMENT',
        businessDayId: day.id,
        cashierId: input.userId,
        creditOfOrderId: original.id,
        note: why.slice(0, 500),
        subtotalExclCents: totalInclCents - vatCents,
        vatCents,
        totalInclCents,
        discountCents: creditLines.reduce((s, l) => s + l.orderDiscountCents, 0),
      },
    });
    await tx.orderLine.createMany({ data: creditLines.map((l) => ({ ...l, orderId: credit.id })) });
    await tx.orderVatLine.createMany({ data: vatLines.map((v) => ({ ...v, orderId: credit.id })) });
    const numbered = await ensureOrderNumber(tx, credit.id, input.userId);
    await audit(tx, {
      action: 'CREDIT_CREATED',
      userId: input.userId,
      entity: 'Order',
      entityId: credit.id,
      data: { number: numbered.number, originalNumber: original.number, totalInclCents, reason: why },
    });
    return numbered;
  });
}

/** Creditbon (deels) contant terugbetalen uit de lade. */
export async function refundCash(input: { creditOrderId: string; amountCents?: number | null; userId: string; idempotencyKey: string }) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.payment.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { cashMovement: true } });
    if (existing) return { paymentId: existing.id, movementId: existing.cashMovement?.id ?? null, orderPaid: true };

    const day = await requireOpenToday(tx);
    const order = await tx.order.findUniqueOrThrow({ where: { id: input.creditOrderId } });
    if (order.type !== 'CREDIT' || order.status !== 'PENDING_PAYMENT') throw new PosError('Creditbon is niet klaar voor terugbetaling');
    const remaining = await remainingToPay(tx, order.id); // negatief
    if (remaining >= 0) throw new PosError('Er staat niets meer open op deze creditbon');
    const amount = input.amountCents ?? -remaining;
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > -remaining) throw new PosError('Ongeldig terug te betalen bedrag');

    const payment = await tx.payment.create({
      data: { orderId: order.id, method: 'CASH', status: 'PAID', amountCents: -amount, employeeId: input.userId, paidAt: new Date(), idempotencyKey: input.idempotencyKey },
    });
    const movement = await tx.cashMovement.create({
      data: { businessDayId: day.id, type: 'REFUND', amountCents: -amount, userId: input.userId, orderId: order.id, paymentId: payment.id, reason: `Retour ${order.number}` },
    });
    await audit(tx, { action: 'CASH_REFUND', userId: input.userId, entity: 'Payment', entityId: payment.id, data: { orderNumber: order.number, amountCents: amount } });
    const orderPaid = await settleOrderIfFullyPaid(tx, order.id, input.userId);
    return { paymentId: payment.id, movementId: movement.id, orderPaid };
  });
}

// ===========================================================================
//  Overzicht voor kassascherm
// ===========================================================================

export async function todaysOrders(limit = 30) {
  return prisma.order.findMany({
    where: { OR: [{ businessDay: { status: 'OPEN' } }, { businessDay: { date: shopDateString() } }], number: { not: null } },
    include: { cashier: { select: { name: true } }, payments: { where: { status: 'PAID' }, select: { method: true, amountCents: true } } },
    orderBy: { numberedAt: 'desc' },
    take: limit,
  });
}
