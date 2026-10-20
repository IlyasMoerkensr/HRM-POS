'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { cashMovementAction } from '@/app/actions/day';
import {
  checkoutAction,
  confirmDrawerAction,
  createCreditAction,
  discardDraftAction,
  findReturnAction,
  listParkedAction,
  logoutEmployeeAction,
  noSaleAction,
  parkAction,
  recentOrdersAction,
  refundCashAction,
  refundMollieAction,
  resumeOrderAction,
  startDayAction,
  switchEmployeeAction,
} from '@/app/actions/pos';
import { CartView, OpenPriceDialog } from '@/components/CartView';
import { CheckoutPanel } from '@/components/CheckoutPanel';
import { ProductPicker } from '@/components/ProductPicker';
import { Button, cx, digitsToCents, ErrorBox, Modal, Money, newKey, NumPad, PinDots, textOn } from '@/components/ui';
import { useCart } from '@/components/useCart';
import {
  CashDrawer,
  DEFAULT_KICK_CODE,
  getCashDrawer,
  openDrawerNoSale,
  parseKickCode,
  type DrawerStatus,
} from '@/lib/hardware/cashDrawer';
import { formatEUR } from '@/lib/money';
import type { CheckoutState, DrawerSettings, PosCategory, PosProduct, PosUser } from '@/lib/types';

export interface KassaProps {
  companyName: string;
  products: PosProduct[];
  categories: PosCategory[];
  users: PosUser[];
  activeUserId: string | null;
  day: { date: string; sequence: number; status: 'OPEN' | 'CLOSED'; zReport: { id: string; number: string } | null } | null;
  /** Wat er bij de laatste afsluiting in de lade is geteld (voorstel beginsaldo) */
  suggestedFloatCents: number;
  unclosedDays: string[];
  drawer: DrawerSettings;
  mollieConfigured: boolean;
  defaultPinMode: 'API' | 'MANUAL';
}

type Dialog = 'parked' | 'park' | 'nosale' | 'return' | 'recent' | 'clear' | 'cash' | null;

export function KassaApp(props: KassaProps) {
  const router = useRouter();
  const cart = useCart();
  const [activeUserId, setActiveUserId] = useState(props.activeUserId);
  const [switchTo, setSwitchTo] = useState<PosUser | null>(null);
  const [checkout, setCheckout] = useState<CheckoutState | null>(null);
  const [done, setDone] = useState<{ state: CheckoutState; changeCents: number | null } | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [openPrice, setOpenPrice] = useState<PosProduct | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [parkedCount, setParkedCount] = useState(0);

  const active = props.users.find((u) => u.id === activeUserId) ?? null;

  // ---------------------------------------------------------------- kassalade
  const drawerRef = useRef<CashDrawer | null>(null);
  const [drawerStatus, setDrawerStatus] = useState<{ status: DrawerStatus; error?: string }>({ status: 'disconnected' });

  useEffect(() => {
    let kickCode = DEFAULT_KICK_CODE;
    try {
      kickCode = parseKickCode(props.drawer.kickCode);
    } catch {
      /* ongeldige code in instellingen: standaard gebruiken */
    }
    const drawer = getCashDrawer({ kickCode, baudRate: props.drawer.baudRate, trigger: props.drawer.trigger, keepPortOpen: props.drawer.keepPortOpen });
    drawerRef.current = drawer;
    const off = drawer.onStatusChange((status, err) => setDrawerStatus({ status, error: err }));
    void drawer.autoConnect();
    return () => {
      off();
    };
  }, [props.drawer]);

  /** Na een contante betaling: lade open + vastleggen of dat lukte. */
  const kickForMovement = useCallback(async (movementId: string) => {
    const drawer = drawerRef.current;
    const result = drawer ? await drawer.kick() : { ok: false, error: 'Kassalade niet beschikbaar' };
    await confirmDrawerAction(movementId, result.ok, result.error);
    if (!result.ok) setError(`Kassalade ging niet open: ${result.error}. Open hem met de sleutel; de betaling is wel geregistreerd.`);
  }, []);

  // ---------------------------------------------------------------- parkeren
  const refreshParked = useCallback(async () => {
    const r = await listParkedAction();
    if (r.ok) setParkedCount(r.data.length);
  }, []);
  useEffect(() => {
    if (!activeUserId) return;
    void refreshParked();
    const id = setInterval(refreshParked, 15000);
    return () => clearInterval(id);
  }, [activeUserId, refreshParked]);

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

  const startCheckout = () =>
    guard(async () => {
      const r = await checkoutAction({ orderId: cart.cart.orderId, cart: cart.toRequest() });
      if (!r.ok) return setError(r.error);
      cart.setOrderId(r.data.orderId);
      if (r.data.status === 'PAID') {
        setDone({ state: r.data, changeCents: null });
        cart.clear();
      } else {
        setCheckout(r.data);
      }
    });

  const pickProduct = (p: PosProduct) => {
    if (p.openPrice) setOpenPrice(p);
    else cart.add(p);
  };

  // ---------------------------------------------------------------- render
  if (!activeUserId || !active) {
    return (
      <EmployeeChooser
        users={props.users}
        companyName={props.companyName}
        onPick={(u) => (u.hasPin ? setSwitchTo(u) : guard(async () => {
          const r = await switchEmployeeAction(u.id, null);
          if (!r.ok) return setError(r.error);
          setActiveUserId(u.id);
        }))}
        error={error}
        pinFor={switchTo}
        onPinClose={() => setSwitchTo(null)}
        onPinOk={(id) => {
          setActiveUserId(id);
          setSwitchTo(null);
        }}
      />
    );
  }

  return (
    <div className="flex h-dvh flex-col">
      {/* ------------------------------------------------ bovenbalk */}
      <header className="flex items-center gap-3 bg-slate-900 px-3 py-2 text-white">
        <div className="hidden shrink-0 pr-2 font-bold 2xl:block">{props.companyName}</div>
        <nav className="flex flex-1 gap-1.5 overflow-x-auto">
          {props.users.map((u) => (
            <button
              key={u.id}
              type="button"
              onClick={() => {
                if (u.id === activeUserId) return;
                if (u.hasPin) setSwitchTo(u);
                else void guard(async () => {
                  const r = await switchEmployeeAction(u.id, null);
                  if (!r.ok) return setError(r.error);
                  setActiveUserId(u.id);
                });
              }}
              className={cx('min-w-24 shrink-0 rounded-xl px-3 py-2.5 font-semibold whitespace-nowrap transition', u.id === activeUserId ? 'ring-2 ring-white ring-inset' : 'bg-slate-800 text-slate-300 hover:bg-slate-700')}
              style={u.id === activeUserId ? { backgroundColor: u.color, color: textOn(u.color) } : undefined}
            >
              {u.name}
            </button>
          ))}
        </nav>
        <DrawerChip status={drawerStatus} onConnect={() => drawerRef.current?.connect()} />
        <Button size="sm" variant="ghost" className="text-white hover:bg-slate-800" onClick={() => setDialog('nosale')}>
          Lade
        </Button>
        <Button size="sm" variant="ghost" className="text-white hover:bg-slate-800" onClick={() => setDialog('recent')}>
          Bonnen
        </Button>
        <Button size="sm" variant="ghost" className="text-white hover:bg-slate-800" onClick={() => setDialog('cash')}>
          Kas
        </Button>
        <Link href="/dagafsluiting" className="rounded-xl px-3 py-1.5 text-sm font-semibold hover:bg-slate-800">
          Dag
        </Link>
        {active.role !== 'MEDEWERKER' && (
          <Button size="sm" variant="ghost" className="text-white hover:bg-slate-800" onClick={() => setDialog('return')}>
            Retour
          </Button>
        )}
        {active.role === 'ADMIN' && (
          <Link href="/beheer" className="rounded-xl px-3 py-1.5 text-sm font-semibold hover:bg-slate-800">
            Beheer
          </Link>
        )}
        <Button size="sm" variant="ghost" className="text-white hover:bg-slate-800" title="Afmelden" onClick={() => guard(async () => { await logoutEmployeeAction(); setActiveUserId(null); })}>
          ⏻
        </Button>
      </header>

      {props.unclosedDays.length > 0 && (
        <div className="bg-amber-100 px-4 py-2 text-sm text-amber-900">
          Let op: {props.unclosedDays.join(', ')} {props.unclosedDays.length === 1 ? 'is' : 'zijn'} nog niet afgesloten met een Z-rapport.
        </div>
      )}
      {error && (
        <div className="px-3 pt-2">
          <ErrorBox message={error} onClose={() => setError(null)} />
        </div>
      )}

      {/* ------------------------------------------------ hoofdscherm */}
      <main className="grid min-h-0 flex-1 grid-cols-[1fr_minmax(22rem,26rem)] gap-3 p-3">
        <section className="min-h-0 rounded-2xl bg-slate-50">
          <ProductPicker products={props.products} categories={props.categories} onPick={pickProduct} />
        </section>
        <aside className="flex min-h-0 flex-col rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-lg font-bold">
              Bon <span className="font-normal text-slate-500">· {active.name}</span>
            </h2>
            <Button size="sm" onClick={() => setDialog('parked')}>
              Geparkeerd{parkedCount > 0 && <span className="rounded-full bg-amber-500 px-2 text-white">{parkedCount}</span>}
            </Button>
          </div>
          {cart.cart.label && <p className="mb-1 text-sm text-amber-700">Geparkeerd als: {cart.cart.label}</p>}
          <div className="min-h-0 flex-1">
            <CartView cart={cart} />
          </div>
          <div className="mt-3 grid grid-cols-[auto_auto_minmax(0,1fr)] gap-2">
            <Button onClick={() => setDialog('clear')} disabled={cart.cart.lines.length === 0}>
              Leeg
            </Button>
            <Button onClick={() => setDialog('park')} disabled={cart.cart.lines.length === 0 || busy}>
              Parkeren
            </Button>
            <Button variant="success" size="lg" className="min-w-0 py-5 whitespace-nowrap" disabled={!cart.calc || cart.cart.lines.length === 0 || busy || props.day?.status !== 'OPEN'} onClick={startCheckout}>
              Afrekenen {cart.calc && cart.cart.lines.length > 0 && <Money cents={cart.calc.totalInclCents} />}
            </Button>
          </div>
        </aside>
      </main>

      {/* ------------------------------------------------ dialogen */}
      {(!props.day || props.day.status !== 'OPEN') && (
        <DayStartDialog
          day={props.day}
          suggestedFloatCents={props.suggestedFloatCents}
          role={active.role}
          onStarted={() => router.refresh()}
          onSwitch={() => guard(async () => { await logoutEmployeeAction(); setActiveUserId(null); })}
        />
      )}

      {switchTo && (
        <PinPrompt
          user={switchTo}
          onClose={() => setSwitchTo(null)}
          onOk={(id) => {
            setActiveUserId(id);
            setSwitchTo(null);
          }}
        />
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

      {checkout && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="flex h-full max-h-[52rem] w-full max-w-4xl flex-col rounded-2xl bg-white p-5 shadow-2xl">
            <CheckoutPanel
              state={checkout}
              channel="kassa"
              users={props.users}
              activeUserId={activeUserId}
              mollieConfigured={props.mollieConfigured}
              defaultPinMode={props.defaultPinMode}
              onState={setCheckout}
              onPaid={(state, changeCents) => {
                setCheckout(null);
                setDone({ state, changeCents });
                cart.clear();
              }}
              onBackToCart={() => setCheckout(null)}
              onVoided={() => {
                setCheckout(null);
                cart.clear();
              }}
              onCashMovement={kickForMovement}
            />
          </div>
        </div>
      )}

      {done && <DoneScreen done={done} onClose={() => setDone(null)} />}

      {dialog === 'park' && (
        <ParkDialog
          initial={cart.cart.label}
          onClose={() => setDialog(null)}
          onPark={(label) =>
            guard(async () => {
              const r = await parkAction({ orderId: cart.cart.orderId, cart: cart.toRequest(), label });
              if (!r.ok) return setError(r.error);
              cart.clear();
              setDialog(null);
              void refreshParked();
            })
          }
        />
      )}

      {dialog === 'parked' && (
        <ParkedDialog
          onClose={() => setDialog(null)}
          cartBusy={cart.cart.lines.length > 0}
          onResume={(id) =>
            guard(async () => {
              const r = await resumeOrderAction(id);
              if (!r.ok) return setError(r.error);
              const missing = cart.load(r.data, props.products);
              if (missing) setError('Let op: een product van deze bon bestaat niet meer en is weggelaten.');
              setDialog(null);
            })
          }
          onChanged={refreshParked}
        />
      )}

      {dialog === 'clear' && (
        <Modal
          title="Bon leegmaken?"
          onClose={() => setDialog(null)}
          footer={
            <div className="grid grid-cols-2 gap-2">
              <Button onClick={() => setDialog(null)}>Nee</Button>
              <Button
                variant="danger"
                onClick={() =>
                  guard(async () => {
                    if (cart.cart.orderId) {
                      const r = await discardDraftAction(cart.cart.orderId);
                      if (!r.ok) return setError(r.error);
                    }
                    cart.clear();
                    setDialog(null);
                    void refreshParked();
                  })
                }
              >
                Ja, leegmaken
              </Button>
            </div>
          }
        >
          Alle regels van deze bon worden verwijderd. Er is nog niets afgerekend.
        </Modal>
      )}

      {dialog === 'nosale' && (
        <NoSaleDialog
          onClose={() => setDialog(null)}
          onOpen={async (reason) => {
            const drawer = drawerRef.current;
            if (!drawer) return 'Kassalade niet beschikbaar';
            const result = await openDrawerNoSale(
              { userId: activeUserId, reason },
              {
                register: async () => {
                  const r = await noSaleAction(reason);
                  if (!r.ok) throw new Error(r.error);
                  return r.data;
                },
                confirm: async (movementId, res) => {
                  await confirmDrawerAction(movementId, res.ok, res.error);
                },
              },
              drawer,
            ).catch((err: unknown) => ({ ok: false, error: err instanceof Error ? err.message : String(err) }));
            if (!result.ok) return result.error ?? 'Lade ging niet open';
            setDialog(null);
            return null;
          }}
        />
      )}

      {dialog === 'recent' && <RecentDialog onClose={() => setDialog(null)} />}

      {dialog === 'cash' && (
        <CashMovementDialog
          onClose={() => setDialog(null)}
          onSave={async (type, amountCents, reason) => {
            const r = await cashMovementAction({ type, amountCents, reason });
            if (!r.ok) return r.error;
            await kickForMovement(r.data.movementId);
            setDialog(null);
            return null;
          }}
        />
      )}

      {dialog === 'return' && (
        <ReturnDialog
          onClose={() => setDialog(null)}
          onCashMovement={kickForMovement}
          onDone={(state) => {
            setDialog(null);
            setDone({ state, changeCents: null });
          }}
        />
      )}
    </div>
  );
}

// ===========================================================================

function DrawerChip({ status, onConnect }: { status: { status: DrawerStatus; error?: string }; onConnect: () => void }) {
  const map: Record<DrawerStatus, [string, string]> = {
    connected: ['bg-emerald-500', 'Lade verbonden'],
    connecting: ['bg-amber-400', 'Verbinden…'],
    disconnected: ['bg-slate-500', 'Lade koppelen'],
    error: ['bg-rose-500', 'Lade: fout'],
    unsupported: ['bg-slate-600', 'Lade: gebruik Chrome/Edge'],
  };
  const [dot, label] = map[status.status];
  return (
    <button
      type="button"
      onClick={status.status === 'connected' || status.status === 'unsupported' ? undefined : onConnect}
      title={status.error ?? label}
      className="flex items-center gap-2 rounded-xl bg-slate-800 px-3 py-2 text-sm whitespace-nowrap"
    >
      <span className={cx('h-2.5 w-2.5 rounded-full', dot)} />
      {label}
    </button>
  );
}

function EmployeeChooser({
  users,
  companyName,
  onPick,
  error,
  pinFor,
  onPinClose,
  onPinOk,
}: {
  users: PosUser[];
  companyName: string;
  onPick: (u: PosUser) => void;
  error: string | null;
  pinFor: PosUser | null;
  onPinClose: () => void;
  onPinOk: (id: string) => void;
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-slate-900 p-6 text-white">
      <h1 className="text-3xl font-bold">{companyName}</h1>
      <p className="text-slate-300">Wie gaat er afrekenen?</p>
      <div className="grid w-full max-w-4xl grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {users.map((u) => (
          <button key={u.id} type="button" onClick={() => onPick(u)} className="rounded-2xl px-4 py-8 text-xl font-bold shadow-lg transition active:scale-95" style={{ backgroundColor: u.color, color: textOn(u.color) }}>
            {u.name}
            {u.hasPin && <span className="mt-1 block text-sm font-normal opacity-80">🔒 pincode</span>}
          </button>
        ))}
      </div>
      {error && <p className="text-rose-300">{error}</p>}
      {pinFor && <PinPrompt user={pinFor} onClose={onPinClose} onOk={onPinOk} />}
    </div>
  );
}

function PinPrompt({ user, onClose, onOk }: { user: PosUser; onClose: () => void; onOk: (id: string) => void }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (pin.length !== 4) return;
    void (async () => {
      const r = await switchEmployeeAction(user.id, pin);
      if (r.ok) onOk(user.id);
      else {
        setError(r.error);
        setPin('');
      }
    })();
  }, [pin, user.id, onOk]);

  return (
    <Modal title={`Pincode ${user.name}`} onClose={onClose}>
      <div className="text-slate-900">
        <PinDots length={4} filled={pin.length} />
        {error && <p className="mb-2 text-center text-rose-700">{error}</p>}
        <NumPad value={pin} onChange={setPin} mode="pin" maxLength={4} />
      </div>
    </Modal>
  );
}

function DayStartDialog({
  day,
  suggestedFloatCents,
  role,
  onStarted,
  onSwitch,
}: {
  day: KassaProps['day'];
  suggestedFloatCents: number;
  role: PosUser['role'];
  onStarted: () => void;
  onSwitch: () => void;
}) {
  const [digits, setDigits] = useState(suggestedFloatCents > 0 ? String(suggestedFloatCents) : '');
  const [newPeriod, setNewPeriod] = useState(false);
  const [confirmNewPeriod, setConfirmNewPeriod] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Snelkoppelingen die altijd bereikbaar blijven, ook vóór de start of na het afsluiten
  const links = (
    <div className="flex flex-wrap gap-2">
      {role === 'ADMIN' && (
        <Link href="/beheer" className="rounded-xl bg-white px-3 py-2 text-sm font-semibold ring-1 ring-slate-300">
          ⚙ Beheer
        </Link>
      )}
      <Link href="/rapporten" className="rounded-xl bg-white px-3 py-2 text-sm font-semibold ring-1 ring-slate-300">
        Z-rapporten
      </Link>
      {role !== 'MEDEWERKER' && (
        <Link href="/export" className="rounded-xl bg-white px-3 py-2 text-sm font-semibold ring-1 ring-slate-300">
          Export
        </Link>
      )}
      <button type="button" onClick={onSwitch} className="rounded-xl bg-white px-3 py-2 text-sm font-semibold ring-1 ring-slate-300">
        Andere medewerker
      </button>
    </div>
  );

  if (day?.status === 'CLOSED' && confirmNewPeriod) {
    return (
      <Modal title="Nieuwe kassaperiode starten?" onClose={() => setConfirmNewPeriod(false)}>
        <div className="space-y-4">
          <p>
            Gebruik dit alleen als de dag <strong>per ongeluk</strong> is afgesloten, of als je na het afsluiten toch nog moet verkopen.
          </p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
            <li>Het Z-rapport{day.zReport ? ` ${day.zReport.number}` : ''} blijft bestaan en verandert niet.</li>
            <li>Alles wat je nu verkoopt komt op een nieuw Z-rapport (periode {day.sequence + 1} van deze dag).</li>
            <li>Aan het eind van de dag sluit je deze periode gewoon weer af via “Dag”.</li>
          </ul>
          <div className="grid grid-cols-2 gap-2">
            <Button size="lg" onClick={() => setConfirmNewPeriod(false)}>
              Terug
            </Button>
            <Button variant="primary" size="lg" onClick={() => { setNewPeriod(true); setConfirmNewPeriod(false); }}>
              Ja, nieuwe periode
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  if (day?.status === 'CLOSED' && !newPeriod) {
    return (
      <Modal title="Kassadag afgesloten">
        <div className="space-y-4">
          <p>
            Vandaag is afgesloten{day.zReport ? ` met ${day.zReport.number}` : ''}. Er kan vandaag niets meer worden aangeslagen; dat houdt de administratie sluitend.
          </p>
          <p className="rounded-xl bg-slate-50 px-4 py-3 text-slate-700">
            <strong>Morgen</strong> start je hier gewoon een nieuwe dag: open de kassa, kies je naam en vul het beginsaldo in.
          </p>
          {day.zReport && (
            <Link href={`/rapporten/z/${day.zReport.id}`} className="inline-block rounded-xl bg-blue-600 px-4 py-2 font-semibold text-white">
              Z-rapport van vandaag bekijken
            </Link>
          )}
          {links}
          <div className="border-t border-slate-200 pt-4">
            {role === 'MEDEWERKER' ? (
              <p className="text-sm text-slate-500">Per ongeluk afgesloten? Vraag een manager of beheerder om een nieuwe kassaperiode te starten.</p>
            ) : (
              <button type="button" onClick={() => setConfirmNewPeriod(true)} className="text-sm font-semibold text-blue-700 underline">
                Per ongeluk afgesloten of toch nog verkopen? Nieuwe kassaperiode starten
              </button>
            )}
          </div>
        </div>
      </Modal>
    );
  }
  return (
    <Modal
      title={newPeriod ? `Nieuwe kassaperiode (periode ${(day?.sequence ?? 0) + 1})` : 'Kassadag starten'}
      onClose={newPeriod ? () => setNewPeriod(false) : undefined}
      footer={
        <Button
          variant="success"
          size="lg"
          className="w-full"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const r = await startDayAction(digitsToCents(digits), newPeriod);
            setBusy(false);
            if (!r.ok) return setError(r.error);
            onStarted();
          }}
        >
          {newPeriod ? `Start periode ${(day?.sequence ?? 0) + 1}` : 'Start de dag'} met {formatEUR(digitsToCents(digits))} in de lade
        </Button>
      }
    >
      <p className="mb-3 text-slate-600">
        Tel het wisselgeld in de lade en vul het beginsaldo in.
        {suggestedFloatCents > 0 && ` Voorgesteld: wat er bij de laatste afsluiting is geteld (${formatEUR(suggestedFloatCents)}).`}
      </p>
      <div className="mb-3">{links}</div>
      <div className="mb-3 rounded-xl bg-slate-50 px-4 py-4 text-right text-4xl font-bold">{formatEUR(digitsToCents(digits))}</div>
      <NumPad value={digits} onChange={setDigits} />
      <div className="mt-3">
        <ErrorBox message={error} />
      </div>
    </Modal>
  );
}

function DoneScreen({ done, onClose }: { done: { state: CheckoutState; changeCents: number | null }; onClose: () => void }) {
  useEffect(() => {
    const id = setTimeout(onClose, 30000);
    return () => clearTimeout(id);
  }, [onClose]);
  const credit = done.state.type === 'CREDIT';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-emerald-700/95 p-6 text-white" onClick={onClose}>
      <div className="w-full max-w-xl space-y-6 text-center">
        <div className="text-7xl">✓</div>
        <h2 className="text-4xl font-extrabold">{credit ? 'Terugbetaald' : 'Betaald'}</h2>
        <p className="text-xl opacity-90">
          {done.state.number} · {formatEUR(Math.abs(done.state.totalInclCents))}
        </p>
        {done.changeCents !== null && done.changeCents > 0 && (
          <div className="rounded-2xl bg-white/15 px-6 py-5">
            <div className="text-lg">Wisselgeld</div>
            <div className="text-7xl font-extrabold tabular">{formatEUR(done.changeCents)}</div>
          </div>
        )}
        <Button size="xl" className="w-full" onClick={onClose}>
          Nieuwe bon
        </Button>
      </div>
    </div>
  );
}

function ParkDialog({ initial, onClose, onPark }: { initial: string; onClose: () => void; onPark: (label: string) => void }) {
  const [label, setLabel] = useState(initial);
  return (
    <Modal title="Bon parkeren" onClose={onClose} footer={<Button variant="primary" className="w-full" onClick={() => onPark(label)}>Parkeren</Button>}>
      <p className="mb-2 text-slate-600">Geef de bon een herkenbare naam (optioneel).</p>
      <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} autoFocus className="w-full rounded-xl border border-slate-300 px-3 py-3 text-lg" placeholder="bijv. Man met rode jas" onKeyDown={(e) => e.key === 'Enter' && onPark(label)} />
    </Modal>
  );
}

function ParkedDialog({ onClose, onResume, onChanged, cartBusy }: { onClose: () => void; onResume: (id: string) => void; onChanged: () => void; cartBusy: boolean }) {
  const [items, setItems] = useState<{ id: string; label: string | null; totalInclCents: number; lineCount: number; cashier: string; cashierColor: string; updatedAt: Date }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await listParkedAction();
    if (r.ok) setItems(r.data);
    else setError(r.error);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Modal title="Geparkeerde bonnen" onClose={onClose} wide>
      <ErrorBox message={error} />
      {cartBusy && <p className="mb-3 rounded-xl bg-amber-50 px-4 py-2 text-amber-800">Parkeer of leeg eerst de huidige bon.</p>}
      {items === null ? (
        <p className="py-6 text-center text-slate-500">Laden…</p>
      ) : items.length === 0 ? (
        <p className="py-6 text-center text-slate-500">Geen geparkeerde bonnen</p>
      ) : (
        <ul className="space-y-2">
          {items.map((o) => (
            <li key={o.id} className="flex items-center gap-3 rounded-xl bg-slate-50 p-3">
              <span className="h-10 w-1.5 rounded-full" style={{ backgroundColor: o.cashierColor }} />
              <div className="flex-1">
                <div className="font-semibold">{o.label || 'Zonder naam'}</div>
                <div className="text-sm text-slate-500">
                  {o.cashier} · {o.lineCount} regel(s) · {new Date(o.updatedAt).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
              <Money cents={o.totalInclCents} className="text-lg font-bold" />
              <Button
                variant="danger"
                size="sm"
                onClick={async () => {
                  const r = await discardDraftAction(o.id);
                  if (!r.ok) return setError(r.error);
                  await load();
                  onChanged();
                }}
              >
                Weg
              </Button>
              <Button variant="primary" disabled={cartBusy} onClick={() => onResume(o.id)}>
                Ophalen
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function NoSaleDialog({ onClose, onOpen }: { onClose: () => void; onOpen: (reason: string) => Promise<string | null> }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const presets = ['Wisselgeld wisselen', 'Geld afromen', 'Controle kas', 'Bon nakijken'];
  return (
    <Modal
      title="Kassalade openen (geen verkoop)"
      onClose={onClose}
      footer={
        <Button
          variant="warning"
          size="lg"
          className="w-full"
          disabled={reason.trim().length < 3 || busy}
          onClick={async () => {
            setBusy(true);
            setError(await onOpen(reason));
            setBusy(false);
          }}
        >
          Lade openen
        </Button>
      }
    >
      <p className="mb-3 text-slate-600">Elke opening zonder verkoop wordt vastgelegd met jouw naam en de reden.</p>
      <div className="mb-3 flex flex-wrap gap-2">
        {presets.map((p) => (
          <Button key={p} size="sm" onClick={() => setReason(p)}>
            {p}
          </Button>
        ))}
      </div>
      <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} className="w-full rounded-xl border border-slate-300 px-3 py-3" placeholder="Reden (verplicht)" />
      <div className="mt-3">
        <ErrorBox message={error} />
      </div>
    </Modal>
  );
}

function RecentDialog({ onClose }: { onClose: () => void }) {
  type Row = Extract<Awaited<ReturnType<typeof recentOrdersAction>>, { ok: true }>['data'][number];
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void recentOrdersAction().then((r) => (r.ok ? setRows(r.data) : setError(r.error)));
  }, []);
  const status: Record<string, string> = { PAID: 'Betaald', PENDING_PAYMENT: 'Open', VOIDED: 'Geannuleerd', OPEN: 'Open', PARKED: 'Geparkeerd' };
  return (
    <Modal title="Bonnen van vandaag" onClose={onClose} wide>
      <ErrorBox message={error} />
      {rows === null ? (
        <p className="py-6 text-center text-slate-500">Laden…</p>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-slate-500">Nog geen bonnen vandaag</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="py-1">Bon</th>
              <th>Tijd</th>
              <th>Medewerker</th>
              <th>Status</th>
              <th className="text-right">Contant</th>
              <th className="text-right">Pin</th>
              <th className="text-right">Totaal</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id} className={cx(r.status === 'VOIDED' && 'text-slate-400 line-through')}>
                <td className="py-1.5 font-mono">{r.number}</td>
                <td>{r.at ? new Date(r.at).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }) : ''}</td>
                <td>{r.cashier}</td>
                <td title={r.voidReason ?? undefined}>{status[r.status]}</td>
                <td className="text-right tabular">{r.cash ? formatEUR(r.cash) : ''}</td>
                <td className="text-right tabular">{r.pin ? formatEUR(r.pin) : ''}</td>
                <td className="text-right font-semibold tabular">{formatEUR(r.totalInclCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}

// ===========================================================================
//  Retour / creditbon
// ===========================================================================

type ReturnInfo = Extract<Awaited<ReturnType<typeof findReturnAction>>, { ok: true }>['data'];

function ReturnDialog({ onClose, onDone, onCashMovement }: { onClose: () => void; onDone: (s: CheckoutState) => void; onCashMovement: (id: string) => Promise<void> }) {
  const year = new Date().getFullYear();
  const [number, setNumber] = useState(`BON-${year}-`);
  const [info, setInfo] = useState<ReturnInfo | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const [credit, setCredit] = useState<CheckoutState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newKey);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const total = info ? info.lines.reduce((s, l) => s + (qty[l.id] ?? 0) * l.unitPaidCents, 0) : 0;

  const finish = (state: CheckoutState) => {
    setKey(newKey());
    if (state.status === 'PAID') onDone(state);
    else setCredit(state);
  };

  return (
    <Modal title="Retour / creditbon" onClose={onClose} wide>
      <div className="space-y-4">
        <ErrorBox message={error} onClose={() => setError(null)} />

        {!info && (
          <div className="flex gap-2">
            <input value={number} onChange={(e) => setNumber(e.target.value.toUpperCase())} className="flex-1 rounded-xl border border-slate-300 px-3 py-3 font-mono text-lg" placeholder="BON-2026-00001" />
            <Button variant="primary" disabled={busy} onClick={() => run(async () => {
              const r = await findReturnAction(number);
              if (!r.ok) return setError(r.error);
              setInfo(r.data);
            })}>
              Zoeken
            </Button>
          </div>
        )}

        {info && !credit && (
          <>
            <p className="text-slate-600">
              {info.order.number} · {formatEUR(info.order.totalInclCents)}
            </p>
            <ul className="divide-y divide-slate-100">
              {info.lines.map((l) => (
                <li key={l.id} className="flex items-center gap-3 py-2">
                  <div className="flex-1">
                    <div className="font-medium">{l.description}</div>
                    <div className="text-sm text-slate-500">
                      {l.quantity}× gekocht{l.returnedQuantity > 0 && `, ${l.returnedQuantity} al retour`} · {formatEUR(l.unitPaidCents)} per stuk
                    </div>
                  </div>
                  <Button size="sm" disabled={!qty[l.id]} onClick={() => setQty({ ...qty, [l.id]: (qty[l.id] ?? 0) - 1 })}>
                    −
                  </Button>
                  <span className="tabular w-6 text-center font-bold">{qty[l.id] ?? 0}</span>
                  <Button size="sm" disabled={(qty[l.id] ?? 0) >= l.returnableQuantity} onClick={() => setQty({ ...qty, [l.id]: (qty[l.id] ?? 0) + 1 })}>
                    +
                  </Button>
                </li>
              ))}
            </ul>
            <input value={reason} onChange={(e) => setReason(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-3" placeholder="Reden van retour (verplicht)" />
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              disabled={busy || total === 0 || reason.trim().length < 3}
              onClick={() => run(async () => {
                const r = await createCreditAction({
                  originalOrderId: info.order.id,
                  items: Object.entries(qty).map(([lineId, quantity]) => ({ lineId, quantity })),
                  reason,
                });
                if (!r.ok) return setError(r.error);
                setCredit(r.data);
              })}
            >
              Creditbon maken (± {formatEUR(total)})
            </Button>
          </>
        )}

        {info && credit && (
          <div className="space-y-3">
            <div className="rounded-2xl bg-slate-900 px-5 py-4 text-white">
              <div className="text-slate-300">{credit.number}</div>
              <div className="flex items-baseline justify-between">
                <span>Terug te betalen</span>
                <Money cents={-credit.remainingCents} className="text-5xl font-extrabold" />
              </div>
            </div>
            <Button variant="warning" size="xl" className="w-full" disabled={busy || credit.remainingCents >= 0} onClick={() => run(async () => {
              const r = await refundCashAction({ creditOrderId: credit.orderId, amountCents: null, idempotencyKey: key });
              if (!r.ok) return setError(r.error);
              if (r.data.movementId) await onCashMovement(r.data.movementId);
              finish(r.data.state);
            })}>
              💶 Contant terug uit de lade
            </Button>
            {info.molliePayments.map((p) => {
              const amount = Math.min(p.amountCents, -credit.remainingCents);
              return (
                <Button key={p.id} variant="primary" size="lg" className="w-full" disabled={busy || !p.linked || amount <= 0} onClick={() => run(async () => {
                  const r = await refundMollieAction({ creditOrderId: credit.orderId, originalPaymentId: p.id, amountCents: amount, idempotencyKey: key });
                  if (!r.ok) return setError(r.error);
                  finish(r.data);
                })}>
                  📱 {formatEUR(amount)} terug op pinpas (via Mollie)
                  {!p.linked && <span className="text-sm font-normal"> — nog niet gekoppeld aan Mollie</span>}
                </Button>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}

function CashMovementDialog({ onClose, onSave }: { onClose: () => void; onSave: (type: 'CASH_IN' | 'CASH_OUT', amountCents: number, reason: string) => Promise<string | null> }) {
  const [type, setType] = useState<'CASH_IN' | 'CASH_OUT'>('CASH_OUT');
  const [digits, setDigits] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const amount = digitsToCents(digits);
  const presets = type === 'CASH_OUT' ? ['Afromen naar kluis', 'Storting bank', 'Contante uitgave'] : ['Wisselgeld uit kluis', 'Wisselgeld van bank'];
  return (
    <Modal
      title="Kasmutatie"
      onClose={onClose}
      footer={
        <Button
          variant={type === 'CASH_OUT' ? 'warning' : 'primary'}
          size="lg"
          className="w-full"
          disabled={busy || amount <= 0 || reason.trim().length < 3}
          onClick={async () => {
            setBusy(true);
            setError(await onSave(type, amount, reason));
            setBusy(false);
          }}
        >
          {type === 'CASH_OUT' ? `${formatEUR(amount)} uit de lade halen` : `${formatEUR(amount)} in de lade doen`}
        </Button>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
          {(['CASH_OUT', 'CASH_IN'] as const).map((t) => (
            <button key={t} type="button" onClick={() => { setType(t); setReason(''); }} className={cx('rounded-lg py-2.5 font-bold', type === t ? 'bg-white shadow' : 'text-slate-600')}>
              {t === 'CASH_OUT' ? 'Afromen (eruit)' : 'Bijvullen (erin)'}
            </button>
          ))}
        </div>
        <div className="rounded-xl bg-slate-50 px-4 py-3 text-right text-4xl font-bold">{formatEUR(amount)}</div>
        <NumPad value={digits} onChange={setDigits} />
        <div className="flex flex-wrap gap-2">
          {presets.map((p) => (
            <Button key={p} size="sm" onClick={() => setReason(p)}>
              {p}
            </Button>
          ))}
        </div>
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} className="w-full rounded-xl border border-slate-300 px-3 py-3" placeholder="Reden (verplicht)" />
        <ErrorBox message={error} />
        <p className="text-sm text-slate-500">De lade gaat open en de mutatie wordt vastgelegd met jouw naam.</p>
      </div>
    </Modal>
  );
}
