'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { loginAction, resetPasswordAction, setupOwnerAction } from '@/app/actions/account';
import { Button, ErrorBox } from '@/components/ui';

const input = 'mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-lg outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200';

export function LoginForm({ next, firstSetup, remote }: { next: string | null; firstSetup: boolean; remote: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'setup' | 'reset'>(firstSetup ? 'setup' : 'login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode !== 'login' && password !== password2) return setError('De wachtwoorden zijn niet gelijk');
    setBusy(true);
    const r =
      mode === 'login'
        ? await loginAction(email, password, next)
        : mode === 'setup'
          ? await setupOwnerAction({ name, email, password, pairingCode: code })
          : await resetPasswordAction({ email, pairingCode: code, newPassword: password });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    router.replace(r.data.redirect);
    router.refresh();
  };

  const title = mode === 'login' ? 'Inloggen' : mode === 'setup' ? 'Eerste account aanmaken' : 'Nieuw wachtwoord instellen';

  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-900 p-4">
      <form onSubmit={submit} className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-2xl">
        <div>
          <div className="text-xs tracking-widest text-slate-500 uppercase">Kassa · beheer en boekhouding</div>
          <h1 className="text-2xl font-bold">{title}</h1>
        </div>

        {mode === 'setup' && (
          <p className="text-slate-600">
            Dit wordt het <strong>eigenaarsaccount</strong>. Daarmee kom je in Beheer en kun je later accounts maken voor beheerders en de boekhouder.
          </p>
        )}
        {mode === 'reset' && <p className="text-slate-600">Kan alleen op de kassa-pc of het wifi-netwerk van de zaak, met de koppelcode.</p>}

        {(mode === 'setup' || mode === 'reset') && remote ? (
          <ErrorBox message="Dit kan alleen op de kassa-pc of op het wifi-netwerk van de zaak, niet op afstand." />
        ) : (
          <>
            {mode === 'setup' && (
              <label className="block text-sm font-semibold">
                Naam
                <input className={input} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
              </label>
            )}
            <label className="block text-sm font-semibold">
              E-mailadres
              <input className={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required autoFocus />
            </label>
            <label className="block text-sm font-semibold">
              {mode === 'login' ? 'Wachtwoord' : 'Nieuw wachtwoord (minimaal 10 tekens)'}
              <input
                className={input}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
                minLength={mode === 'login' ? undefined : 10}
              />
            </label>
            {mode !== 'login' && (
              <>
                <label className="block text-sm font-semibold">
                  Herhaal wachtwoord
                  <input className={input} type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} autoComplete="new-password" required />
                </label>
                <label className="block text-sm font-semibold">
                  Koppelcode
                  <span className="block text-xs font-normal text-slate-500">Via het kassa-icoon naast de klok → “Adressen en koppelcode”, of in het startvenster.</span>
                  <input
                    className={`${input} text-center font-mono tracking-[0.4em]`}
                    inputMode="numeric"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
                    required
                  />
                </label>
              </>
            )}
            <ErrorBox message={error} />
            <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy}>
              {busy ? 'Bezig…' : mode === 'login' ? 'Inloggen' : mode === 'setup' ? 'Account aanmaken' : 'Wachtwoord opslaan'}
            </Button>
          </>
        )}

        <div className="flex justify-between text-sm">
          {mode === 'login' ? (
            <button type="button" className="text-blue-700 underline" onClick={() => { setMode('reset'); setError(null); }}>
              Wachtwoord vergeten?
            </button>
          ) : !firstSetup ? (
            <button type="button" className="text-blue-700 underline" onClick={() => { setMode('login'); setError(null); }}>
              ← Terug naar inloggen
            </button>
          ) : (
            <span />
          )}
          {!remote && (
            <a href="/kassa" className="text-slate-500 underline">
              Naar de kassa
            </a>
          )}
        </div>
        {mode === 'reset' && remote && <p className="text-sm text-slate-500">Ben je de boekhouder? Vraag de eigenaar om je wachtwoord opnieuw in te stellen.</p>}
      </form>
    </main>
  );
}
