'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  cancelPinAction,
  checkoutAction,
  checkoutStateAction,
  parkAction,
  phoneLoginAction,
  phoneLogoutAction,
  phoneStateAction,
} from '@/app/actions/pos';
import { CartView, OpenPriceDialog } from '@/components/CartView';
import { CheckoutPanel } from '@/components/CheckoutPanel';
import { ProductPicker } from '@/components/ProductPicker';
import { Button, cx, ErrorBox, Modal, Money, NumPad, PinDots, textOn } from '@/components/ui';
import { useCart } from '@/components/useCart';
import { formatEUR } from '@/lib/money';
import type { CheckoutState, PosCategory, PosProduct, PosUser } from '@/lib/types';

type PhoneState = Extract<Awaited<ReturnType<typeof phoneStateAction>>, { ok: true }>['data'];

/**
 * Telefoonweergave voor medewerkers (modus B):
 *  - zelf een bon aanslaan en het bedrag naar de eigen Mollie Tap-app sturen
 *  - zien welk bedrag de kassa-pc naar je telefoon heeft gestuurd
 *  - eigen pinbetalingen van vandaag
 */
export function PhoneApp({ products, categories, users, loggedInId }: { products: PosProduct[]; categories: PosCategory[]; users: PosUser[]; loggedInId: string | null }) {
  const [meId, setMeId] = useState(loggedInId);
  if (!meId) return <PhoneLogin users={users} onLoggedIn={setMeId} />;
  return <PhoneHome products={products} categories={categories} onLogout={() => setMeId(null)} />;
}

function PhoneLogin({ users, onLoggedIn }: { users: PosUser[]; onLoggedIn: (id: string) => void }) {
  const [user, setUser] = useState<PosUser | null>(null);
  const [pin, setPin] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [newPin, setNewPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const login = useCallback(
    async (input: { pin: string; pairingCode?: string; newPin?: string }) => {
      if (!user) return;
      setBusy(true);
      setError(null);
      const r = await phoneLoginAction({ userId: user.id, ...input });
      setBusy(false);
      if (r.ok) onLoggedIn(user.id);
      else {
        setError(r.error);
        setPin('');
      }
    },
    [user, onLoggedIn],
  );

  useEffect(() => {
    if (user?.hasPin && pin.length === 4) void login({ pin });
  }, [pin, user, login]);

  return (
    <main className="min-h-dvh bg-slate-900 p-5 text-white">
      <h1 className="mb-1 text-2xl font-bold">Kassa · telefoon</h1>
      <p className="mb-6 text-slate-400">Wie ben jij?</p>
      <div className="grid grid-cols-2 gap-3">
        {users.map((u) => (
          <button key={u.id} type="button" onClick={() => { setUser(u); setPin(''); setError(null); }} className="rounded-2xl px-3 py-6 text-lg font-bold active:scale-95" style={{ backgroundColor: u.color, color: textOn(u.color) }}>
            {u.name}
          </button>
        ))}
      </div>

      {user && (
        <Modal title={user.hasPin ? `Pincode ${user.name}` : `Eerste keer inloggen: ${user.name}`} onClose={() => setUser(null)}>
          <div className="text-slate-900">
            {user.hasPin ? (
              <>
                <PinDots length={4} filled={pin.length} />
                <NumPad value={pin} onChange={setPin} mode="pin" maxLength={4} />
              </>
            ) : (
              <div className="space-y-4">
                <label className="block">
                  <span className="font-semibold">Koppelcode</span>
                  <span className="block text-sm text-slate-500">Staat in het zwarte startvenster op de kassa-pc.</span>
                  <input value={pairingCode} onChange={(e) => setPairingCode(e.target.value.replace(/\D/g, ''))} inputMode="numeric" className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-3 text-center font-mono text-2xl tracking-widest" />
                </label>
                <div>
                  <span className="font-semibold">Kies je eigen pincode (4 cijfers)</span>
                  <PinDots length={4} filled={newPin.length} />
                  <NumPad value={newPin} onChange={setNewPin} mode="pin" maxLength={4} />
                </div>
                <Button variant="primary" size="lg" className="w-full" disabled={busy || pairingCode.length < 6 || newPin.length !== 4} onClick={() => login({ pin: '', pairingCode, newPin })}>
                  Opslaan en inloggen
                </Button>
              </div>
            )}
            <div className="mt-3">
              <ErrorBox message={error} />
            </div>
          </div>
        </Modal>
      )}
    </main>
  );
}

function PhoneHome({ products, categories, onLogout }: { products: PosProduct[]; categories: PosCategory[]; onLogout: () => void }) {
  const cart = useCart();
  const [state, setState] = useState<PhoneState | null>(null);
  const [tab, setTab] = useState<'verkoop' | 'vandaag'>('verkoop');
  const [cartOpen, setCartOpen] = useState(false);
  const [checkout, setCheckout] = useState<CheckoutState | null>(null);
  const [openPrice, setOpenPrice] = useState<PosProduct | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const r = await phoneStateAction();
    if (r.ok) setState(r.data);
    else if (/inloggen|actief/i.test(r.error)) onLogout();
  }, [onLogout]);

  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [refresh]);

  const guard = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  if (!state) return <main className="flex min-h-dvh items-center justify-center text-slate-500">Laden…</main>;

  const me: PosUser = { id: state.me.id, name: state.me.name, color: '#2563eb', role: 'MEDEWERKER', hasPin: true, hasPhone: state.hasPhoneLinked };
  const count = cart.cart.lines.reduce((s, l) => s + l.quantity, 0);

  return (
    <div className="flex min-h-dvh flex-col bg-slate-100">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 bg-slate-900 px-4 py-3 text-white">
        <div className="min-w-0 flex-1">
          <div className="text-xs text-slate-400">Ingelogd als</div>
          <div className="truncate font-bold">{state.me.name}</div>
        </div>
        <div className="flex shrink-0 gap-1 rounded-xl bg-slate-800 p-1">
          {(['verkoop', 'vandaag'] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)} className={cx('rounded-lg px-3 py-1.5 text-sm font-semibold', tab === t ? 'bg-white text-slate-900' : 'text-slate-300')}>
              {t === 'verkoop' ? 'Verkopen' : 'Vandaag'}
            </button>
          ))}
        </div>
        <button type="button" className="shrink-0 px-1 text-sm text-slate-300" onClick={async () => { await phoneLogoutAction(); onLogout(); }}>
          Uitloggen
        </button>
      </header>

      <div className="space-y-3 p-3">
        {!state.dayOpen && <ErrorBox message="De kassadag is nog niet gestart. Start de dag eerst op de kassa-pc." />}
        {!state.hasPhoneLinked && (
          <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">
            Je telefoon is nog niet gekoppeld aan Mollie. Vraag de beheerder dit te doen; tot die tijd kun je pinbetalingen alleen handmatig bevestigen.
          </div>
        )}
        <ErrorBox message={error} onClose={() => setError(null)} />
        {message && (
          <div className="flex justify-between rounded-xl bg-emerald-50 px-4 py-3 text-emerald-900 ring-1 ring-emerald-200">
            <span>{message}</span>
            <button type="button" onClick={() => setMessage(null)}>×</button>
          </div>
        )}

        {/* Bedragen die (door de kassa-pc of door mij) naar mijn telefoon zijn gestuurd */}
        {!checkout &&
          state.pending.map((p) => (
            <div key={p.id} className="rounded-2xl bg-blue-600 p-4 text-white shadow-lg">
              <div className="text-sm opacity-90">Staat klaar in je Mollie Tap-app · {p.number}</div>
              <Money cents={p.amountCents} className="block text-5xl font-extrabold" />
              <div className="mt-2 flex gap-2">
                <Button size="sm" className="flex-1" onClick={() => guard(async () => {
                  const r = await checkoutStateAction(p.orderId);
                  if (!r.ok) return setError(r.error);
                  setCheckout(r.data);
                })}>
                  Bekijken
                </Button>
                <Button size="sm" variant="danger" onClick={() => guard(async () => {
                  const r = await cancelPinAction(p.id);
                  if (!r.ok) return setError(r.error);
                  void refresh();
                })}>
                  Annuleren
                </Button>
              </div>
            </div>
          ))}

        {!checkout && state.openOrders.filter((o) => !state.pending.some((p) => p.orderId === o.id)).length > 0 && (
          <div className="rounded-2xl bg-white p-3 ring-1 ring-slate-200">
            <div className="mb-2 font-semibold">Nog af te rekenen</div>
            {state.openOrders
              .filter((o) => !state.pending.some((p) => p.orderId === o.id))
              .map((o) => (
                <button key={o.id} type="button" className="flex w-full justify-between rounded-lg px-2 py-2 text-left hover:bg-slate-50" onClick={() => guard(async () => {
                  const r = await checkoutStateAction(o.id);
                  if (!r.ok) return setError(r.error);
                  setCheckout(r.data);
                })}>
                  <span>{o.number ?? 'Bon zonder nummer'}</span>
                  <Money cents={o.totalInclCents} className="font-semibold" />
                </button>
              ))}
          </div>
        )}
      </div>

      {tab === 'vandaag' ? (
        <section className="space-y-3 px-3 pb-6">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
              <div className="text-sm text-slate-500">Pinbetalingen</div>
              <div className="text-3xl font-bold">{state.today.count}</div>
            </div>
            <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
              <div className="text-sm text-slate-500">Totaal gepind</div>
              <Money cents={state.today.totalCents} className="block text-3xl font-bold" />
            </div>
          </div>
          <p className="text-sm text-slate-500">Dit totaal moet gelijk zijn aan het dagtotaal in je Mollie Tap-app.</p>
          <ul className="divide-y divide-slate-100 rounded-2xl bg-white ring-1 ring-slate-200">
            {state.today.payments.map((p) => (
              <li key={p.id} className="flex justify-between px-4 py-2">
                <span>
                  {p.number} <span className="text-sm text-slate-500">{p.paidAt ? new Date(p.paidAt).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }) : ''}{p.mode === 'MANUAL' ? ' · handmatig' : ''}</span>
                </span>
                <Money cents={p.amountCents} />
              </li>
            ))}
          </ul>
        </section>
      ) : checkout ? (
        <section className="flex-1 px-3 pb-4">
          <CheckoutPanel
            state={checkout}
            channel="telefoon"
            users={[me]}
            activeUserId={me.id}
            mollieConfigured={state.mollieConfigured}
            defaultPinMode="API"
            onState={setCheckout}
            onPaid={(s) => {
              setCheckout(null);
              cart.clear();
              setMessage(`${s.number} betaald (${formatEUR(s.totalInclCents)})`);
              void refresh();
            }}
            onBackToCart={() => setCheckout(null)}
            onVoided={() => {
              setCheckout(null);
              cart.clear();
              void refresh();
            }}
          />
        </section>
      ) : (
        <section className="flex min-h-0 flex-1 flex-col px-3 pb-24">
          <div className="min-h-[60dvh] flex-1">
            <ProductPicker products={products} categories={categories} onPick={(p) => (p.openPrice ? setOpenPrice(p) : cart.add(p))} compact />
          </div>
        </section>
      )}

      {/* Onderbalk met de bon */}
      {tab === 'verkoop' && !checkout && count > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white p-3 shadow-[0_-4px_12px_rgba(0,0,0,0.08)]">
          <Button variant="success" size="lg" className="w-full" onClick={() => setCartOpen(true)}>
            Bon bekijken ({count}) · {cart.calc ? formatEUR(cart.calc.totalInclCents) : '…'}
          </Button>
        </div>
      )}

      {cartOpen && (
        <Modal
          title="Bon"
          onClose={() => setCartOpen(false)}
          footer={
            <div className="space-y-2">
              <Button
                variant="success"
                size="lg"
                className="w-full"
                disabled={busy || !cart.calc || cart.cart.lines.length === 0 || !state.dayOpen}
                onClick={() => guard(async () => {
                  const r = await checkoutAction({ orderId: cart.cart.orderId, cart: cart.toRequest() });
                  if (!r.ok) return setError(r.error);
                  cart.setOrderId(r.data.orderId);
                  setCartOpen(false);
                  if (r.data.status === 'PAID') {
                    cart.clear();
                    setMessage(`${r.data.number} afgerond`);
                  } else setCheckout(r.data);
                })}
              >
                Afrekenen met pin
              </Button>
              <Button
                className="w-full"
                disabled={busy || cart.cart.lines.length === 0 || !state.dayOpen}
                onClick={() => guard(async () => {
                  const r = await parkAction({ orderId: cart.cart.orderId, cart: cart.toRequest(), label: `Contant – ${state.me.name}` });
                  if (!r.ok) return setError(r.error);
                  cart.clear();
                  setCartOpen(false);
                  setMessage('Geparkeerd: de klant kan contant afrekenen bij de kassa');
                })}
              >
                Klant betaalt contant bij de kassa (parkeren)
              </Button>
            </div>
          }
        >
          <div className="h-[50dvh]">
            <CartView cart={cart} compact />
          </div>
        </Modal>
      )}

      {openPrice && (
        <OpenPriceDialog
          product={openPrice}
          onClose={() => setOpenPrice(null)}
          onConfirm={(cents) => {
            cart.add(openPrice, cents);
            setOpenPrice(null);
          }}
        />
      )}
    </div>
  );
}
