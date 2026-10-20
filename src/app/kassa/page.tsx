import { redirect } from 'next/navigation';

import { getActiveEmployeeId, isPairedDevice } from '@/lib/auth/session';
import { loadCatalog, loadDrawerSettings, loadUsers } from '@/lib/catalog';
import { isMollieConfigured } from '@/lib/mollie/mollieService';
import { getToday, getUnclosedEarlierDays } from '@/lib/orders/orderService';
import { getSettings } from '@/lib/settings';

import { KassaApp } from './KassaApp';

export const dynamic = 'force-dynamic';

export default async function KassaPage() {
  if (!(await isPairedDevice())) redirect('/koppelen');

  const [catalog, users, drawer, day, unclosed, activeUserId, settings] = await Promise.all([
    loadCatalog(),
    loadUsers(),
    loadDrawerSettings(),
    getToday(),
    getUnclosedEarlierDays(),
    getActiveEmployeeId(),
    getSettings(),
  ]);

  return (
    <KassaApp
      companyName={settings['company.name'] ?? 'Kassa'}
      products={catalog.products}
      categories={catalog.categories}
      users={users}
      activeUserId={activeUserId && users.some((u) => u.id === activeUserId) ? activeUserId : null}
      day={day ? { date: day.date, status: day.status } : null}
      unclosedDays={unclosed.map((d) => d.date)}
      drawer={drawer}
      mollieConfigured={isMollieConfigured()}
      defaultPinMode={settings['mollie.defaultMode'] === 'MANUAL' ? 'MANUAL' : 'API'}
    />
  );
}
