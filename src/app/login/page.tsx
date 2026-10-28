import { redirect } from 'next/navigation';

import { accountCount, getAccount } from '@/lib/auth/accounts';
import { isRemote } from '@/lib/auth/session';

import { LoginForm } from './LoginForm';

export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const next = sp.next && sp.next.startsWith('/') && !sp.next.startsWith('//') ? sp.next : null;
  const account = await getAccount();
  if (account) redirect(next && (account.role !== 'ACCOUNTANT' || !next.startsWith('/beheer')) ? next : account.role === 'ACCOUNTANT' ? '/rapporten' : '/beheer');
  const [count, remote] = await Promise.all([accountCount(), isRemote()]);
  return <LoginForm next={next} firstSetup={count === 0} remote={remote} />;
}
