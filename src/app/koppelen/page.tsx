'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { pairDeviceAction } from '@/app/actions/pos';
import { Button, ErrorBox } from '@/components/ui';

/** Deze browser eenmalig koppelen als kassa (code staat in het startvenster op de pc). */
export default function KoppelenPage() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const r = await pairDeviceAction(code);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    router.replace('/kassa');
    router.refresh();
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-900 p-6">
      <div className="w-full max-w-md space-y-5 rounded-2xl bg-white p-6 shadow-2xl">
        <h1 className="text-2xl font-bold">Kassa koppelen</h1>
        <p className="text-slate-600">
          Vul de <strong>koppelcode</strong> in. Die staat in het zwarte venster dat opende bij het starten van de kassa (start.bat).
          Dit hoeft maar één keer per pc.
        </p>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          inputMode="numeric"
          autoFocus
          className="w-full rounded-xl border border-slate-300 px-4 py-4 text-center font-mono text-3xl tracking-[0.4em]"
          placeholder="••••••"
        />
        <ErrorBox message={error} />
        <Button variant="primary" size="lg" className="w-full" disabled={busy || code.length < 6} onClick={submit}>
          Koppelen
        </Button>
        <p className="text-sm text-slate-500">
          Ben je een medewerker op je telefoon? Ga dan naar <a className="text-blue-600 underline" href="/telefoon">de telefoonweergave</a>.
        </p>
      </div>
    </main>
  );
}
