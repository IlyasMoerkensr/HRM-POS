/**
 * CSV (Nederlandse Excel: puntkomma, decimale komma, UTF-8 met BOM) en
 * echte Excel-bestanden (.xlsx) met meerdere tabbladen.
 */
import ExcelJS from 'exceljs';

import { VAT_CODES, VAT_LABEL } from './accounting';

export interface Column {
  key: string;
  label: string;
  /** Bedrag in centen → euro's */
  money?: boolean;
  width?: number;
}

export interface Sheet {
  name: string;
  columns: Column[];
  rows: Record<string, unknown>[];
}

const vatCols = (prefix: string, label: string): Column[] =>
  VAT_CODES.map((c) => ({ key: `${prefix}_${c}`, label: `${label} ${VAT_LABEL[c]}`, money: true }));

export const DAY_COLUMNS: Column[] = [
  { key: 'datum', label: 'Datum', width: 12 },
  { key: 'zRapport', label: 'Z-rapport', width: 13 },
  { key: 'bonnen', label: 'Bonnen' },
  { key: 'creditbonnen', label: 'Creditbonnen' },
  { key: 'geannuleerd', label: 'Geannuleerd' },
  { key: 'omzetIncl', label: 'Omzet incl. btw', money: true },
  { key: 'omzetExcl', label: 'Omzet excl. btw', money: true },
  { key: 'btw', label: 'Btw totaal', money: true },
  ...VAT_CODES.flatMap((c) => [
    { key: `omzetExcl_${c}`, label: `Omzet excl. ${VAT_LABEL[c]}`, money: true },
    { key: `btw_${c}`, label: `Btw ${VAT_LABEL[c]}`, money: true },
  ]),
  { key: 'contant', label: 'Contant', money: true },
  { key: 'pin', label: 'Pin (kassa)', money: true },
  { key: 'pinVolgensMollie', label: 'Pin (Mollie)', money: true },
  { key: 'pinVerschil', label: 'Pinverschil', money: true },
  { key: 'beginsaldo', label: 'Beginsaldo kas', money: true },
  { key: 'bijgevuld', label: 'Bijgevuld', money: true },
  { key: 'afgeroomd', label: 'Afgeroomd', money: true },
  { key: 'kasTheoretisch', label: 'Kas theoretisch', money: true },
  { key: 'kasGeteld', label: 'Kas geteld', money: true },
  { key: 'kasverschil', label: 'Kasverschil', money: true },
  { key: 'toelichting', label: 'Toelichting kasverschil', width: 30 },
  { key: 'korting', label: 'Korting gegeven', money: true },
  { key: 'ladeZonderVerkoop', label: 'Lade zonder verkoop' },
];

export const ORDER_COLUMNS: Column[] = [
  { key: 'bonnummer', label: 'Bonnummer', width: 18 },
  { key: 'datum', label: 'Datum', width: 12 },
  { key: 'tijd', label: 'Tijd' },
  { key: 'soort', label: 'Soort' },
  { key: 'status', label: 'Status' },
  { key: 'medewerker', label: 'Medewerker', width: 16 },
  { key: 'totaalIncl', label: 'Totaal incl. btw', money: true },
  { key: 'totaalExcl', label: 'Totaal excl. btw', money: true },
  { key: 'btw', label: 'Btw', money: true },
  ...vatCols('incl', 'Incl. btw'),
  { key: 'contant', label: 'Contant', money: true },
  { key: 'pin', label: 'Pin', money: true },
  { key: 'pinMedewerker', label: 'Gepind op telefoon van', width: 18 },
  { key: 'molliePaymentId', label: 'Mollie-ID', width: 18 },
  { key: 'korting', label: 'Korting', money: true },
  { key: 'creditVan', label: 'Credit van bon', width: 18 },
  { key: 'reden', label: 'Reden', width: 30 },
];

export const VAT_COLUMNS: Column[] = [
  { key: 'tarief', label: 'Tarief' },
  { key: 'rubriek', label: 'Rubriek btw-aangifte', width: 28 },
  { key: 'omzetExcl', label: 'Omzet excl. btw', money: true },
  { key: 'btw', label: 'Btw', money: true },
  { key: 'omzetIncl', label: 'Omzet incl. btw', money: true },
];

export const JOURNAL_COLUMNS: Column[] = [
  { key: 'datum', label: 'Datum', width: 12 },
  { key: 'dagboek', label: 'Dagboek' },
  { key: 'boekstuk', label: 'Boekstuk', width: 16 },
  { key: 'rekening', label: 'Rekening' },
  { key: 'rekeningNaam', label: 'Rekeningnaam', width: 32 },
  { key: 'omschrijving', label: 'Omschrijving', width: 40 },
  { key: 'debet', label: 'Debet', money: true },
  { key: 'credit', label: 'Credit', money: true },
  { key: 'btwCode', label: 'Btw-code' },
];

export const SETTLEMENT_COLUMNS: Column[] = [
  { key: 'referentie', label: 'Referentie', width: 16 },
  { key: 'mollieId', label: 'Mollie-ID', width: 16 },
  { key: 'status', label: 'Status' },
  { key: 'aangemaakt', label: 'Aangemaakt', width: 12 },
  { key: 'uitbetaald', label: 'Uitbetaald', width: 12 },
  { key: 'omzetBruto', label: 'Omzet bruto', money: true },
  { key: 'kostenExcl', label: 'Kosten excl. btw', money: true },
  { key: 'kostenBtw', label: 'Btw op kosten', money: true },
  { key: 'kostenIncl', label: 'Kosten incl. btw', money: true },
  { key: 'uitbetaaldBedrag', label: 'Uitbetaald bedrag', money: true },
  { key: 'factuur', label: 'Mollie-factuur', width: 16 },
];

// ---------------------------------------------------------------------------

function centsToDutch(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}

function csvCell(value: unknown, money?: boolean): string {
  if (value === null || value === undefined) return '';
  let text = money && typeof value === 'number' ? centsToDutch(value) : String(value);
  // Formule-injectie voorkomen (=, +, -, @ aan het begin van tekst)
  if (!money && typeof value === 'string' && /^[=+\-@]/.test(text)) text = `'${text}`;
  return /[;"\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(sheet: Sheet): string {
  const header = sheet.columns.map((c) => csvCell(c.label)).join(';');
  const body = sheet.rows.map((r) => sheet.columns.map((c) => csvCell(r[c.key], c.money)).join(';'));
  return `﻿${[header, ...body].join('\r\n')}\r\n`;
}

export async function toXlsx(sheets: Sheet[], meta: { title: string; company: string }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = meta.company;
  wb.title = meta.title;
  wb.created = new Date();

  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheet.name.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = sheet.columns.map((c) => ({ header: c.label, key: c.key, width: c.width ?? Math.max(10, c.label.length + 2) }));
    for (const row of sheet.rows) {
      const values: Record<string, unknown> = {};
      for (const c of sheet.columns) {
        const v = row[c.key];
        values[c.key] = c.money && typeof v === 'number' ? v / 100 : v ?? null;
      }
      ws.addRow(values);
    }
    sheet.columns.forEach((c, i) => {
      if (c.money) ws.getColumn(i + 1).numFmt = '#,##0.00;[Red]-#,##0.00';
    });
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
    if (sheet.rows.length > 0) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } };
  }
  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}
