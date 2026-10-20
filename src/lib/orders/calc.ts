/**
 * Bonberekening. Pure functie: wordt in de browser gebruikt voor de live
 * weergave én op de server om het definitieve bedrag vast te leggen. De server
 * vertrouwt nooit de bedragen van de browser, alleen aantallen en kortingen.
 *
 * Per regel:  totaal = aantal × prijs − regelkorting − aandeel bonkorting
 * Btw per tarief wordt berekend over het totaal van dat tarief (summarizeVat).
 */
import { summarizeVat, vatFromInclusive, type VatSummaryLine } from '../money';

export interface CartLineInput {
  productId: string | null;
  description: string;
  quantity: number;
  unitPriceInclCents: number;
  vatCode: string;
  vatRateBp: number;
  revenueAccountCode: string;
  vatAccountCode: string | null;
  /** Korting op deze regel in centen (positief) */
  lineDiscountCents: number;
  note?: string | null;
}

export type OrderDiscount = { type: 'PERCENT'; value: number } | { type: 'AMOUNT'; value: number } | null;

export interface CalculatedLine extends CartLineInput {
  orderDiscountCents: number;
  totalInclCents: number;
  vatCents: number;
  totalExclCents: number;
}

export interface CalculatedOrder {
  lines: CalculatedLine[];
  vatLines: VatSummaryLine[];
  /** Som van aantal × prijs, vóór kortingen */
  grossBeforeDiscountCents: number;
  lineDiscountCents: number;
  orderDiscountCents: number;
  discountCents: number;
  subtotalExclCents: number;
  vatCents: number;
  totalInclCents: number;
}

export class CartError extends Error {
  readonly name = 'CartError';
}

/** Verdeel `amount` over regels naar rato van `weights`; som is altijd exact `amount`. */
export function distribute(amount: number, weights: number[]): number[] {
  const total = weights.reduce((s, w) => s + w, 0);
  if (amount === 0 || total === 0) return weights.map(() => 0);
  const raw = weights.map((w) => (amount * w) / total);
  const shares = raw.map((r) => Math.floor(r));
  let rest = amount - shares.reduce((s, x) => s + x, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac);
  for (let k = 0; rest > 0 && k < order.length; k++, rest--) shares[order[k].i] += 1;
  return shares;
}

export function calculateOrder(lines: CartLineInput[], discount: OrderDiscount): CalculatedOrder {
  for (const l of lines) {
    if (!Number.isSafeInteger(l.quantity) || l.quantity <= 0) throw new CartError(`Ongeldig aantal bij ${l.description}`);
    if (!Number.isSafeInteger(l.unitPriceInclCents) || l.unitPriceInclCents < 0) throw new CartError(`Ongeldige prijs bij ${l.description}`);
    if (!Number.isSafeInteger(l.lineDiscountCents) || l.lineDiscountCents < 0 || l.lineDiscountCents > l.quantity * l.unitPriceInclCents) {
      throw new CartError(`Korting bij ${l.description} is ongeldig`);
    }
  }

  const grossPerLine = lines.map((l) => l.quantity * l.unitPriceInclCents - l.lineDiscountCents);
  const sumGross = grossPerLine.reduce((s, g) => s + g, 0);

  let orderDiscountCents = 0;
  if (discount) {
    if (!Number.isSafeInteger(discount.value) || discount.value < 0) throw new CartError('Ongeldige korting');
    if (discount.type === 'PERCENT') {
      if (discount.value > 10000) throw new CartError('Korting kan niet meer dan 100% zijn');
      orderDiscountCents = Math.round((sumGross * discount.value) / 10000);
    } else {
      if (discount.value > sumGross) throw new CartError('Korting is hoger dan het bonbedrag');
      orderDiscountCents = discount.value;
    }
  }
  const shares = distribute(orderDiscountCents, grossPerLine);

  const calculated: CalculatedLine[] = lines.map((l, i) => {
    const totalInclCents = grossPerLine[i] - shares[i];
    const vatCents = vatFromInclusive(totalInclCents, l.vatRateBp);
    return { ...l, orderDiscountCents: shares[i], totalInclCents, vatCents, totalExclCents: totalInclCents - vatCents };
  });

  const vatLines = summarizeVat(
    calculated.map((l) => ({
      vatCode: l.vatCode,
      vatRateBp: l.vatRateBp,
      revenueAccountCode: l.revenueAccountCode,
      vatAccountCode: l.vatAccountCode,
      totalInclCents: l.totalInclCents,
    })),
  );
  const totalInclCents = calculated.reduce((s, l) => s + l.totalInclCents, 0);
  const vatCents = vatLines.reduce((s, v) => s + v.vatCents, 0);
  const lineDiscountCents = lines.reduce((s, l) => s + l.lineDiscountCents, 0);

  return {
    lines: calculated,
    vatLines,
    grossBeforeDiscountCents: lines.reduce((s, l) => s + l.quantity * l.unitPriceInclCents, 0),
    lineDiscountCents,
    orderDiscountCents,
    discountCents: lineDiscountCents + orderDiscountCents,
    subtotalExclCents: totalInclCents - vatCents,
    vatCents,
    totalInclCents,
  };
}

/** Korting als percentage (basispunten) van het bruto bedrag, voor de limietcontrole. */
export function discountBp(order: CalculatedOrder): number {
  if (order.grossBeforeDiscountCents === 0) return 0;
  return Math.round((order.discountCents * 10000) / order.grossBeforeDiscountCents);
}
