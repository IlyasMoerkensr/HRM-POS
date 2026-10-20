/**
 * Datumfuncties in Europe/Amsterdam. Een kassadag loopt van 00:00 tot 24:00
 * Nederlandse tijd, ook rond zomer-/wintertijd.
 */

export const SHOP_TIME_ZONE = 'Europe/Amsterdam';

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: SHOP_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Date → "2026-10-20" (Nederlandse kalenderdag). */
export function shopDateString(date: Date = new Date()): string {
  return dateFormatter.format(date);
}

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: SHOP_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
});

/** Verschil (ms) tussen Amsterdamse kloktijd en UTC op een bepaald moment. */
function offsetMs(utcMs: number): number {
  const parts = Object.fromEntries(
    partsFormatter.formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - (utcMs - (utcMs % 1000));
}

/** "2026-10-20" 00:00 Amsterdam → UTC Date */
function shopMidnight(dateString: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);
  if (!m) throw new Error(`Ongeldige datum: ${dateString} (verwacht JJJJ-MM-DD)`);
  const guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  let result = guess - offsetMs(guess);
  // Tweede ronde voor het geval de eerste gok aan de andere kant van een DST-wissel viel
  result = guess - offsetMs(result);
  return new Date(result);
}

/** Begin (inclusief) en eind (exclusief) van een kassadag in UTC. */
export function shopDayRange(dateString: string): { from: Date; until: Date } {
  const from = shopMidnight(dateString);
  const next = new Date(from.getTime() + 36 * 3600 * 1000); // ruim in de volgende dag
  return { from, until: shopMidnight(shopDateString(next)) };
}

export function shopYear(date: Date = new Date()): number {
  return Number(shopDateString(date).slice(0, 4));
}
