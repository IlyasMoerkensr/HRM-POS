import { dayRows, journalLines, loadPeriod, orderRows, settlementRows, vatTotals, type Period } from './accounting';
import { DAY_COLUMNS, JOURNAL_COLUMNS, ORDER_COLUMNS, SETTLEMENT_COLUMNS, VAT_COLUMNS, type Sheet } from './formats';

export const EXPORT_KINDS = {
  dagen: 'Dagoverzicht',
  btw: 'Btw-specificatie',
  bonnen: 'Bonnenlijst',
  journaal: 'Journaalposten',
  mollie: 'Mollie-uitbetalingen',
} as const;

export type ExportKind = keyof typeof EXPORT_KINDS;

/** Alle tabbladen voor een periode. */
export async function buildSheets(period: Period): Promise<{ sheets: Record<ExportKind, Sheet>; openDays: string[] }> {
  const data = await loadPeriod(period);
  const journal = await journalLines(data);
  return {
    openDays: data.open,
    sheets: {
      dagen: { name: EXPORT_KINDS.dagen, columns: DAY_COLUMNS, rows: dayRows(data) },
      btw: { name: EXPORT_KINDS.btw, columns: VAT_COLUMNS, rows: vatTotals(data) },
      bonnen: { name: EXPORT_KINDS.bonnen, columns: ORDER_COLUMNS, rows: orderRows(data) },
      journaal: { name: EXPORT_KINDS.journaal, columns: JOURNAL_COLUMNS, rows: journal as unknown as Record<string, unknown>[] },
      mollie: { name: EXPORT_KINDS.mollie, columns: SETTLEMENT_COLUMNS, rows: settlementRows(data) },
    },
  };
}
