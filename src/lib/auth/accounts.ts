/**
 * Inloggen met e-mail en wachtwoord voor Beheer, rapporten en export.
 * Werkt op de kassa-pc én op afstand (bijv. de boekhouder thuis).
 *
 * Rollen:
 *   OWNER       eigenaar: alles, inclusief accounts beheren
 *   ADMIN       beheer van producten, medewerkers en instellingen
 *   ACCOUNTANT  boekhouder: alleen Z-rapporten en export bekijken
 *
 * Beveiliging:
 *   - wachtwoorden met scrypt gehasht, minimaal 10 tekens
 *   - na 8 foute pogingen 15 minuten geblokkeerd (in de database)
 *   - sessie-cookie ondertekend; wachtwoord wijzigen logt alle sessies uit
 *   - het allereerste account en "wachtwoord vergeten" kunnen alleen op het
 *     eigen netwerk, met de koppelcode uit het startvenster
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { cookies, headers } from 'next/headers';

import type { Account, AccountRole } from '@prisma/client';

import { audit } from '../audit';
import { prisma } from '../prisma';
import { isHttpsRequest } from './network';
import { assertLocal, AuthError, pairingCodeMatches, sign, verify } from './session';

const COOKIE = 'kassa_account';
const MAX_AGE = 60 * 60 * 12; // 12 uur
const MAX_FAILED = 8;
const LOCK_MINUTES = 15;
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;

function scrypt(password: string, salt: string, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => scryptCb(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key))));
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validatePassword(password: string): string | null {
  if (password.length < 10) return 'Wachtwoord moet minimaal 10 tekens lang zijn';
  if (password.length > 200) return 'Wachtwoord is te lang';
  if (/^(.)\1+$/.test(password)) return 'Kies een minder voorspelbaar wachtwoord';
  return null;
}

function validateEmail(email: string): string | null {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 120 ? null : 'Vul een geldig e-mailadres in';
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt}$${hash.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = await scrypt(password, salt, expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Hash om tijd te verspillen bij onbekend e-mailadres (geen verschil merkbaar). */
let dummyHash: string | null = null;

async function setSessionCookie(account: Pick<Account, 'id' | 'sessionVersion'>) {
  const secure = isHttpsRequest(await headers());
  const jar = await cookies();
  jar.set(COOKIE, sign({ kind: 'account', id: account.id, v: account.sessionVersion, exp: Date.now() + MAX_AGE * 1000 }), {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: MAX_AGE,
  });
}

export async function accountCount(): Promise<number> {
  return prisma.account.count();
}

/** Het ingelogde account, of null. */
export async function getAccount(): Promise<Account | null> {
  const jar = await cookies();
  const payload = verify<{ kind: string; id: string; v: number }>(jar.get(COOKIE)?.value);
  if (payload?.kind !== 'account') return null;
  const account = await prisma.account.findUnique({ where: { id: payload.id } });
  if (!account || !account.active || account.sessionVersion !== payload.v) return null;
  return account;
}

export async function requireAccount(roles: AccountRole[] = ['OWNER', 'ADMIN', 'ACCOUNTANT']): Promise<Account> {
  const account = await getAccount();
  if (!account) throw new AuthError('Log eerst in met je e-mailadres en wachtwoord');
  if (!roles.includes(account.role)) throw new AuthError('Je account heeft hier geen toegang toe');
  return account;
}

export async function logout() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

// --- inloggen ----------------------------------------------------------------

const attempts = new Map<string, { count: number; until: number }>();

export async function login(emailInput: string, password: string): Promise<Account> {
  const email = normalizeEmail(emailInput);
  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'onbekend';
  const key = `${ip}|${email}`;
  const a = attempts.get(key);
  if (a && a.until > Date.now() && a.count >= 10) throw new AuthError('Te veel pogingen. Probeer het over 15 minuten opnieuw.');

  const fail = async (accountId?: string) => {
    attempts.set(key, { count: (a && a.until > Date.now() ? a.count : 0) + 1, until: Date.now() + 15 * 60 * 1000 });
    if (accountId) {
      const updated = await prisma.account.update({ where: { id: accountId }, data: { failedLogins: { increment: 1 } } });
      if (updated.failedLogins >= MAX_FAILED) {
        await prisma.account.update({ where: { id: accountId }, data: { lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60 * 1000), failedLogins: 0 } });
        await audit(prisma, { action: 'ACCOUNT_LOCKED', accountId, data: { ip } });
      }
    }
    return new AuthError('E-mailadres of wachtwoord klopt niet');
  };

  const account = await prisma.account.findUnique({ where: { email } });
  if (!account || !account.active) {
    dummyHash ??= await hashPassword(randomBytes(12).toString('hex'));
    await verifyPassword(password, dummyHash);
    throw await fail();
  }
  if (account.lockedUntil && account.lockedUntil > new Date()) {
    throw new AuthError(`Dit account is tijdelijk geblokkeerd na te veel foute pogingen. Probeer het na ${account.lockedUntil.toLocaleTimeString('nl-NL', { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit' })} opnieuw.`);
  }
  if (!(await verifyPassword(password, account.passwordHash))) throw await fail(account.id);

  attempts.delete(key);
  const updated = await prisma.account.update({ where: { id: account.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
  await audit(prisma, { action: 'ACCOUNT_LOGIN', accountId: account.id, data: { ip } });
  await setSessionCookie(updated);
  return updated;
}

// --- eerste account en herstel (alleen op het eigen netwerk) -------------------

export async function createFirstOwner(input: { name: string; email: string; password: string; pairingCode: string }) {
  await assertLocal();
  if ((await accountCount()) > 0) throw new AuthError('Er bestaat al een account. Log in of vraag de eigenaar om een account.');
  if (!pairingCodeMatches(input.pairingCode)) throw new AuthError('Koppelcode klopt niet (staat in het startvenster / via het kassa-icoon)');
  const email = normalizeEmail(input.email);
  const problem = validateEmail(email) ?? validatePassword(input.password) ?? (input.name.trim() ? null : 'Vul je naam in');
  if (problem) throw new AuthError(problem);
  const account = await prisma.account.create({
    data: { email, name: input.name.trim().slice(0, 60), role: 'OWNER', passwordHash: await hashPassword(input.password) },
  });
  await audit(prisma, { action: 'ACCOUNT_CREATED', accountId: account.id, data: { email, role: 'OWNER', first: true } });
  await setSessionCookie(account);
  return account;
}

export async function resetPasswordWithPairingCode(input: { email: string; pairingCode: string; newPassword: string }) {
  await assertLocal();
  if (!pairingCodeMatches(input.pairingCode)) throw new AuthError('Koppelcode klopt niet');
  const problem = validatePassword(input.newPassword);
  if (problem) throw new AuthError(problem);
  const account = await prisma.account.findUnique({ where: { email: normalizeEmail(input.email) } });
  if (!account) throw new AuthError('Geen account met dit e-mailadres');
  const updated = await prisma.account.update({
    where: { id: account.id },
    data: { passwordHash: await hashPassword(input.newPassword), sessionVersion: { increment: 1 }, failedLogins: 0, lockedUntil: null, active: true },
  });
  await audit(prisma, { action: 'ACCOUNT_PASSWORD_RESET', accountId: account.id, data: { via: 'koppelcode' } });
  await setSessionCookie(updated);
  return updated;
}

export async function changeOwnPassword(currentPassword: string, newPassword: string) {
  const account = await requireAccount();
  if (!(await verifyPassword(currentPassword, account.passwordHash))) throw new AuthError('Huidig wachtwoord klopt niet');
  const problem = validatePassword(newPassword);
  if (problem) throw new AuthError(problem);
  const updated = await prisma.account.update({
    where: { id: account.id },
    data: { passwordHash: await hashPassword(newPassword), sessionVersion: { increment: 1 } },
  });
  await audit(prisma, { action: 'ACCOUNT_PASSWORD_CHANGED', accountId: account.id });
  await setSessionCookie(updated); // deze sessie blijft ingelogd, andere niet
}

// --- accounts beheren -----------------------------------------------------------

/** Mag `actor` dit account (met deze rol) aanmaken of wijzigen? */
function canManage(actor: Account, role: AccountRole): boolean {
  if (actor.role === 'OWNER') return true;
  return actor.role === 'ADMIN' && role === 'ACCOUNTANT';
}

export async function createAccount(actor: Account, input: { name: string; email: string; role: AccountRole; password: string }) {
  if (!canManage(actor, input.role)) throw new AuthError('Alleen de eigenaar kan beheerders en eigenaars aanmaken');
  const email = normalizeEmail(input.email);
  const problem = validateEmail(email) ?? validatePassword(input.password) ?? (input.name.trim() ? null : 'Vul een naam in');
  if (problem) throw new AuthError(problem);
  if (await prisma.account.findUnique({ where: { email } })) throw new AuthError('Er bestaat al een account met dit e-mailadres');
  const account = await prisma.account.create({
    data: { email, name: input.name.trim().slice(0, 60), role: input.role, passwordHash: await hashPassword(input.password) },
  });
  await audit(prisma, { action: 'ACCOUNT_CREATED', accountId: actor.id, entity: 'Account', entityId: account.id, data: { email, role: input.role } });
  return account;
}

export async function updateAccount(actor: Account, id: string, input: { role?: AccountRole; active?: boolean; newPassword?: string }) {
  const target = await prisma.account.findUniqueOrThrow({ where: { id } });
  if (!canManage(actor, target.role) || (input.role && !canManage(actor, input.role))) {
    throw new AuthError('Alleen de eigenaar kan beheerders en eigenaars wijzigen');
  }
  // Er moet altijd een actieve eigenaar overblijven
  const losesOwner = target.role === 'OWNER' && ((input.role && input.role !== 'OWNER') || input.active === false);
  if (losesOwner && (await prisma.account.count({ where: { role: 'OWNER', active: true, NOT: { id } } })) === 0) {
    throw new AuthError('Er moet minimaal één actieve eigenaar blijven');
  }
  const data: Partial<Pick<Account, 'role' | 'active' | 'passwordHash' | 'lockedUntil' | 'failedLogins'>> & { sessionVersion?: { increment: number } } = {};
  if (input.role) data.role = input.role;
  if (input.active !== undefined) data.active = input.active;
  if (input.newPassword !== undefined) {
    const problem = validatePassword(input.newPassword);
    if (problem) throw new AuthError(problem);
    data.passwordHash = await hashPassword(input.newPassword);
    data.lockedUntil = null;
    data.failedLogins = 0;
  }
  if (input.newPassword !== undefined || input.active === false || input.role) data.sessionVersion = { increment: 1 };
  await prisma.account.update({ where: { id }, data });
  await audit(prisma, {
    action: 'ACCOUNT_UPDATED',
    accountId: actor.id,
    entity: 'Account',
    entityId: id,
    data: { role: input.role, active: input.active, passwordReset: input.newPassword !== undefined },
  });
}
