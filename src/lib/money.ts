/**
 * Geldfuncties. Alles in hele eurocenten (integer). Nooit floats optellen.
 */

export type Cents = number;

/** Afronden: half van nul af (€0,005 → €0,01, −€0,005 → −€0,01). */
export function roundHalfAwayFromZero(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value));
}

export function assertCents(value: number, label = 'bedrag'): asserts value is Cents {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} moet een geheel aantal centen zijn, kreeg ${value}`);
  }
}

const eurFormatter = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' });

/** 1234 → "€ 12,34" */
export function formatEUR(cents: Cents): string {
  return eurFormatter.format(cents / 100);
}

/**
 * Mollie verwacht `{ currency: 'EUR', value: '12.34' }` (altijd positief, 2 decimalen).
 * Opgebouwd met integer-rekenwerk, zodat er nooit "12.340000001" ontstaat.
 */
export function toMollieAmount(cents: Cents): { currency: 'EUR'; value: string } {
  assertCents(cents);
  if (cents <= 0) throw new Error('Mollie-bedrag moet groter dan 0 zijn');
  const euros = Math.floor(cents / 100);
  const rest = String(cents % 100).padStart(2, '0');
  return { currency: 'EUR', value: `${euros}.${rest}` };
}

/** "12.34" / "-0.50" / "12" → centen, zonder parseFloat. */
export function parseMollieAmount(amount: { value: string; currency?: string } | string): Cents {
  const raw = typeof amount === 'string' ? amount : amount.value;
  if (typeof amount !== 'string' && amount.currency && amount.currency !== 'EUR') {
    throw new Error(`Onverwachte valuta van Mollie: ${amount.currency}`);
  }
  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(raw.trim());
  if (!match) throw new Error(`Ongeldig Mollie-bedrag: ${raw}`);
  const [, minus, whole, frac = ''] = match;
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return minus ? -cents : cents;
}

/**
 * Btw uit een bedrag inclusief btw. 21% = 2100 basispunten.
 * btw = incl × tarief / (100% + tarief), afgerond op centen.
 */
export function vatFromInclusive(inclCents: Cents, rateBp: number): Cents {
  if (rateBp === 0) return 0;
  return roundHalfAwayFromZero((inclCents * rateBp) / (10000 + rateBp));
}

export interface VatInputLine {
  vatCode: string;
  vatRateBp: number;
  revenueAccountCode: string;
  vatAccountCode: string | null;
  totalInclCents: Cents;
}

export interface VatSummaryLine extends VatInputLine {
  vatCents: Cents;
  totalExclCents: Cents;
}

/**
 * Btw-specificatie: eerst per tarief optellen, dán btw berekenen.
 * Zo sluit "excl + btw = incl" per tarief altijd exact.
 */
export function summarizeVat(lines: VatInputLine[]): VatSummaryLine[] {
  const byCode = new Map<string, VatInputLine>();
  for (const line of lines) {
    const existing = byCode.get(line.vatCode);
    if (existing) {
      if (existing.vatRateBp !== line.vatRateBp) {
        throw new Error(`Btw-code ${line.vatCode} heeft twee verschillende tarieven op één bon`);
      }
      existing.totalInclCents += line.totalInclCents;
    } else {
      byCode.set(line.vatCode, { ...line });
    }
  }
  return [...byCode.values()].map((l) => {
    const vatCents = vatFromInclusive(l.totalInclCents, l.vatRateBp);
    return { ...l, vatCents, totalExclCents: l.totalInclCents - vatCents };
  });
}

/**
 * Invoer van een medewerker → centen. Accepteert "12,50", "12.50", "€ 12,5",
 * "12". Geeft null bij ongeldige invoer.
 */
export function parseEuroInput(input: string): Cents | null {
  const cleaned = input.replace(/[€\s]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '');
  const match = /^(-)?(\d{1,7})(?:[.,](\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const [, minus, whole, frac = ''] = match;
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return minus ? -cents : cents;
}

/** 1234 → "12,34" (zonder €-teken, voor invoervelden) */
export function formatEuroInput(cents: Cents): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}
