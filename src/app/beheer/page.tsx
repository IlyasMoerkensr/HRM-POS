import { redirect } from 'next/navigation';

import { getAccount } from '@/lib/auth/accounts';
import { isRemote } from '@/lib/auth/session';

import { BeheerApp } from './BeheerApp';

export const dynamic = 'force-dynamic';

/** Beheer: inloggen met e-mail en wachtwoord (eigenaar of beheerder). Werkt ook op afstand. */
export default async function BeheerPage() {
  const account = await getAccount();
  if (!account) redirect('/login?next=/beheer');
  if (account.role === 'ACCOUNTANT') redirect('/rapporten');
  return <BeheerApp me={{ id: account.id, name: account.name, role: account.role }} local={!(await isRemote())} />;
}
