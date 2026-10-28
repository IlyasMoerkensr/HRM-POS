'use server';

/** Beheer: alleen vanaf de gekoppelde kassa-pc door een medewerker met rol ADMIN. */
import { audit } from '@/lib/audit';
import { run } from '@/lib/actionResult';
import { hashPin } from '@/lib/auth/pin';
import { requireAccount } from '@/lib/auth/accounts';
import { AuthError } from '@/lib/auth/session';
import { isMollieConfigured, linkPhoneToUser, listPhoneTerminals, mollieErrorMessage } from '@/lib/mollie/mollieService';
import { PosError } from '@/lib/orders/orderService';
import { applyImport, parseProductCsv, previewImport } from '@/lib/import/products';
import { prisma } from '@/lib/prisma';
import { EDITABLE_SETTINGS, getSettings } from '@/lib/settings';

const COLOR = /^#[0-9a-f]{6}$/i;

/** Beheer: ingelogd met e-mail en wachtwoord als eigenaar of beheerder. */
const requireAdmin = () => requireAccount(['OWNER', 'ADMIN']);

export async function adminDataAction() {
  return run(async () => {
    await requireAdmin();
    const [users, products, categories, vatRates, settings, ledger] = await Promise.all([
      prisma.user.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      prisma.product.findMany({ omit: { imageData: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      prisma.category.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      prisma.vatRate.findMany({ where: { active: true }, orderBy: { rateBp: 'desc' } }),
      getSettings(),
      prisma.ledgerAccount.findMany({ orderBy: { code: 'asc' } }),
    ]);
    return {
      users: users.map((u) => ({
        id: u.id, name: u.name, role: u.role, color: u.color, active: u.active, sortOrder: u.sortOrder,
        hasPin: Boolean(u.pinHash), mollieTerminalId: u.mollieTerminalId, phoneLabel: u.phoneLabel,
      })),
      products: products.map((p) => ({
        id: p.id, name: p.name, shortName: p.shortName, sku: p.sku, categoryId: p.categoryId, priceInclCents: p.priceInclCents,
        vatRateId: p.vatRateId, openPrice: p.openPrice, favorite: p.favorite, active: p.active, sortOrder: p.sortOrder, color: p.color,
        imageUrl: p.imageVersion > 0 && p.imageMime ? `/api/products/${p.id}/image?v=${p.imageVersion}` : null,
      })),
      categories: categories.map((c) => ({ id: c.id, name: c.name, color: c.color, sortOrder: c.sortOrder, active: c.active })),
      vatRates: vatRates.map((v) => ({ id: v.id, code: v.code, name: v.name, rateBp: v.rateBp, revenueAccountCode: v.revenueAccountCode, vatAccountCode: v.vatAccountCode })),
      ledger: ledger.map((a) => ({ code: a.code, name: a.name, purpose: a.purpose, active: a.active })),
      settings,
      mollieConfigured: isMollieConfigured(),
    };
  });
}

// ---------------------------------------------------------------- medewerkers

export interface UserInput {
  id?: string;
  name: string;
  role: 'MEDEWERKER' | 'MANAGER' | 'ADMIN';
  color: string;
  active: boolean;
  sortOrder: number;
}

export async function saveUserAction(input: UserInput) {
  return run(async () => {
    const admin = await requireAdmin();
    const name = input.name.trim();
    if (name.length < 1 || name.length > 40) throw new PosError('Vul een naam in (max. 40 tekens)');
    if (!COLOR.test(input.color)) throw new PosError('Ongeldige kleur');
    if (!['MEDEWERKER', 'MANAGER', 'ADMIN'].includes(input.role)) throw new PosError('Ongeldige rol');
    const data = { name, role: input.role, color: input.color, active: input.active, sortOrder: Math.trunc(input.sortOrder) || 0 };
    const user = input.id
      ? await prisma.user.update({ where: { id: input.id }, data })
      : await prisma.user.create({ data });
    await audit(prisma, { action: input.id ? 'USER_UPDATED' : 'USER_CREATED', accountId: admin.id, entity: 'User', entityId: user.id, data });
    return { id: user.id };
  });
}

/** Pincode instellen (4 cijfers) of wissen (null). */
export async function setUserPinAction(userId: string, pin: string | null) {
  return run(async () => {
    const admin = await requireAdmin();
    if (pin !== null && !/^\d{4}$/.test(pin)) throw new PosError('Pincode moet uit 4 cijfers bestaan');
    await prisma.user.update({ where: { id: userId }, data: { pinHash: pin ? hashPin(pin) : null } });
    await audit(prisma, { action: pin ? 'PIN_SET' : 'PIN_CLEARED', accountId: admin.id, entity: 'User', entityId: userId });
    return true as const;
  });
}

export async function listTerminalsAction() {
  return run(async () => {
    await requireAdmin();
    try {
      return await listPhoneTerminals();
    } catch (err) {
      throw new PosError(`Telefoons ophalen bij Mollie mislukt: ${mollieErrorMessage(err)}`);
    }
  });
}

export async function linkTerminalAction(userId: string, terminalId: string | null, phoneLabel?: string) {
  return run(async () => {
    const admin = await requireAdmin();
    if (terminalId !== null && !/^term_\w+$/.test(terminalId)) throw new PosError('Terminal-ID begint met term_');
    try {
      await linkPhoneToUser(userId, terminalId, admin.id, phoneLabel);
    } catch (err) {
      if (err instanceof Error && (err.name === 'PosPaymentError' || err.name === 'PosError')) throw err;
      throw new PosError(`Koppelen mislukt: ${mollieErrorMessage(err)}`);
    }
    return true as const;
  });
}

// ---------------------------------------------------------------- producten

export interface ProductInput {
  id?: string;
  name: string;
  shortName: string | null;
  sku: string | null;
  categoryId: string | null;
  priceInclCents: number;
  vatRateId: string;
  openPrice: boolean;
  favorite: boolean;
  active: boolean;
  sortOrder: number;
  color: string | null;
}

export async function saveProductAction(input: ProductInput) {
  return run(async () => {
    const admin = await requireAdmin();
    const name = input.name.trim();
    if (!name || name.length > 80) throw new PosError('Vul een productnaam in (max. 80 tekens)');
    if (!Number.isSafeInteger(input.priceInclCents) || input.priceInclCents < 0) throw new PosError('Ongeldige prijs');
    if (!input.openPrice && input.priceInclCents === 0) throw new PosError('Vul een prijs in, of zet "vrije prijs" aan');
    if (input.color && !COLOR.test(input.color)) throw new PosError('Ongeldige kleur');
    const vat = await prisma.vatRate.findUnique({ where: { id: input.vatRateId } });
    if (!vat) throw new PosError('Kies een btw-tarief');

    const data = {
      name,
      shortName: input.shortName?.trim().slice(0, 24) || null,
      sku: input.sku?.trim().slice(0, 40) || null,
      categoryId: input.categoryId || null,
      priceInclCents: input.priceInclCents,
      vatRateId: input.vatRateId,
      openPrice: input.openPrice,
      favorite: input.favorite,
      active: input.active,
      sortOrder: Math.trunc(input.sortOrder) || 0,
      color: input.color || null,
    };
    if (data.sku) {
      const clash = await prisma.product.findFirst({ where: { sku: data.sku, NOT: input.id ? { id: input.id } : undefined }, select: { name: true } });
      if (clash) throw new PosError(`Artikelcode ${data.sku} is al in gebruik bij ${clash.name}`);
    }
    const before = input.id ? await prisma.product.findUnique({ where: { id: input.id }, omit: { imageData: true } }) : null;
    const product = input.id
      ? await prisma.product.update({ where: { id: input.id }, data, omit: { imageData: true } })
      : await prisma.product.create({ data, omit: { imageData: true } });
    // Prijs- en btw-wijzigingen apart vastleggen voor de boekhouder
    if (before && (before.priceInclCents !== data.priceInclCents || before.vatRateId !== data.vatRateId)) {
      await audit(prisma, {
        action: 'PRICE_CHANGED',
        accountId: admin.id,
        entity: 'Product',
        entityId: product.id,
        data: { name, from: { price: before.priceInclCents, vatRateId: before.vatRateId }, to: { price: data.priceInclCents, vatRateId: data.vatRateId } },
      });
    }
    await audit(prisma, { action: input.id ? 'PRODUCT_UPDATED' : 'PRODUCT_CREATED', accountId: admin.id, entity: 'Product', entityId: product.id, data });
    return { id: product.id };
  });
}

export async function saveCategoryAction(input: { id?: string; name: string; color: string; sortOrder: number; active: boolean }) {
  return run(async () => {
    const admin = await requireAdmin();
    const name = input.name.trim();
    if (!name || name.length > 40) throw new PosError('Vul een categorienaam in');
    if (!COLOR.test(input.color)) throw new PosError('Ongeldige kleur');
    const data = { name, color: input.color, sortOrder: Math.trunc(input.sortOrder) || 0, active: input.active };
    const cat = input.id ? await prisma.category.update({ where: { id: input.id }, data }) : await prisma.category.create({ data });
    await audit(prisma, { action: 'CATEGORY_SAVED', accountId: admin.id, entity: 'Category', entityId: cat.id, data });
    return { id: cat.id };
  });
}

// ---------------------------------------------------------------- instellingen

export async function saveSettingsAction(values: Record<string, string>) {
  return run(async () => {
    const admin = await requireAdmin();
    for (const [key, value] of Object.entries(values)) {
      const validate = EDITABLE_SETTINGS[key];
      if (!validate) throw new AuthError(`Instelling ${key} mag niet gewijzigd worden`);
      const error = validate(value);
      if (error) throw new PosError(error);
    }
    const before = await getSettings();
    for (const [key, value] of Object.entries(values)) {
      if (before[key] === value) continue;
      await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
      await audit(prisma, { action: 'SETTING_CHANGED', accountId: admin.id, entity: 'Setting', entityId: key, data: { from: before[key] ?? null, to: value } });
    }
    return true as const;
  });
}

// ---------------------------------------------------------------- grootboek

/**
 * Rekeningnummer of -naam aanpassen aan het schema van de boekhouder.
 * De koppeling met de btw-tarieven verhuist automatisch mee.
 * Oude bonnen houden hun rekeningnummer (snapshot); exports gebruiken het nieuwe nummer.
 */
export async function saveLedgerAccountAction(input: { oldCode: string; code: string; name: string }) {
  return run(async () => {
    const admin = await requireAdmin();
    const code = input.code.trim();
    const name = input.name.trim();
    if (!/^[0-9A-Za-z.\-]{1,12}$/.test(code)) throw new PosError('Rekeningnummer: 1 tot 12 cijfers/letters');
    if (!name || name.length > 80) throw new PosError('Vul een rekeningnaam in');
    const existing = await prisma.ledgerAccount.findUnique({ where: { code: input.oldCode } });
    if (!existing) throw new PosError('Rekening niet gevonden');
    if (code !== input.oldCode && (await prisma.ledgerAccount.findUnique({ where: { code } }))) {
      throw new PosError(`Rekeningnummer ${code} bestaat al`);
    }
    await prisma.ledgerAccount.update({ where: { code: input.oldCode }, data: { code, name } });
    await audit(prisma, { action: 'LEDGER_CHANGED', accountId: admin.id, entity: 'LedgerAccount', entityId: code, data: { from: { code: existing.code, name: existing.name }, to: { code, name } } });
    return true as const;
  });
}

// ---------------------------------------------------------------- foto's

const MAX_IMAGE_BYTES = 600 * 1024;

function detectImage(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

/** Foto opslaan (de browser verkleint hem eerst tot max. 512 px). */
export async function saveProductImageAction(productId: string, form: FormData) {
  return run(async () => {
    const admin = await requireAdmin();
    const file = form.get('foto');
    if (!(file instanceof Blob) || file.size === 0) throw new PosError('Kies een foto');
    if (file.size > MAX_IMAGE_BYTES) throw new PosError('Foto is te groot (max. 600 kB na verkleinen)');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = detectImage(bytes);
    if (!mime) throw new PosError('Alleen JPG, PNG of WebP');
    const p = await prisma.product.update({
      where: { id: productId },
      data: { imageData: Buffer.from(bytes), imageMime: mime, imageVersion: { increment: 1 } },
      select: { id: true, imageVersion: true, name: true },
    });
    await audit(prisma, { action: 'PRODUCT_IMAGE_SET', accountId: admin.id, entity: 'Product', entityId: p.id, data: { name: p.name, bytes: bytes.length } });
    return { imageUrl: `/api/products/${p.id}/image?v=${p.imageVersion}` };
  });
}

export async function removeProductImageAction(productId: string) {
  return run(async () => {
    const admin = await requireAdmin();
    await prisma.product.update({ where: { id: productId }, data: { imageData: null, imageMime: null, imageVersion: { increment: 1 } }, select: { id: true } });
    await audit(prisma, { action: 'PRODUCT_IMAGE_REMOVED', accountId: admin.id, entity: 'Product', entityId: productId });
    return true as const;
  });
}

// ---------------------------------------------------------------- import

export async function previewImportAction(csv: string) {
  return run(async () => {
    await requireAdmin();
    if (csv.length > 2_000_000) throw new PosError('Bestand is te groot');
    let parsed;
    try {
      parsed = parseProductCsv(csv);
    } catch (err) {
      throw new PosError(err instanceof Error ? err.message : String(err));
    }
    return previewImport(prisma, parsed);
  });
}

export async function applyImportAction(csv: string, options: { applyLedger: boolean; hideDemoProducts: boolean }) {
  return run(async () => {
    const admin = await requireAdmin();
    let parsed;
    try {
      parsed = parseProductCsv(csv);
    } catch (err) {
      throw new PosError(err instanceof Error ? err.message : String(err));
    }
    return applyImport(parsed, options, admin.id);
  });
}
