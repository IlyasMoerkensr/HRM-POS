/**
 * Basisgegevens: 5 medewerkers, grootboekrekeningen, btw-tarieven,
 * kassalade-instellingen en een paar voorbeeldproducten.
 * Veilig om opnieuw te draaien (upsert). Namen/pincodes daarna aanpassen in admin.
 *
 *   npm run db:seed
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const ledgerAccounts = [
  { code: '1000', name: 'Kas', purpose: 'CASH' },
  { code: '1090', name: 'Kas onderweg / kluis', purpose: 'CASH_TRANSFER' },
  { code: '1100', name: 'Bank', purpose: 'BANK' },
  { code: '1150', name: 'Tussenrekening Mollie (kruisposten pin)', purpose: 'MOLLIE_CLEARING' },
  { code: '1520', name: 'Voorbelasting (btw op Mollie-kosten)', purpose: 'VAT_RECEIVABLE' },
  { code: '1600', name: 'Af te dragen btw hoog (21%)', purpose: 'VAT_PAYABLE' },
  { code: '1610', name: 'Af te dragen btw laag (9%)', purpose: 'VAT_PAYABLE' },
  { code: '4610', name: 'Transactiekosten Mollie', purpose: 'PAYMENT_FEES' },
  { code: '8000', name: 'Omzet hoog (21%)', purpose: 'REVENUE' },
  { code: '8010', name: 'Omzet laag (9%)', purpose: 'REVENUE' },
  { code: '8020', name: 'Omzet 0% / vrijgesteld', purpose: 'REVENUE' },
  { code: '8990', name: 'Kasverschillen', purpose: 'CASH_DIFFERENCE' },
];

const vatRates = [
  { code: 'HOOG', name: 'Hoog (21%)', rateBp: 2100, revenueAccountCode: '8000', vatAccountCode: '1600' },
  { code: 'LAAG', name: 'Laag (9%)', rateBp: 900, revenueAccountCode: '8010', vatAccountCode: '1610' },
  { code: 'NUL', name: '0% / vrijgesteld', rateBp: 0, revenueAccountCode: '8020', vatAccountCode: null },
];

const settings: Record<string, string> = {
  'drawer.kickCode': '1B 70 00 19 FA',
  'drawer.baudRate': '9600',
  'drawer.trigger': 'escpos',
  'drawer.keepPortOpen': 'true',
  'mollie.defaultMode': 'API', // API | PUSH | MANUAL
  'pos.requirePin': 'false',
  'pos.maxDiscountBpWithoutManager': '1000', // 10%
  'company.name': 'HRM Fitness Urmond',
};

async function main() {
  for (const a of ledgerAccounts) {
    await prisma.ledgerAccount.upsert({ where: { code: a.code }, create: a, update: { name: a.name, purpose: a.purpose } });
  }
  for (const v of vatRates) {
    await prisma.vatRate.upsert({ where: { code: v.code }, create: v, update: {} });
  }
  for (const [key, value] of Object.entries(settings)) {
    await prisma.setting.upsert({ where: { key }, create: { key, value }, update: {} });
  }

  const colors = ['#2563eb', '#16a34a', '#db2777', '#ea580c', '#7c3aed'];
  for (let i = 0; i < 5; i++) {
    const id = `seed-user-${i + 1}`;
    await prisma.user.upsert({
      where: { id },
      create: { id, name: `Medewerker ${i + 1}`, role: i === 0 ? 'ADMIN' : 'MEDEWERKER', color: colors[i], sortOrder: i },
      update: {},
    });
  }

  const hoog = await prisma.vatRate.findUniqueOrThrow({ where: { code: 'HOOG' } });
  const laag = await prisma.vatRate.findUniqueOrThrow({ where: { code: 'LAAG' } });
  const drinks = await prisma.category.upsert({
    where: { id: 'seed-cat-drinks' },
    create: { id: 'seed-cat-drinks', name: 'Dranken', color: '#0ea5e9', sortOrder: 0 },
    update: {},
  });
  const shop = await prisma.category.upsert({
    where: { id: 'seed-cat-shop' },
    create: { id: 'seed-cat-shop', name: 'Shop', color: '#f59e0b', sortOrder: 1 },
    update: {},
  });

  // VOORBEELDEN — prijzen en btw-tarieven laten controleren door de boekhouder
  const products = [
    { id: 'seed-p-water', name: 'Flesje water 0,5 L', shortName: 'Water', categoryId: drinks.id, priceInclCents: 200, vatRateId: laag.id, favorite: true },
    { id: 'seed-p-shake', name: 'Eiwitshake', shortName: 'Shake', categoryId: drinks.id, priceInclCents: 350, vatRateId: laag.id, favorite: true },
    { id: 'seed-p-towel', name: 'Sporthanddoek', shortName: 'Handdoek', categoryId: shop.id, priceInclCents: 1295, vatRateId: hoog.id },
    { id: 'seed-p-div-hoog', name: 'Diversen 21%', shortName: 'Div. 21%', categoryId: shop.id, priceInclCents: 0, vatRateId: hoog.id, openPrice: true },
    { id: 'seed-p-div-laag', name: 'Diversen 9%', shortName: 'Div. 9%', categoryId: shop.id, priceInclCents: 0, vatRateId: laag.id, openPrice: true },
  ];
  for (const p of products) {
    await prisma.product.upsert({ where: { id: p.id }, create: p, update: {} });
  }
}

main()
  .then(() => console.log('Seed klaar'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
