/**
 * Eenmalige import van prisma/producten.csv bij het starten van de kassa.
 * Zo komen de producten vanzelf in de kassa na update.bat. Bij een nieuwe
 * versie van het bestand worden prijzen en btw bijgewerkt; handmatige
 * wijzigingen blijven staan zolang het bestand niet verandert.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { prisma } from '../prisma';
import { applyImport, parseProductCsv } from './products';

const KEY = 'import.bundledProducts';
const DEFAULT_REVENUE_CODES = ['8000', '8010', '8020'];

export async function importBundledProducts(): Promise<string | null> {
  let text: string;
  try {
    text = await readFile(path.join(process.cwd(), 'prisma', 'producten.csv'), 'utf8');
  } catch {
    return null; // geen bestand meegeleverd
  }
  const hash = createHash('sha256').update(text).digest('hex');
  const done = await prisma.setting.findUnique({ where: { key: KEY } });
  if (done?.value === hash) return null;

  const parsed = parseProductCsv(text);
  // Grootboeknummers alleen overnemen als ze nog op de standaardwaarden staan
  const rates = await prisma.vatRate.findMany();
  const untouched = rates.every((r) => DEFAULT_REVENUE_CODES.includes(r.revenueAccountCode));
  const result = await applyImport(parsed, { applyLedger: untouched, hideDemoProducts: true }, null);
  await prisma.setting.upsert({ where: { key: KEY }, create: { key: KEY, value: hash }, update: { value: hash } });
  return `${result.created} nieuw, ${result.updated} bijgewerkt${result.ledgerApplied.length ? `, grootboek: ${result.ledgerApplied.join('; ')}` : ''}`;
}
