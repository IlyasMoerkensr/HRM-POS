'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import {
  adminDataAction,
  linkTerminalAction,
  listTerminalsAction,
  saveCategoryAction,
  saveLedgerAccountAction,
  saveProductAction,
  saveSettingsAction,
  saveUserAction,
  setUserPinAction,
  type ProductInput,
  type UserInput,
} from '@/app/actions/admin';
import { Button, cx, ErrorBox, Modal, Money } from '@/components/ui';
import { formatKickCode, getCashDrawer, parseKickCode } from '@/lib/hardware/cashDrawer';
import { formatEuroInput, parseEuroInput } from '@/lib/money';

type Data = Extract<Awaited<ReturnType<typeof adminDataAction>>, { ok: true }>['data'];
type Tab = 'medewerkers' | 'producten' | 'categorieen' | 'kassalade' | 'grootboek' | 'algemeen';

const ROLES = { MEDEWERKER: 'Medewerker', MANAGER: 'Manager (retouren)', ADMIN: 'Beheerder' } as const;

export function BeheerApp() {
  const [data, setData] = useState<Data | null>(null);
  const [tab, setTab] = useState<Tab>('medewerkers');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await adminDataAction();
    if (r.ok) setData(r.data);
    else setError(r.error);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const done = async (msg: string) => {
    setSaved(msg);
    setTimeout(() => setSaved(null), 2500);
    await load();
  };

  const tabs: [Tab, string][] = [
    ['medewerkers', 'Medewerkers'],
    ['producten', 'Producten'],
    ['categorieen', 'Categorieën'],
    ['kassalade', 'Kassalade'],
    ['grootboek', 'Grootboek'],
    ['algemeen', 'Algemeen'],
  ];

  return (
    <div className="min-h-dvh">
      <header className="flex items-center gap-4 bg-slate-900 px-4 py-3 text-white">
        <Link href="/kassa" className="rounded-lg bg-slate-800 px-3 py-2 font-semibold">
          ← Kassa
        </Link>
        <h1 className="text-lg font-bold">Beheer</h1>
        <Link href="/export" className="order-last ml-auto rounded-lg px-3 py-2 text-sm font-semibold hover:bg-slate-800">
          Export
        </Link>
        <nav className="flex gap-1 overflow-x-auto">
          {tabs.map(([t, label]) => (
            <button key={t} type="button" onClick={() => setTab(t)} className={cx('rounded-lg px-3 py-2 font-semibold whitespace-nowrap', tab === t ? 'bg-white text-slate-900' : 'text-slate-300 hover:bg-slate-800')}>
              {label}
            </button>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-5xl space-y-4 p-4">
        <ErrorBox message={error} onClose={() => setError(null)} />
        {saved && <div className="rounded-xl bg-emerald-50 px-4 py-2 text-emerald-800 ring-1 ring-emerald-200">{saved}</div>}
        {!data ? (
          <p className="text-slate-500">Laden…</p>
        ) : tab === 'medewerkers' ? (
          <UsersTab data={data} onError={setError} onDone={done} />
        ) : tab === 'producten' ? (
          <ProductsTab data={data} onError={setError} onDone={done} />
        ) : tab === 'categorieen' ? (
          <CategoriesTab data={data} onError={setError} onDone={done} />
        ) : tab === 'kassalade' ? (
          <DrawerTab data={data} onError={setError} onDone={done} />
        ) : tab === 'grootboek' ? (
          <LedgerTab key={JSON.stringify(data.ledger)} data={data} onError={setError} onDone={done} />
        ) : (
          <GeneralTab data={data} onError={setError} onDone={done} />
        )}
      </main>
    </div>
  );
}

interface TabProps {
  data: Data;
  onError: (e: string | null) => void;
  onDone: (msg: string) => Promise<void>;
}

const input = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2';

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-slate-700">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

// ---------------------------------------------------------------- medewerkers

function UsersTab({ data, onError, onDone }: TabProps) {
  const [editing, setEditing] = useState<UserInput | null>(null);
  const [pinFor, setPinFor] = useState<Data['users'][number] | null>(null);
  const [phoneFor, setPhoneFor] = useState<Data['users'][number] | null>(null);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-slate-600">Koppel elke medewerker aan de eigen Mollie Tap-telefoon, zodat de dagcontrole per persoon klopt.</p>
        <Button variant="primary" onClick={() => setEditing({ name: '', role: 'MEDEWERKER', color: '#0ea5e9', active: true, sortOrder: data.users.length })}>
          + Medewerker
        </Button>
      </div>
      <ul className="divide-y divide-slate-100 rounded-2xl bg-white ring-1 ring-slate-200">
        {data.users.map((u) => (
          <li key={u.id} className={cx('flex flex-wrap items-center gap-3 px-4 py-3', !u.active && 'opacity-50')}>
            <span className="h-8 w-8 rounded-full" style={{ backgroundColor: u.color }} />
            <div className="min-w-40 flex-1">
              <div className="font-semibold">{u.name}</div>
              <div className="text-sm text-slate-500">
                {ROLES[u.role]} · {u.hasPin ? 'pincode ingesteld' : 'geen pincode'} · {u.mollieTerminalId ? `📱 ${u.phoneLabel || u.mollieTerminalId}` : 'geen telefoon gekoppeld'}
              </div>
            </div>
            <Button size="sm" onClick={() => setEditing({ id: u.id, name: u.name, role: u.role, color: u.color, active: u.active, sortOrder: u.sortOrder })}>
              Wijzigen
            </Button>
            <Button size="sm" onClick={() => setPinFor(u)}>
              Pincode
            </Button>
            <Button size="sm" onClick={() => setPhoneFor(u)}>
              Telefoon
            </Button>
          </li>
        ))}
      </ul>

      {editing && (
        <Modal
          title={editing.id ? 'Medewerker wijzigen' : 'Nieuwe medewerker'}
          onClose={() => setEditing(null)}
          footer={
            <Button variant="primary" className="w-full" onClick={async () => {
              const r = await saveUserAction(editing);
              if (!r.ok) return onError(r.error);
              setEditing(null);
              await onDone('Medewerker opgeslagen');
            }}>
              Opslaan
            </Button>
          }
        >
          <div className="space-y-3">
            <Field label="Naam">
              <input className={input} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} maxLength={40} autoFocus />
            </Field>
            <Field label="Rol">
              <select className={input} value={editing.role} onChange={(e) => setEditing({ ...editing, role: e.target.value as UserInput['role'] })}>
                {Object.entries(ROLES).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Kleur">
                <input type="color" className="h-11 w-full rounded-xl" value={editing.color} onChange={(e) => setEditing({ ...editing, color: e.target.value })} />
              </Field>
              <Field label="Volgorde">
                <input type="number" className={input} value={editing.sortOrder} onChange={(e) => setEditing({ ...editing, sortOrder: Number(e.target.value) })} />
              </Field>
            </div>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} /> Actief
            </label>
          </div>
        </Modal>
      )}

      {pinFor && <PinDialog user={pinFor} onClose={() => setPinFor(null)} onError={onError} onDone={onDone} />}
      {phoneFor && <PhoneDialog user={phoneFor} mollieConfigured={data.mollieConfigured} onClose={() => setPhoneFor(null)} onError={onError} onDone={onDone} />}
    </section>
  );
}

function PinDialog({ user, onClose, onError, onDone }: { user: Data['users'][number]; onClose: () => void; onError: (e: string) => void; onDone: (m: string) => Promise<void> }) {
  const [pin, setPin] = useState('');
  const save = async (value: string | null) => {
    const r = await setUserPinAction(user.id, value);
    if (!r.ok) return onError(r.error);
    onClose();
    await onDone(value ? `Pincode van ${user.name} ingesteld` : `Pincode van ${user.name} gewist`);
  };
  return (
    <Modal
      title={`Pincode ${user.name}`}
      onClose={onClose}
      footer={
        <div className="flex gap-2">
          {user.hasPin && (
            <Button variant="danger" onClick={() => save(null)}>
              Pincode wissen
            </Button>
          )}
          <Button variant="primary" className="flex-1" disabled={!/^\d{4}$/.test(pin)} onClick={() => save(pin)}>
            Opslaan
          </Button>
        </div>
      }
    >
      <p className="mb-3 text-slate-600">
        Zonder pincode kan iedereen op de kassa naar deze medewerker wisselen. Medewerkers kunnen ook zelf een pincode kiezen bij hun eerste keer inloggen op de telefoon.
      </p>
      <input className={cx(input, 'text-center font-mono text-2xl tracking-[0.5em]')} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" placeholder="••••" />
    </Modal>
  );
}

function PhoneDialog({ user, mollieConfigured, onClose, onError, onDone }: { user: Data['users'][number]; mollieConfigured: boolean; onClose: () => void; onError: (e: string) => void; onDone: (m: string) => Promise<void> }) {
  type Terminal = Extract<Awaited<ReturnType<typeof listTerminalsAction>>, { ok: true }>['data'][number];
  const [terminals, setTerminals] = useState<Terminal[] | null>(null);
  const [manual, setManual] = useState(user.mollieTerminalId ?? '');
  const [label, setLabel] = useState(user.phoneLabel ?? '');
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!mollieConfigured) return;
    void listTerminalsAction().then((r) => (r.ok ? setTerminals(r.data) : setLoadError(r.error)));
  }, [mollieConfigured]);

  const link = async (terminalId: string | null) => {
    const r = await linkTerminalAction(user.id, terminalId, label || undefined);
    if (!r.ok) return onError(r.error);
    onClose();
    await onDone(terminalId ? `Telefoon gekoppeld aan ${user.name}` : `Telefoon losgekoppeld van ${user.name}`);
  };

  return (
    <Modal title={`Mollie Tap-telefoon van ${user.name}`} onClose={onClose} wide>
      <div className="space-y-4">
        {!mollieConfigured ? (
          <ErrorBox message="Er is nog geen Mollie API-sleutel ingesteld (MOLLIE_API_KEY in .env). Zonder sleutel kun je alleen handmatig bevestigen." />
        ) : loadError ? (
          <ErrorBox message={loadError} />
        ) : terminals === null ? (
          <p className="text-slate-500">Telefoons ophalen bij Mollie…</p>
        ) : terminals.length === 0 ? (
          <p className="rounded-xl bg-amber-50 px-4 py-3 text-amber-900">
            Mollie kent nog geen telefoons. Log op elke telefoon in de Mollie Tap-app in op hetzelfde Mollie-account en probeer het opnieuw.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200">
            {terminals.map((t) => (
              <li key={t.terminalId} className="flex items-center gap-3 px-3 py-2">
                <div className="flex-1">
                  <div className="font-semibold">{t.description || t.model || t.terminalId}</div>
                  <div className="text-sm text-slate-500">
                    {t.terminalId} · {t.status}
                    {t.linkedUser && ` · nu gekoppeld aan ${t.linkedUser.name}`}
                  </div>
                </div>
                <Button size="sm" variant={user.mollieTerminalId === t.terminalId ? 'success' : 'primary'} disabled={t.status !== 'active'} onClick={() => link(t.terminalId)}>
                  {user.mollieTerminalId === t.terminalId ? 'Gekoppeld ✓' : 'Koppel'}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Omschrijving telefoon (optioneel)">
            <input className={input} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} placeholder="bijv. Samsung van Sanne" />
          </Field>
          <Field label="Of terminal-ID handmatig" hint="Staat in het Mollie Dashboard, begint met term_">
            <div className="flex gap-2">
              <input className={input} value={manual} onChange={(e) => setManual(e.target.value.trim())} placeholder="term_..." />
              <Button disabled={!/^term_\w+$/.test(manual)} onClick={() => link(manual)}>
                Koppel
              </Button>
            </div>
          </Field>
        </div>
        {user.mollieTerminalId && (
          <Button variant="danger" onClick={() => link(null)}>
            Telefoon loskoppelen
          </Button>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- producten

function ProductsTab({ data, onError, onDone }: TabProps) {
  const [editing, setEditing] = useState<(ProductInput & { priceText: string }) | null>(null);
  const [filter, setFilter] = useState('');
  const vatById = new Map(data.vatRates.map((v) => [v.id, v]));
  const catById = new Map(data.categories.map((c) => [c.id, c]));
  const list = data.products.filter((p) => p.name.toLowerCase().includes(filter.toLowerCase()));

  const blank = (): ProductInput & { priceText: string } => ({
    name: '', shortName: null, sku: null, categoryId: data.categories[0]?.id ?? null, priceInclCents: 0, priceText: '',
    vatRateId: data.vatRates.find((v) => v.code === 'HOOG')?.id ?? data.vatRates[0]?.id ?? '', openPrice: false, favorite: false, active: true, sortOrder: 0, color: null,
  });

  return (
    <section className="space-y-3">
      <div className="flex gap-2">
        <input className={input} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Zoeken…" />
        <Button variant="primary" onClick={() => setEditing(blank())}>
          + Product
        </Button>
      </div>
      <div className="overflow-x-auto rounded-2xl bg-white ring-1 ring-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-3 py-2">Product</th>
              <th>Categorie</th>
              <th>Btw</th>
              <th className="text-right">Prijs incl.</th>
              <th className="px-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.map((p) => (
              <tr key={p.id} className={cx(!p.active && 'text-slate-400')}>
                <td className="px-3 py-2">
                  {p.favorite && '★ '}
                  {p.name}
                  {!p.active && ' (uit)'}
                </td>
                <td>{p.categoryId ? catById.get(p.categoryId)?.name : '—'}</td>
                <td>{vatById.get(p.vatRateId)?.name}</td>
                <td className="text-right">{p.openPrice ? 'vrij' : <Money cents={p.priceInclCents} />}</td>
                <td className="px-3 text-right">
                  <Button size="sm" onClick={() => setEditing({ ...p, priceText: formatEuroInput(p.priceInclCents) })}>
                    Wijzigen
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <Modal
          title={editing.id ? 'Product wijzigen' : 'Nieuw product'}
          onClose={() => setEditing(null)}
          wide
          footer={
            <Button variant="primary" className="w-full" onClick={async () => {
              const cents = editing.openPrice && !editing.priceText ? 0 : parseEuroInput(editing.priceText);
              if (cents === null) return onError('Ongeldige prijs, gebruik bijv. 3,50');
              const { priceText: _ignored, ...rest } = editing;
              void _ignored;
              const r = await saveProductAction({ ...rest, priceInclCents: cents });
              if (!r.ok) return onError(r.error);
              setEditing(null);
              await onDone('Product opgeslagen');
            }}>
              Opslaan
            </Button>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Naam">
              <input className={input} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} maxLength={80} autoFocus />
            </Field>
            <Field label="Korte naam op tegel (optioneel)">
              <input className={input} value={editing.shortName ?? ''} onChange={(e) => setEditing({ ...editing, shortName: e.target.value })} maxLength={24} />
            </Field>
            <Field label="Prijs inclusief btw (€)" hint={editing.openPrice ? 'Bij vrije prijs vult de medewerker het bedrag in' : undefined}>
              <input className={input} value={editing.priceText} onChange={(e) => setEditing({ ...editing, priceText: e.target.value })} inputMode="decimal" placeholder="3,50" />
            </Field>
            <Field label="Btw-tarief" hint="Laat het juiste tarief controleren door de boekhouder">
              <select className={input} value={editing.vatRateId} onChange={(e) => setEditing({ ...editing, vatRateId: e.target.value })}>
                {data.vatRates.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Categorie">
              <select className={input} value={editing.categoryId ?? ''} onChange={(e) => setEditing({ ...editing, categoryId: e.target.value || null })}>
                <option value="">— geen —</option>
                {data.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Artikelcode (optioneel, voor zoeken)">
              <input className={input} value={editing.sku ?? ''} onChange={(e) => setEditing({ ...editing, sku: e.target.value })} maxLength={40} />
            </Field>
            <Field label="Volgorde">
              <input type="number" className={input} value={editing.sortOrder} onChange={(e) => setEditing({ ...editing, sortOrder: Number(e.target.value) })} />
            </Field>
            <div className="flex flex-col justify-end gap-2">
              <label className="flex items-center gap-2"><input type="checkbox" checked={editing.favorite} onChange={(e) => setEditing({ ...editing, favorite: e.target.checked })} /> Favoriet (bovenaan)</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={editing.openPrice} onChange={(e) => setEditing({ ...editing, openPrice: e.target.checked })} /> Vrije prijs (bijv. Diversen)</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} /> Actief (zichtbaar op de kassa)</label>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- categorieën

function CategoriesTab({ data, onError, onDone }: TabProps) {
  const [editing, setEditing] = useState<{ id?: string; name: string; color: string; sortOrder: number; active: boolean } | null>(null);
  return (
    <section className="space-y-3">
      <div className="flex justify-end">
        <Button variant="primary" onClick={() => setEditing({ name: '', color: '#0ea5e9', sortOrder: data.categories.length, active: true })}>
          + Categorie
        </Button>
      </div>
      <ul className="divide-y divide-slate-100 rounded-2xl bg-white ring-1 ring-slate-200">
        {data.categories.map((c) => (
          <li key={c.id} className={cx('flex items-center gap-3 px-4 py-3', !c.active && 'opacity-50')}>
            <span className="h-6 w-6 rounded" style={{ backgroundColor: c.color }} />
            <span className="flex-1 font-semibold">{c.name}</span>
            <Button size="sm" onClick={() => setEditing(c)}>
              Wijzigen
            </Button>
          </li>
        ))}
      </ul>
      {editing && (
        <Modal
          title={editing.id ? 'Categorie wijzigen' : 'Nieuwe categorie'}
          onClose={() => setEditing(null)}
          footer={
            <Button variant="primary" className="w-full" onClick={async () => {
              const r = await saveCategoryAction(editing);
              if (!r.ok) return onError(r.error);
              setEditing(null);
              await onDone('Categorie opgeslagen');
            }}>
              Opslaan
            </Button>
          }
        >
          <div className="space-y-3">
            <Field label="Naam">
              <input className={input} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Kleur">
                <input type="color" className="h-11 w-full rounded-xl" value={editing.color} onChange={(e) => setEditing({ ...editing, color: e.target.value })} />
              </Field>
              <Field label="Volgorde">
                <input type="number" className={input} value={editing.sortOrder} onChange={(e) => setEditing({ ...editing, sortOrder: Number(e.target.value) })} />
              </Field>
            </div>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} /> Actief
            </label>
          </div>
        </Modal>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- kassalade

function DrawerTab({ data, onError, onDone }: TabProps) {
  const s = data.settings;
  const [kick, setKick] = useState(s['drawer.kickCode'] ?? '1B 70 00 19 FA');
  const [baud, setBaud] = useState(s['drawer.baudRate'] ?? '9600');
  const [trigger, setTrigger] = useState(s['drawer.trigger'] ?? 'escpos');
  const [keepOpen, setKeepOpen] = useState((s['drawer.keepPortOpen'] ?? 'true') === 'true');
  const [test, setTest] = useState<string | null>(null);

  let parsed: string | null = null;
  let parseError: string | null = null;
  try {
    parsed = formatKickCode(parseKickCode(kick));
  } catch (err) {
    parseError = err instanceof Error ? err.message : String(err);
  }

  const config = () => ({ kickCode: parseKickCode(kick), baudRate: Number(baud), trigger: trigger as 'escpos' | 'dtr' | 'rts', keepPortOpen: keepOpen });

  return (
    <section className="space-y-4 rounded-2xl bg-white p-5 ring-1 ring-slate-200">
      <p className="text-slate-600">
        De lade is via USB aangesloten als COM-poort. Werkt de lade niet met de standaardcode, zoek dan in de handleiding naar “kick code” of “ESC/POS” en de baudrate.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Kick-code" hint={parseError ?? `Wordt verstuurd als: ${parsed}`}>
          <input className={cx(input, 'font-mono', parseError && 'border-rose-400')} value={kick} onChange={(e) => setKick(e.target.value)} />
        </Field>
        <Field label="Baudrate">
          <select className={input} value={baud} onChange={(e) => setBaud(e.target.value)}>
            {['2400', '4800', '9600', '19200', '38400', '57600', '115200'].map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </Field>
        <Field label="Aansturing" hint="Bijna altijd ESC/POS. Sommige goedkope laden openen op een DTR- of RTS-signaal.">
          <select className={input} value={trigger} onChange={(e) => setTrigger(e.target.value)}>
            <option value="escpos">ESC/POS kick-code</option>
            <option value="dtr">DTR-signaal</option>
            <option value="rts">RTS-signaal</option>
          </select>
        </Field>
        <label className="flex items-center gap-2 pt-6">
          <input type="checkbox" checked={keepOpen} onChange={(e) => setKeepOpen(e.target.checked)} /> Poort open houden (sneller)
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={Boolean(parseError)}
          onClick={async () => {
            setTest(null);
            const drawer = getCashDrawer();
            await drawer.updateConfig(config());
            if (drawer.getStatus().status !== 'connected') {
              const c = await drawer.connect();
              if (!c.ok) return setTest(`Verbinden mislukt: ${c.error}`);
            }
            const r = await drawer.kick();
            setTest(r.ok ? 'Commando verstuurd. Ging de lade open? Sla dan op.' : `Mislukt: ${r.error}`);
          }}
        >
          Test (koppelen + openen)
        </Button>
        <Button
          variant="primary"
          disabled={Boolean(parseError)}
          onClick={async () => {
            const r = await saveSettingsAction({ 'drawer.kickCode': kick, 'drawer.baudRate': baud, 'drawer.trigger': trigger, 'drawer.keepPortOpen': String(keepOpen) });
            if (!r.ok) return onError(r.error);
            await onDone('Kassalade-instellingen opgeslagen');
          }}
        >
          Opslaan
        </Button>
      </div>
      {test && <p className="rounded-xl bg-slate-50 px-4 py-2">{test}</p>}
      <p className="text-xs text-slate-500">Let op: een test-opening hier wordt niet als “geen verkoop” geregistreerd. Gebruik dit alleen bij het instellen.</p>
    </section>
  );
}

// ---------------------------------------------------------------- algemeen

function GeneralTab({ data, onError, onDone }: TabProps) {
  const s = data.settings;
  const [name, setName] = useState(s['company.name'] ?? '');
  const [maxPct, setMaxPct] = useState(String(Number(s['pos.maxDiscountBpWithoutManager'] ?? 1000) / 100));
  const [mode, setMode] = useState(s['mollie.defaultMode'] === 'MANUAL' ? 'MANUAL' : 'API');
  return (
    <section className="space-y-4 rounded-2xl bg-white p-5 ring-1 ring-slate-200">
      <Field label="Bedrijfsnaam (bovenin de kassa)">
        <input className={input} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
      </Field>
      <Field label="Maximale korting voor medewerkers (%)" hint="Managers en beheerders hebben geen limiet">
        <input className={input} value={maxPct} onChange={(e) => setMaxPct(e.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" />
      </Field>
      <Field label="Standaard pinknop" hint="‘Naar telefoon sturen’ vereist een Mollie API-sleutel en gekoppelde telefoons">
        <select className={input} value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="API">Bedrag naar telefoon sturen (automatisch)</option>
          <option value="MANUAL">Handmatig bevestigen</option>
        </select>
      </Field>
      <p className="text-sm text-slate-600">Mollie API-sleutel: {data.mollieConfigured ? '✓ ingesteld' : '✗ niet ingesteld (zet MOLLIE_API_KEY in het bestand .env en herstart de kassa)'}</p>
      <Button
        variant="primary"
        onClick={async () => {
          const r = await saveSettingsAction({
            'company.name': name,
            'pos.maxDiscountBpWithoutManager': String(Math.min(100, Number(maxPct || 0)) * 100),
            'mollie.defaultMode': mode,
          });
          if (!r.ok) return onError(r.error);
          await onDone('Instellingen opgeslagen');
        }}
      >
        Opslaan
      </Button>
    </section>
  );
}

// ---------------------------------------------------------------- grootboek

const PURPOSE: Record<string, string> = {
  CASH: 'Kas (contant geld)',
  CASH_TRANSFER: 'Kas onderweg / kluis (afromen en bijvullen)',
  BANK: 'Bank (Mollie-uitbetalingen)',
  MOLLIE_CLEARING: 'Tussenrekening Mollie (pinomzet)',
  VAT_RECEIVABLE: 'Voorbelasting (btw op Mollie-kosten)',
  VAT_PAYABLE: 'Af te dragen btw',
  PAYMENT_FEES: 'Transactiekosten Mollie',
  REVENUE: 'Omzet',
  CASH_DIFFERENCE: 'Kasverschillen',
};

function LedgerTab({ data, onError, onDone }: TabProps) {
  const [rows, setRows] = useState(() => data.ledger.map((a) => ({ ...a, newCode: a.code, newName: a.name })));
  return (
    <section className="space-y-4">
      <p className="text-slate-600">
        Pas de rekeningnummers aan het rekeningschema van je boekhouder aan. De exports en journaalposten gebruiken deze nummers. Bonnen die al zijn afgerekend
        houden hun oorspronkelijke nummer in de bon zelf.
      </p>
      <div className="overflow-x-auto rounded-2xl bg-white ring-1 ring-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-3 py-2">Functie</th>
              <th>Nummer</th>
              <th>Naam</th>
              <th className="px-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r, i) => {
              const changed = r.newCode !== r.code || r.newName !== r.name;
              return (
                <tr key={r.code}>
                  <td className="px-3 py-2 text-slate-600">{PURPOSE[r.purpose] ?? r.purpose}</td>
                  <td className="py-2 pr-2">
                    <input className={cx(input, 'w-28 font-mono')} value={r.newCode} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, newCode: e.target.value } : x)))} />
                  </td>
                  <td className="py-2 pr-2">
                    <input className={input} value={r.newName} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, newName: e.target.value } : x)))} />
                  </td>
                  <td className="px-3">
                    <Button size="sm" variant="primary" disabled={!changed} onClick={async () => {
                      const res = await saveLedgerAccountAction({ oldCode: r.code, code: r.newCode, name: r.newName });
                      if (!res.ok) return onError(res.error);
                      await onDone(`Rekening ${r.newCode} opgeslagen`);
                    }}>
                      Opslaan
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <h2 className="mb-2 font-bold">Btw-tarieven</h2>
        <ul className="space-y-1 text-sm">
          {data.vatRates.map((v) => (
            <li key={v.id}>
              {v.name}: omzet op <span className="font-mono">{v.revenueAccountCode}</span>
              {v.vatAccountCode && <>, btw op <span className="font-mono">{v.vatAccountCode}</span></>}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
