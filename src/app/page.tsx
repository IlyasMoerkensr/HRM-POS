import { redirect } from 'next/navigation';

import { isPairedDevice, isRemote } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

/** Gekoppelde kassa-pc → kassa; op afstand → inloggen; andere apparaten in de zaak → telefoonweergave. */
export default async function Home() {
  if (await isRemote()) redirect('/login');
  redirect((await isPairedDevice()) ? '/kassa' : '/telefoon');
}
