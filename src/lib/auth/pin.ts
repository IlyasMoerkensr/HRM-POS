import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/** Pincode → "scrypt$salt$hash". Alleen server-side gebruiken. */
export function hashPin(pin: string): string {
  if (!/^\d{4}$/.test(pin)) throw new Error('Pincode moet uit 4 cijfers bestaan');
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(pin, salt, 32).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPin(pin: string, stored: string | null): boolean {
  if (stored === null) return true; // geen pincode ingesteld
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const candidate = scryptSync(pin, salt, 32);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}
