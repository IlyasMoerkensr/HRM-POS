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
          const { count, openCount, linkWarning } = r.data;
          const parts: string[] = [];
          if (count > 0) parts.push(`${count} uitbetaling(en) opgehaald.`);
          else parts.push('Verbinding met Mollie werkt, maar er zijn nog geen afgeronde uitbetalingen in deze periode. Mollie maakt pas een uitbetaling na echte (live) betalingen; testbetalingen komen er nooit in.');
          if (openCount > 0) parts.push(`${openCount} uitbetaling loopt nog bij Mollie en verschijnt hier zodra hij is uitbetaald.`);
          if (linkWarning) parts.push(`Let op: de betalingen konden niet aan de uitbetaling gekoppeld worden (${linkWarning}). De bedragen en kosten zijn wel opgehaald.`);
          setState({ busy: false, message: parts.join(' '), error: false });
          router.refresh();
        }}
      >
        {state.busy ? 'Ophalen bij Mollie…' : 'Uitbetalingen ophalen bij Mollie'}
      </button>
      {state.message && <span className={`max-w-2xl text-sm ${state.error ? 'text-rose-700' : 'text-emerald-700'}`}>{state.message}</span>}
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
