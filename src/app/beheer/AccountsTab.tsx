'use client';

import { useCallback, useEffect, useState } from 'react';

import { changeOwnPasswordAction, createAccountAction, listAccountsAction, updateAccountAction } from '@/app/actions/account';
import { Button, cx, ErrorBox, Modal } from '@/components/ui';

type Role = 'OWNER' | 'ADMIN' | 'ACCOUNTANT';
type List = Extract<Awaited<ReturnType<typeof listAccountsAction>>, { ok: true }>['data'];

const ROLE_LABEL: Record<Role, string> = {
  OWNER: 'Eigenaar',
  ADMIN: 'Beheerder',
  ACCOUNTANT: 'Boekhouder (alleen rapporten en export)',
};
const input = 'mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2';

/** Accounts met e-mail en wachtwoord: eigenaar, beheerders en de boekhouder. */
export function AccountsTab({ meId, meRole, onError, onDone }: { meId: string; meRole: Role; onError: (e: string | null) => void; onDone: (m: string) => Promise<void> }) {
  const [list, setList] = useState<List | null>(null);
  const [creating, setCreating] = useState(false);
  const [resetFor, setResetFor] = useState<List['accounts'][number] | null>(null);
  const [ownPassword, setOwnPassword] = useState(false);

  const load = useCallback(async () => {
    const r = await listAccountsAction();
    if (r.ok) setList(r.data);
    else onError(r.error);
  }, [onError]);
  useEffect(() => {
    void load();
  }, [load]);

  const finish = async (msg: string) => {
    await load();
    await onDone(msg);
  };
  const roles: Role[] = meRole === 'OWNER' ? ['OWNER', 'ADMIN', 'ACCOUNTANT'] : ['ACCOUNTANT'];

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-slate-600">
          Met een account log je in met e-mail en wachtwoord, ook <strong>op afstand</strong>. De boekhouder ziet alleen Z-rapporten en de export. De kassa zelf blijft
          werken met de medewerkers en hun pincode.
        </p>
        <div className="flex gap-2">
          <Button onClick={() => setOwnPassword(true)}>Mijn wachtwoord wijzigen</Button>
          <Button variant="primary" onClick={() => setCreating(true)}>
            + Account
          </Button>
        </div>
      </div>

      {!list ? (
        <p className="text-slate-500">Laden…</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-2xl bg-white ring-1 ring-slate-200">
          {list.accounts.map((a) => {
            const manageable = meRole === 'OWNER' || a.role === 'ACCOUNTANT';
            return (
              <li key={a.id} className={cx('flex flex-wrap items-center gap-3 px-4 py-3', !a.active && 'opacity-50')}>
                <div className="min-w-48 flex-1">
                  <div className="font-semibold">
                    {a.name} {a.id === meId && <span className="text-sm font-normal text-slate-500">(jij)</span>}
                  </div>
                  <div className="text-sm text-slate-500">
                    {a.email} · {ROLE_LABEL[a.role]}
                    {!a.active && ' · uitgeschakeld'}
                    {a.locked && ' · tijdelijk geblokkeerd'}
                    {a.lastLoginAt && ` · laatst ingelogd ${new Date(a.lastLoginAt).toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
                  </div>
                </div>
                {manageable && a.id !== meId && (
                  <>
                    <Button size="sm" onClick={() => setResetFor(a)}>
                      Nieuw wachtwoord
                    </Button>
                    <Button
                      size="sm"
                      variant={a.active ? 'danger' : 'secondary'}
                      onClick={async () => {
                        const r = await updateAccountAction(a.id, { active: !a.active });
                        if (!r.ok) return onError(r.error);
                        await finish(a.active ? `${a.name} uitgeschakeld` : `${a.name} weer actief`);
                      }}
                    >
                      {a.active ? 'Uitschakelen' : 'Inschakelen'}
                    </Button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {creating && <CreateDialog roles={roles} onClose={() => setCreating(false)} onError={onError} onDone={async (m) => { setCreating(false); await finish(m); }} />}
      {resetFor && (
        <PasswordDialog
          title={`Nieuw wachtwoord voor ${resetFor.name}`}
          onClose={() => setResetFor(null)}
          onSave={async (pw) => {
            const r = await updateAccountAction(resetFor.id, { newPassword: pw });
            if (!r.ok) return r.error;
            setResetFor(null);
            await finish(`Wachtwoord van ${resetFor.name} ingesteld. Geef het veilig door (bijv. telefonisch).`);
            return null;
          }}
        />
      )}
      {ownPassword && (
        <PasswordDialog
          title="Mijn wachtwoord wijzigen"
          askCurrent
          onClose={() => setOwnPassword(false)}
          onSave={async (pw, current) => {
            const r = await changeOwnPasswordAction(current ?? '', pw);
            if (!r.ok) return r.error;
            setOwnPassword(false);
            await finish('Wachtwoord gewijzigd. Andere apparaten zijn uitgelogd.');
            return null;
          }}
        />
      )}
    </section>
  );
}

function CreateDialog({ roles, onClose, onError, onDone }: { roles: Role[]; onClose: () => void; onError: (e: string | null) => void; onDone: (m: string) => Promise<void> }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('ACCOUNTANT');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal
      title="Nieuw account"
      onClose={onClose}
      footer={
        <Button
          variant="primary"
          className="w-full"
          onClick={async () => {
            setError(null);
            const r = await createAccountAction({ name, email, role, password });
            if (!r.ok) return setError(r.error);
            onError(null);
            await onDone(`Account voor ${name} aangemaakt. Geef e-mailadres en wachtwoord veilig door.`);
          }}
        >
          Account aanmaken
        </Button>
      }
    >
      <div className="space-y-3">
        <label className="block text-sm font-semibold">
          Naam
          <input className={input} value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="bijv. Administratiekantoor De Vries" />
        </label>
        <label className="block text-sm font-semibold">
          E-mailadres
          <input className={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="block text-sm font-semibold">
          Rol
          <select className={input} value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {roles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-semibold">
          Wachtwoord (minimaal 10 tekens)
          <input className={input} type="text" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          <span className="mt-1 block text-xs font-normal text-slate-500">De gebruiker kan het daarna zelf wijzigen via Beheer → Accounts (boekhouder: vraag het aan jou).</span>
        </label>
        <ErrorBox message={error} />
      </div>
    </Modal>
  );
}

function PasswordDialog({ title, askCurrent, onClose, onSave }: { title: string; askCurrent?: boolean; onClose: () => void; onSave: (pw: string, current?: string) => Promise<string | null> }) {
  const [current, setCurrent] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <Button
          variant="primary"
          className="w-full"
          onClick={async () => {
            if (pw !== pw2) return setError('De wachtwoorden zijn niet gelijk');
            setError(await onSave(pw, askCurrent ? current : undefined));
          }}
        >
          Opslaan
        </Button>
      }
    >
      <div className="space-y-3">
        {askCurrent && (
          <label className="block text-sm font-semibold">
            Huidig wachtwoord
            <input className={input} type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
          </label>
        )}
        <label className="block text-sm font-semibold">
          Nieuw wachtwoord (minimaal 10 tekens)
          <input className={input} type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
        </label>
        <label className="block text-sm font-semibold">
          Herhaal
          <input className={input} type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
        </label>
        <ErrorBox message={error} />
      </div>
    </Modal>
  );
}
