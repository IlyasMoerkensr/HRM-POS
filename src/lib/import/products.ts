/**
 * Producten importeren uit een CSV (bijv. export van een vorig kassasysteem).
 *
 * Herkent kolommen op naam (Nederlands of Engels):
 *   naam:      Title / Naam / Name / Product / Omschrijving
 *   prijs:     Incl VAT price / Prijs incl / Verkoopprijs / Price   (anders: Excl VAT price + btw)
 *   btw:       VAT % / Btw % / Btw                                   (eerste kolom = verkoop)
 *   categorie: Product category / Categorie / Category / Groep
 *   code:      UPC (barcode) / Barcode / EAN / SKU / Artikelcode
 *   grootboek: Ledger title / Grootboek                              (bijv. "80003 Omzet 9%")
 *
 * Bestaande producten (zelfde barcode of zelfde naam) worden bijgewerkt, nieuwe aangemaakt.
 */
import { audit } from '../audit';
import { prisma, type Db } from '../prisma';

export interface ImportRow {
  line: number;
  name: string;
  barcode: string | null;
  priceInclCents: number;
  vatCode: 'HOOG' | 'LAAG' | 'NUL';
  category: string | null;
  ledgerCode: string | null;
  ledgerTitle: string | null;
  warnings: string[];
}

export interface ParsedImport {
  rows: ImportRow[];
  skipped: { line: number; reason: string }[];
  /** Omzetrekening per btw-tarief volgens het bestand (bijv. LAAG → 80003) */
  ledger: { vatCode: 'HOOG' | 'LAAG' | 'NUL'; code: string; title: string }[];
}

/** CSV met ; of , als scheidingsteken, aanhalingstekens en BOM. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const sep = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** "2.0" / "2,00" / "€ 1.234,50" / "1,234.50" → centen */
export function parsePrice(raw: string): number | null {
  let s = raw.replace(/[€\s]/g, '');
  if (!s) return null;
  if (s.includes(',') && s.includes('.')) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else s = s.replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const [whole, frac = ''] = s.replace('-', '').split('.');
  // Afronden op centen zonder floats: derde decimaal bepaalt
  let cents = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  if (Number((frac + '000')[2]) >= 5) cents += 1;
  return s.startsWith('-') ? -cents : cents;
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim();

function findColumn(header: string[], names: string[]): number {
  const h = header.map(norm);
  for (const name of names) {
    const i = h.findIndex((x) => x === name);
    if (i >= 0) return i;
  }
  for (const name of names) {
    const i = h.findIndex((x) => x.includes(name));
    if (i >= 0) return i;
  }
  return -1;
}

function vatCodeFor(percent: number): ImportRow['vatCode'] | null {
  if (Math.abs(percent - 21) < 0.01) return 'HOOG';
  if (Math.abs(percent - 9) < 0.01) return 'LAAG';
  if (Math.abs(percent) < 0.01) return 'NUL';
  return null;
}

const RATE: Record<ImportRow['vatCode'], number> = { HOOG: 21, LAAG: 9, NUL: 0 };

export function parseProductCsv(text: string): ParsedImport {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('Het bestand bevat geen producten');
  const header = rows[0];
  const col = {
    name: findColumn(header, ['title', 'naam', 'name', 'product', 'omschrijving', 'productnaam']),
    incl: findColumn(header, ['incl vat price', 'prijs incl btw', 'prijs incl', 'verkoopprijs', 'price incl', 'prijs', 'price']),
    excl: findColumn(header, ['excl vat price', 'prijs excl btw', 'prijs excl']),
    vat: findColumn(header, ['vat %', 'btw %', 'btw', 'vat']),
    category: findColumn(header, ['product category', 'categorie', 'category', 'groep']),
    barcode: findColumn(header, ['upc barcode', 'barcode', 'ean', 'sku', 'artikelcode']),
    ledger: findColumn(header, ['ledger title', 'grootboek']),
  };
  if (col.name < 0) throw new Error('Kolom met de productnaam niet gevonden (bijv. "Title" of "Naam")');
  if (col.incl < 0 && col.excl < 0) throw new Error('Kolom met de prijs niet gevonden (bijv. "Incl VAT price")');
  if (col.vat < 0) throw new Error('Kolom met het btw-percentage niet gevonden (bijv. "VAT %")');
  // "Incl VAT price purchase" mag niet als verkoopprijs gelden
  if (col.incl >= 0 && /purchase|inkoop/.test(norm(header[col.incl]))) col.incl = -1;

  const result: ImportRow[] = [];
  const skipped: ParsedImport['skipped'] = [];
  const seen = new Set<string>();

  rows.slice(1).forEach((r, idx) => {
    const line = idx + 2;
    const get = (i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
    const name = get(col.name).replace(/\s+/g, ' ');
    if (!name) return skipped.push({ line, reason: 'geen naam' });
    if (name.length > 80) return skipped.push({ line, reason: 'naam langer dan 80 tekens' });
    const key = name.toLowerCase();
    if (seen.has(key)) return skipped.push({ line, reason: `"${name}" staat dubbel in het bestand` });

    const vatPercent = Number(get(col.vat).replace(',', '.').replace('%', ''));
    const vatCode = Number.isFinite(vatPercent) ? vatCodeFor(vatPercent) : null;
    if (!vatCode) return skipped.push({ line, reason: `onbekend btw-percentage "${get(col.vat)}" bij ${name}` });

    const warnings: string[] = [];
    let incl = col.incl >= 0 ? parsePrice(get(col.incl)) : null;
    const excl = col.excl >= 0 ? parsePrice(get(col.excl)) : null;
    if (incl === null && excl !== null) incl = Math.round((excl * (100 + RATE[vatCode])) / 100);
    if (incl === null || incl <= 0) return skipped.push({ line, reason: `geen geldige prijs bij ${name}` });
    if (excl !== null && Math.abs(Math.round((excl * (100 + RATE[vatCode])) / 100) - incl) > 2) {
      warnings.push(`prijs excl. (${(excl / 100).toFixed(2)}) past niet bij incl. (${(incl / 100).toFixed(2)}) met ${RATE[vatCode]}% btw`);
    }

    const ledgerTitle = get(col.ledger) || null;
    const ledgerCode = ledgerTitle?.match(/^\s*(\d{3,8})\b/)?.[1] ?? null;
    const ledgerRate = ledgerTitle?.match(/(\d{1,2})\s*%/)?.[1];
    if (ledgerRate !== undefined && Number(ledgerRate) !== RATE[vatCode]) {
      warnings.push(`btw ${RATE[vatCode]}% maar grootboek "${ledgerTitle}" — laat de boekhouder controleren`);
    }
    const barcode = get(col.barcode).replace(/\s/g, '') || null;

    seen.add(key);
    result.push({
      line,
      name,
      barcode: barcode && barcode.length <= 40 ? barcode : null,
      priceInclCents: incl,
      vatCode,
      category: get(col.category) || null,
      ledgerCode,
      ledgerTitle,
      warnings,
    });
  });

  // Omzetrekening per tarief: meest gebruikte code, alleen van regels zonder tegenstrijdigheid
  const ledger: ParsedImport['ledger'] = [];
  for (const vatCode of ['HOOG', 'LAAG', 'NUL'] as const) {
    const counts = new Map<string, { n: number; title: string }>();
    for (const r of result) {
      if (r.vatCode !== vatCode || !r.ledgerCode || r.warnings.some((w) => w.includes('grootboek'))) continue;
      const c = counts.get(r.ledgerCode) ?? { n: 0, title: r.ledgerTitle!.replace(/^\s*\d+\s*/, '') || r.ledgerTitle! };
      c.n += 1;
      counts.set(r.ledgerCode, c);
    }
    const best = [...counts.entries()].sort((a, b) => b[1].n - a[1].n)[0];
    if (best) ledger.push({ vatCode, code: best[0], title: best[1].title });
  }

  return { rows: result, skipped, ledger };
}

// ===========================================================================

const CATEGORY_COLORS = ['#0ea5e9', '#f59e0b', '#8b5cf6', '#10b981', '#ef4444', '#ec4899', '#14b8a6', '#6366f1'];

export interface ApplyOptions {
  /** Omzetrekeningen overnemen uit het bestand (Beheer → Grootboek) */
  applyLedger: boolean;
  /** Voorbeeldproducten van de installatie verbergen */
  hideDemoProducts: boolean;
}

export interface ImportPreviewRow extends ImportRow {
  action: 'nieuw' | 'bijwerken' | 'ongewijzigd';
  current?: { priceInclCents: number; vatCode: string; category: string | null };
}

/** Wat er zou gebeuren, zonder iets op te slaan. */
export async function previewImport(db: Db, parsed: ParsedImport) {
  const products = await db.product.findMany({ omit: { imageData: true }, include: { vatRate: true, category: true } });
  const vatRates = await db.vatRate.findMany();
  const rows: ImportPreviewRow[] = parsed.rows.map((r) => {
    const match = findMatch(products, r);
    if (!match) return { ...r, action: 'nieuw' };
    const current = { priceInclCents: match.priceInclCents, vatCode: match.vatRate.code, category: match.category?.name ?? null };
    const same = current.priceInclCents === r.priceInclCents && current.vatCode === r.vatCode && (r.category ?? null) === current.category && match.active;
    return { ...r, action: same ? 'ongewijzigd' : 'bijwerken', current };
  });
  const ledgerChanges = parsed.ledger
    .map((l) => {
      const rate = vatRates.find((v) => v.code === l.vatCode);
      return rate ? { ...l, currentCode: rate.revenueAccountCode } : null;
    })
    .filter((l): l is NonNullable<typeof l> => l !== null && l.code !== l.currentCode);
  const demo = products.filter((p) => ['seed-p-water', 'seed-p-shake', 'seed-p-towel'].includes(p.id) && p.active).map((p) => p.name);
  return { rows, skipped: parsed.skipped, ledgerChanges, demoProducts: demo };
}

function findMatch<T extends { name: string; sku: string | null }>(products: T[], r: ImportRow): T | undefined {
  return (r.barcode ? products.find((p) => p.sku === r.barcode) : undefined) ?? products.find((p) => p.name.toLowerCase() === r.name.toLowerCase());
}

export async function applyImport(parsed: ParsedImport, options: ApplyOptions, userId: string | null) {
  return prisma.$transaction(async (tx) => {
    const vatRates = await tx.vatRate.findMany();
    const vatId = new Map(vatRates.map((v) => [v.code, v.id]));

    // Grootboek eerst, zodat de btw-koppeling meeverhuist
    const ledgerApplied: string[] = [];
    if (options.applyLedger) {
      for (const l of parsed.ledger) {
        const rate = vatRates.find((v) => v.code === l.vatCode);
        if (!rate || rate.revenueAccountCode === l.code) continue;
        const clash = await tx.ledgerAccount.findUnique({ where: { code: l.code } });
        if (clash) {
          // Rekening bestaat al: koppel het tarief er alleen aan
          await tx.vatRate.update({ where: { id: rate.id }, data: { revenueAccountCode: l.code } });
        } else {
          await tx.ledgerAccount.update({ where: { code: rate.revenueAccountCode }, data: { code: l.code, name: l.title } });
        }
        await audit(tx, { action: 'LEDGER_CHANGED', userId, entity: 'LedgerAccount', entityId: l.code, data: { from: rate.revenueAccountCode, to: l.code, source: 'import' } });
        ledgerApplied.push(`${l.title}: ${rate.revenueAccountCode} → ${l.code}`);
      }
    }

    // Categorieën
    const categories = await tx.category.findMany();
    const catId = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));
    let sort = categories.length;
    for (const name of new Set(parsed.rows.map((r) => r.category).filter((c): c is string => Boolean(c)))) {
      if (catId.has(name.toLowerCase())) continue;
      const c = await tx.category.create({ data: { name: name.slice(0, 40), color: CATEGORY_COLORS[sort % CATEGORY_COLORS.length], sortOrder: sort++ } });
      catId.set(name.toLowerCase(), c.id);
    }

    const products = await tx.product.findMany({ omit: { imageData: true } });
    let created = 0;
    let updated = 0;
    let order = products.length;
    for (const r of parsed.rows) {
      const match = findMatch(products, r);
      const skuFree = r.barcode ? !products.some((p) => p.sku === r.barcode && p.id !== match?.id) : true;
      const data = {
        name: r.name,
        priceInclCents: r.priceInclCents,
        vatRateId: vatId.get(r.vatCode)!,
        categoryId: r.category ? catId.get(r.category.toLowerCase()) ?? null : null,
        sku: skuFree ? r.barcode ?? match?.sku ?? null : match?.sku ?? null,
        active: true,
        openPrice: false,
      };
      if (match) {
        if (match.priceInclCents !== data.priceInclCents || match.vatRateId !== data.vatRateId) {
          await audit(tx, {
            action: 'PRICE_CHANGED',
            userId,
            entity: 'Product',
            entityId: match.id,
            data: { name: r.name, from: { price: match.priceInclCents, vatRateId: match.vatRateId }, to: { price: data.priceInclCents, vatRateId: data.vatRateId }, source: 'import' },
          });
        }
        await tx.product.update({ where: { id: match.id }, data });
        updated++;
      } else {
        const p = await tx.product.create({ data: { ...data, sortOrder: order++ }, omit: { imageData: true } });
        products.push(p);
        created++;
      }
    }

    if (options.hideDemoProducts) {
      await tx.product.updateMany({ where: { id: { in: ['seed-p-water', 'seed-p-shake', 'seed-p-towel'] } }, data: { active: false } });
      // Voorbeeldcategorieën opruimen: "Dranken" was alleen voor de voorbeelden, "Shop" houdt de Diversen-knoppen
      await tx.category.updateMany({ where: { id: 'seed-cat-drinks', products: { none: { active: true } } }, data: { active: false } });
      await tx.category.updateMany({ where: { id: 'seed-cat-shop', name: 'Shop' }, data: { name: 'Overig', sortOrder: 99 } });
      await tx.product.updateMany({ where: { id: { in: ['seed-p-div-hoog', 'seed-p-div-laag'] }, sortOrder: { lt: 900 } }, data: { sortOrder: 900 } });
    }

    await audit(tx, { action: 'PRODUCTS_IMPORTED', userId, data: { created, updated, skipped: parsed.skipped.length, ledger: ledgerApplied } });
    return { created, updated, skipped: parsed.skipped.length, ledgerApplied };
  });
}
