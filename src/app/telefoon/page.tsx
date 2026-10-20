import { getPhoneUserId } from '@/lib/auth/session';
import { loadCatalog, loadUsers } from '@/lib/catalog';

import { PhoneApp } from './PhoneApp';

export const dynamic = 'force-dynamic';

export default async function TelefoonPage() {
  const [catalog, users, me] = await Promise.all([loadCatalog(), loadUsers(), getPhoneUserId()]);
  return <PhoneApp products={catalog.products} categories={catalog.categories} users={users} loggedInId={me && users.some((u) => u.id === me) ? me : null} />;
}
