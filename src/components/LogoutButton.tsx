'use client';

import { useRouter } from 'next/navigation';

import { logoutAction } from '@/app/actions/account';

export function LogoutButton({ className }: { className?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className={className ?? 'rounded-lg bg-slate-800 px-3 py-1.5 font-semibold hover:bg-slate-700'}
      onClick={async () => {
        await logoutAction();
        router.replace('/login');
        router.refresh();
      }}
    >
      Uitloggen
    </button>
  );
}
