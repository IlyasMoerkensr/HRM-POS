'use server';

/** Beheer: alleen vanaf de gekoppelde kassa-pc door een medewerker met rol ADMIN. */
import { audit } from '@/lib/audit';
import { run } from '@/lib/actionResult';
import { hashPin } from '@/lib/auth/pin';
import { AuthError, requireAdmin } from '@/lib/auth/session';
import { isMollieConfigured, linkPhoneToUser, listPhoneTerminals, mollieErrorMessage } from '@/lib/mollie/mollieService';
import { PosError } from '@/lib/orders/orderService';
import { prisma } from '@/lib/prisma';
import { EDITABLE_SETTINGS, getSettings } from '@/lib/settings';

const COLOR = /^#[0-9a-f]{6}$/i;

export async function adminDataAction() {
  return run(async () => {
    await requireAdmin();
    const [users, products, categories, vatRates, settings] = await Promise.all([
      prisma.user.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      prisma.product.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      prisma.category.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      prisma.vatRate.findMany({ where: { active: true }, orderBy: { rateBp: 'desc' } }),
      getSettings(),
    ]);
    return {
      users: users.map((u) => ({
        id: u.id, name: u.name, role: u.role, color: u.color, active: u.active, sortOrder: u.sortOrder,
        hasPin: Boolean(u.pinHash), mollieTerminalId: u.mollieTerminalId, phoneLabel: u.phoneLabel,
      })),
      products: products.map((p) => ({
        id: p.id, name: p.name, shortName: p.shortName, sku: p.sku, categoryId: p.categoryId, priceInclCents: p.priceInclCents,
        vatRateId: p.vatRateId, openPrice: p.openPrice, favorite: p.favorite, active: p.active, sortOrder: p.sortOrder, color: p.color,
      })),
      categories: categories.map((c) => ({ id: c.id, name: c.name, color: c.color, sortOrder: c.sortOrder, active: c.active })),
      vatRates: vatRates.map((v) => ({ id: v.id, code: v.code, name: v.name, rateBp: v.rateBp })),
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
    if (input.id === admin.id && (input.role !== 'ADMIN' || !input.active)) {
      throw new PosError('Je kunt jezelf niet als beheerder uitschakelen');
    }
    const data = { name, role: input.role, color: input.color, active: input.active, sortOrder: Math.trunc(input.sortOrder) || 0 };
    const user = input.id
      ? await prisma.user.update({ where: { id: input.id }, data })
      : await prisma.user.create({ data });
    await audit(prisma, { action: input.id ? 'USER_UPDATED' : 'USER_CREATED', userId: admin.id, entity: 'User', entityId: user.id, data });
    return { id: user.id };
  });
}

/** Pincode instellen (4 cijfers) of wissen (null). */
export async function setUserPinAction(userId: string, pin: string | null) {
  return run(async () => {
    const admin = await requireAdmin();
    if (pin !== null && !/^\d{4}$/.test(pin)) throw new PosError('Pincode moet uit 4 cijfers bestaan');
    await prisma.user.update({ where: { id: userId }, data: { pinHash: pin ? hashPin(pin) : null } });
    await audit(prisma, { action: pin ? 'PIN_SET' : 'PIN_CLEARED', userId: admin.id, entity: 'User', entityId: userId });
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
      const clash = await prisma.product.findFirst({ where: { sku: data.sku, NOT: input.id ? { id: input.id } : undefined } });
      if (clash) throw new PosError(`Artikelcode ${data.sku} is al in gebruik bij ${clash.name}`);
    }
    const before = input.id ? await prisma.product.findUnique({ where: { id: input.id } }) : null;
    const product = input.id
      ? await prisma.product.update({ where: { id: input.id }, data })
      : await prisma.product.create({ data });
    // Prijs- en btw-wijzigingen apart vastleggen voor de boekhouder
    if (before && (before.priceInclCents !== data.priceInclCents || before.vatRateId !== data.vatRateId)) {
      await audit(prisma, {
        action: 'PRICE_CHANGED',
        userId: admin.id,
        entity: 'Product',
        entityId: product.id,
        data: { name, from: { price: before.priceInclCents, vatRateId: before.vatRateId }, to: { price: data.priceInclCents, vatRateId: data.vatRateId } },
      });
    }
    await audit(prisma, { action: input.id ? 'PRODUCT_UPDATED' : 'PRODUCT_CREATED', userId: admin.id, entity: 'Product', entityId: product.id, data });
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
    await audit(prisma, { action: 'CATEGORY_SAVED', userId: admin.id, entity: 'Category', entityId: cat.id, data });
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
      await audit(prisma, { action: 'SETTING_CHANGED', userId: admin.id, entity: 'Setting', entityId: key, data: { from: before[key] ?? null, to: value } });
    }
    return true as const;
  });
}
