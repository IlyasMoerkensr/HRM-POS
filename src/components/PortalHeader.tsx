import Link from 'next/link';

import type { ReportAccess } from '@/lib/auth/access';

import { LogoutButton } from './LogoutButton';

/** Bovenbalk voor beheer, rapporten en export. */
export function PortalHeader({ access, title, active }: { access: ReportAccess; title: string; active: 'rapporten' | 'export' | 'beheer' }) {
  const link = (href: string, label: string, key: string) => (
    <Link href={href} className={`rounded-lg px-3 py-2 text-sm font-semibold ${active === key ? 'bg-white text-slate-900' : 'hover:bg-slate-800'}`}>
      {label}
    </Link>
  );
  const isAccount = access.via === 'account';
  const canManage = isAccount && access.account.role !== 'ACCOUNTANT';
  return (
    <header className="flex flex-wrap items-center gap-2 bg-slate-900 px-4 py-3 text-white print:hidden">
      {access.via === 'kassa' && (
        <Link href="/kassa" className="rounded-lg bg-slate-800 px-3 py-2 font-semibold">
          ← Kassa
        </Link>
      )}
      <h1 className="mr-2 text-lg font-bold">{title}</h1>
      <nav className="flex flex-wrap gap-1">
        {link('/rapporten', 'Z-rapporten', 'rapporten')}
        {(isAccount || access.role !== 'MEDEWERKER') && link('/export', 'Export', 'export')}
        {canManage && link('/beheer', 'Beheer', 'beheer')}
      </nav>
      <div className="ml-auto flex items-center gap-3 text-sm">
        <span className="text-slate-300">{access.name}</span>
        {isAccount && <LogoutButton />}
      </div>
    </header>
  );
}
