'use server';

/** Inloggen met e-mail en wachtwoord, en accounts beheren. */
import type { AccountRole } from '@prisma/client';

import { run } from '@/lib/actionResult';
import {
  changeOwnPassword,
  createAccount,
  createFirstOwner,
  login,
  logout,
  requireAccount,
  resetPasswordWithPairingCode,
  updateAccount,
} from '@/lib/auth/accounts';
import { AuthError } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';

const ROLES: AccountRole[] = ['OWNER', 'ADMIN', 'ACCOUNTANT'];

/** Waar iemand na het inloggen heen gaat (alleen interne paden). */
function landing(role: AccountRole, next: string | null): string {
  if (next && /^\/(beheer|rapporten|export)(\/|$|\?)/.test(next)) {
    if (role !== 'ACCOUNTANT' || !next.startsWith('/beheer')) return next;
  }
  return role === 'ACCOUNTANT' ? '/rapporten' : '/beheer';
}

export async function loginAction(email: string, password: string, next: string | null) {
  return run(async () => {
    const account = await login(email, password);
    return { redirect: landing(account.role, next) };
  });
}

export async function logoutAction() {
  return run(async () => {
    await logout();
    return true as const;
  });
}

export async function setupOwnerAction(input: { name: string; email: string; password: string; pairingCode: string }) {
  return run(async () => {
    await createFirstOwner(input);
    return { redirect: '/beheer' };
  });
}

export async function resetPasswordAction(input: { email: string; pairingCode: string; newPassword: string }) {
  return run(async () => {
    const account = await resetPasswordWithPairingCode(input);
    return { redirect: landing(account.role, null) };
  });
}

export async function changeOwnPasswordAction(currentPassword: string, newPassword: string) {
  return run(async () => {
    await changeOwnPassword(currentPassword, newPassword);
    return true as const;
  });
}

export async function listAccountsAction() {
  return run(async () => {
    const me = await requireAccount(['OWNER', 'ADMIN']);
    const accounts = await prisma.account.findMany({ orderBy: [{ role: 'asc' }, { name: 'asc' }] });
    return {
      me: { id: me.id, role: me.role },
      accounts: accounts.map((a) => ({
        id: a.id,
        name: a.name,
        email: a.email,
        role: a.role,
        active: a.active,
        lastLoginAt: a.lastLoginAt,
        locked: Boolean(a.lockedUntil && a.lockedUntil > new Date()),
      })),
    };
  });
}

export async function createAccountAction(input: { name: string; email: string; role: AccountRole; password: string }) {
  return run(async () => {
    const me = await requireAccount(['OWNER', 'ADMIN']);
    if (!ROLES.includes(input.role)) throw new AuthError('Ongeldige rol');
    const a = await createAccount(me, input);
    return { id: a.id };
  });
}

export async function updateAccountAction(id: string, input: { role?: AccountRole; active?: boolean; newPassword?: string }) {
  return run(async () => {
    const me = await requireAccount(['OWNER', 'ADMIN']);
    if (input.role && !ROLES.includes(input.role)) throw new AuthError('Ongeldige rol');
    if (id === me.id && (input.active === false || (input.role && input.role !== me.role))) {
      throw new AuthError('Je kunt je eigen account niet uitschakelen of je eigen rol wijzigen');
    }
    await updateAccount(me, id, input);
    return true as const;
  });
}
