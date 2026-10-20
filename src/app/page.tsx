import { redirect } from 'next/navigation';

import { isPairedDevice } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

/** Gekoppelde kassa-pc → kassascherm, alle andere apparaten → telefoonweergave. */
export default async function Home() {
  redirect((await isPairedDevice()) ? '/kassa' : '/telefoon');
}
