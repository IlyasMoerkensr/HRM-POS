'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { syncSettlementsAction } from '@/app/actions/export';

export function MollieSyncButton({ from }: { from: string }) {
  const router = useRouter();
  const [state, setState] = useState<{ busy: boolean; message: string | null; error: boolean }>({ busy: false, message: null, error: false });
  return (
    <div className="flex flex-wrap items-center gap-3 print:hidden">
      <button
        type="button"
        disabled={state.busy}
        className="rounded-xl bg-slate-900 px-4 py-2 font-semibold text-white disabled:opacity-40"
        onClick={async () => {
          setState({ busy: true, message: null, error: false });
          const r = await syncSettlementsAction(from);
          if (!r.ok) return setState({ busy: false, message: r.error, error: true });
          setState({ busy: false, message: `${r.data.count} uitbetaling(en) bijgewerkt`, error: false });
          router.refresh();
        }}
      >
        {state.busy ? 'Ophalen bij Mollie…' : 'Uitbetalingen ophalen bij Mollie'}
      </button>
      {state.message && <span className={state.error ? 'text-rose-700' : 'text-emerald-700'}>{state.message}</span>}
    </div>
  );
}

export function PrintPageButton() {
  return (
    <button type="button" onClick={() => window.print()} className="rounded-xl bg-blue-600 px-4 py-2 font-semibold text-white">
      Maandrapport afdrukken / PDF
    </button>
  );
}
