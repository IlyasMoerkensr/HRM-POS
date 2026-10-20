import { prisma } from './prisma';
import { getSettings } from './settings';
import type { DrawerSettings, PosCategory, PosProduct, PosUser } from './types';

export async function loadCatalog(): Promise<{ products: PosProduct[]; categories: PosCategory[] }> {
  const [products, categories] = await Promise.all([
    prisma.product.findMany({
      where: { active: true },
      include: { vatRate: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    }),
    prisma.category.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
  ]);
  return {
    products: products.map((p) => ({
      id: p.id,
      name: p.name,
      shortName: p.shortName,
      sku: p.sku,
      categoryId: p.categoryId,
      priceInclCents: p.priceInclCents,
      vatCode: p.vatRate.code,
      vatRateBp: p.vatRate.rateBp,
      revenueAccountCode: p.vatRate.revenueAccountCode,
      vatAccountCode: p.vatRate.vatAccountCode,
      openPrice: p.openPrice,
      favorite: p.favorite,
      color: p.color,
    })),
    categories: categories.map((c) => ({ id: c.id, name: c.name, color: c.color })),
  };
}

export async function loadUsers(): Promise<PosUser[]> {
  const users = await prisma.user.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  return users.map((u) => ({
    id: u.id,
    name: u.name,
    color: u.color,
    role: u.role,
    hasPin: Boolean(u.pinHash),
    hasPhone: Boolean(u.mollieTerminalId),
  }));
}

export async function loadDrawerSettings(): Promise<DrawerSettings> {
  const s = await getSettings();
  const trigger = s['drawer.trigger'];
  return {
    kickCode: s['drawer.kickCode'] ?? '1B 70 00 19 FA',
    baudRate: Number(s['drawer.baudRate'] ?? 9600) || 9600,
    trigger: trigger === 'dtr' || trigger === 'rts' ? trigger : 'escpos',
    keepPortOpen: (s['drawer.keepPortOpen'] ?? 'true') === 'true',
  };
}
