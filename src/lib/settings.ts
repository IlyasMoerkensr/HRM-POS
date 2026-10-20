import { prisma } from './prisma';

/** Instellingen uit de Setting-tabel (sleutel/waarde). */
export async function getSettings(): Promise<Record<string, string>> {
  const rows = await prisma.setting.findMany();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function getSetting(key: string, fallback: string): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row?.value ?? fallback;
}

export async function getNumberSetting(key: string, fallback: number): Promise<number> {
  const value = Number(await getSetting(key, String(fallback)));
  return Number.isFinite(value) ? value : fallback;
}

/** Instellingen die het admin-scherm mag wijzigen, met controle. */
export const EDITABLE_SETTINGS: Record<string, (value: string) => string | null> = {
  'drawer.kickCode': (v) => (v.trim().length > 0 && v.length < 200 ? null : 'Ongeldige kick-code'),
  'drawer.baudRate': (v) => (['2400', '4800', '9600', '19200', '38400', '57600', '115200'].includes(v) ? null : 'Ongeldige baudrate'),
  'drawer.trigger': (v) => (['escpos', 'dtr', 'rts'].includes(v) ? null : 'Ongeldige aansturing'),
  'drawer.keepPortOpen': (v) => (['true', 'false'].includes(v) ? null : 'Ongeldige waarde'),
  'mollie.defaultMode': (v) => (['API', 'MANUAL'].includes(v) ? null : 'Ongeldige pinmodus'),
  'pos.maxDiscountBpWithoutManager': (v) => (/^\d{1,5}$/.test(v) && Number(v) <= 10000 ? null : 'Ongeldig percentage'),
  'company.name': (v) => (v.trim().length > 0 && v.length <= 80 ? null : 'Ongeldige naam'),
};
