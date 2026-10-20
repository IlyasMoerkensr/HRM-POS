/**
 * Inloggen zonder wachtwoorden, maar wel veilig genoeg voor een winkel-wifi
 * waar ook klanten op kunnen zitten:
 *
 *  - KASSA-PC: wordt één keer "gekoppeld" met de koppelcode uit het
 *    startvenster (PAIRING_CODE in .env). Daarna mag deze browser kassa-acties
 *    doen. Wie er op dat moment afrekent, staat in een tweede cookie
 *    (medewerker-snelwissel, met pincode als die is ingesteld).
 *  - TELEFOON: medewerker kiest naam + pincode. De eerste keer (nog geen
 *    pincode) is ook de koppelcode nodig en kiest de medewerker een pincode.
 *
 * Cookies zijn ondertekend met SESSION_SECRET (HMAC), dus niet na te maken.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';

import { prisma } from '../prisma';
import { hashPin, verifyPin } from './pin';

const DEVICE_COOKIE = 'kassa_device';
const ACTIVE_COOKIE = 'kassa_active';
const PHONE_COOKIE = 'kassa_phone';

const DEVICE_MAX_AGE = 60 * 60 * 24 * 365; // 1 jaar
const ACTIVE_MAX_AGE = 60 * 60 * 14; // één werkdag
const PHONE_MAX_AGE = 60 * 60 * 24 * 30; // 30 dagen

export class AuthError extends Error {
  readonly name = 'AuthError';
}

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET ontbreekt in .env (start de kassa via start.bat)');
  return s;
}

function sign(payload: object): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verify<T>(token: string | undefined): T | null {
  if (!token) return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expected = createHmac('sha256', secret()).update(body).digest();
  const given = Buffer.from(mac, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as T & { exp: number };
    return payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  // Lokaal draait de kassa op http (localhost / wifi), dus geen 'secure'
  secure: false,
  path: '/',
  maxAge,
});

// --- Pincode-pogingen beperken (in geheugen, per medewerker) ---------------
const attempts = new Map<string, { count: number; until: number }>();

function checkRateLimit(key: string) {
  const a = attempts.get(key);
  if (a && a.until > Date.now() && a.count >= 5) {
    throw new AuthError('Te veel foute pogingen. Wacht 5 minuten.');
  }
}
function registerFailure(key: string) {
  const a = attempts.get(key);
  const until = Date.now() + 5 * 60 * 1000;
  attempts.set(key, { count: a && a.until > Date.now() ? a.count + 1 : 1, until });
}

function pairingCodeMatches(code: string): boolean {
  const expected = process.env.PAIRING_CODE ?? '';
  if (expected.length < 6) throw new Error('PAIRING_CODE ontbreekt in .env (start de kassa via start.bat)');
  const a = Buffer.from(code.trim());
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ===========================================================================
//  Kassa-pc
// ===========================================================================

export async function pairDevice(code: string) {
  checkRateLimit('pairing');
  if (!pairingCodeMatches(code)) {
    registerFailure('pairing');
    throw new AuthError('Koppelcode klopt niet');
  }
  const jar = await cookies();
  jar.set(DEVICE_COOKIE, sign({ kind: 'device', exp: Date.now() + DEVICE_MAX_AGE * 1000 }), cookieOptions(DEVICE_MAX_AGE));
}

export async function isPairedDevice(): Promise<boolean> {
  const jar = await cookies();
  return verify<{ kind: string }>(jar.get(DEVICE_COOKIE)?.value)?.kind === 'device';
}

export async function requireDevice() {
  if (!(await isPairedDevice())) throw new AuthError('Deze browser is niet gekoppeld als kassa');
}

/** Medewerker-snelwissel op de kassa-pc. */
export async function switchActiveEmployee(userId: string, pin: string | null) {
  await requireDevice();
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.active) throw new AuthError('Onbekende medewerker');
  if (user.pinHash) {
    checkRateLimit(user.id);
    if (!pin || !verifyPin(pin, user.pinHash)) {
      registerFailure(user.id);
      throw new AuthError('Pincode klopt niet');
    }
  }
  attempts.delete(user.id);
  const jar = await cookies();
  jar.set(ACTIVE_COOKIE, sign({ kind: 'active', userId: user.id, exp: Date.now() + ACTIVE_MAX_AGE * 1000 }), cookieOptions(ACTIVE_MAX_AGE));
  return user;
}

export async function clearActiveEmployee() {
  const jar = await cookies();
  jar.delete(ACTIVE_COOKIE);
}

export async function getActiveEmployeeId(): Promise<string | null> {
  if (!(await isPairedDevice())) return null;
  const jar = await cookies();
  return verify<{ kind: string; userId: string }>(jar.get(ACTIVE_COOKIE)?.value)?.userId ?? null;
}

// ===========================================================================
//  Telefoon
// ===========================================================================

export async function phoneLogin(input: { userId: string; pin: string; pairingCode?: string; newPin?: string }) {
  const user = await prisma.user.findUnique({ where: { id: input.userId } });
  if (!user || !user.active) throw new AuthError('Onbekende medewerker');
  checkRateLimit(`phone:${user.id}`);

  if (!user.pinHash) {
    // Eerste keer: koppelcode + zelf een pincode kiezen
    if (!input.pairingCode || !pairingCodeMatches(input.pairingCode)) {
      registerFailure(`phone:${user.id}`);
      throw new AuthError('Koppelcode klopt niet');
    }
    if (!input.newPin || !/^\d{4}$/.test(input.newPin)) throw new AuthError('Kies een pincode van 4 cijfers');

    await prisma.user.update({ where: { id: user.id }, data: { pinHash: hashPin(input.newPin) } });
  } else if (!verifyPin(input.pin, user.pinHash)) {
    registerFailure(`phone:${user.id}`);
    throw new AuthError('Pincode klopt niet');
  }
  attempts.delete(`phone:${user.id}`);
  const jar = await cookies();
  jar.set(PHONE_COOKIE, sign({ kind: 'phone', userId: user.id, exp: Date.now() + PHONE_MAX_AGE * 1000 }), cookieOptions(PHONE_MAX_AGE));
  return user;
}

export async function phoneLogout() {
  const jar = await cookies();
  jar.delete(PHONE_COOKIE);
}

export async function getPhoneUserId(): Promise<string | null> {
  const jar = await cookies();
  return verify<{ kind: string; userId: string }>(jar.get(PHONE_COOKIE)?.value)?.userId ?? null;
}

// ===========================================================================
//  Wie doet deze actie?
// ===========================================================================

export interface Actor {
  id: string;
  name: string;
  role: 'MEDEWERKER' | 'MANAGER' | 'ADMIN';
  channel: 'kassa' | 'telefoon';
}

async function loadActor(userId: string | null, channel: Actor['channel']): Promise<Actor> {
  if (!userId) throw new AuthError(channel === 'kassa' ? 'Kies eerst een medewerker' : 'Log opnieuw in');
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.active) throw new AuthError('Medewerker is niet (meer) actief');
  return { id: user.id, name: user.name, role: user.role, channel };
}

/** Actie vanaf de kassa-pc (lade, contant, beheer). */
export async function requireKassaActor(): Promise<Actor> {
  await requireDevice();
  return loadActor(await getActiveEmployeeId(), 'kassa');
}

/** Actie vanaf de telefoon van een medewerker. */
export async function requirePhoneActor(): Promise<Actor> {
  return loadActor(await getPhoneUserId(), 'telefoon');
}

/** Kassa-pc óf telefoon (bijv. pinbetaling starten, status opvragen). */
export async function requireAnyActor(): Promise<Actor> {
  const activeId = await getActiveEmployeeId();
  if (activeId) return loadActor(activeId, 'kassa');
  return loadActor(await getPhoneUserId(), 'telefoon');
}

export async function requireAdmin(): Promise<Actor> {
  const actor = await requireKassaActor();
  if (actor.role !== 'ADMIN') throw new AuthError('Alleen een beheerder mag dit');
  return actor;
}
