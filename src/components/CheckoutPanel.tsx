'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  backToCartAction,
  cancelPinAction,
  checkoutStateAction,
  confirmManualPinAction,
  payCashAction,
  startPinAction,
  voidOrderAction,
} from '@/app/actions/pos';
import { formatEUR } from '@/lib/money';
import type { CheckoutState, PosUser } from '@/lib/types';

import { Button, cx, digitsToCents, ErrorBox, Modal, Money, newKey, NumPad, textOn } from './ui';

const BILLS = [500, 1000, 2000, 5000];

export interface CheckoutPanelProps {
  state: CheckoutState;
  channel: 'kassa' | 'telefoon';
  users: PosUser[];
  activeUserId: string;
  mollieConfigured: boolean;
  defaultPinMode: 'API' | 'MANUAL';
  onState: (state: CheckoutState) => void;
  onPaid: (state: CheckoutState, changeCents: number | null) => void;
  onBackToCart: () => void;
  onVoided: () => void;
  /** Alleen kassa-pc: lade openen na contante betaling */
  onCashMovement?: (movementId: string) => Promise<void>;
}

export function CheckoutPanel(props: CheckoutPanelProps) {
  const { state, channel } = props;
  const [tab, setTab] = useState<'cash' | 'pin'>(channel === 'kassa' ? 'cash' : 'pin');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const pending = state.payments.find((p) => p.method === 'MOLLIE' && p.status === 'PENDING') ?? null;
  const lastChange = useRef<number | null>(null);

  const apply = useCallback(
    (next: CheckoutState) => {
      if (next.status === 'PAID') props.onPaid(next, lastChange.current);
      else props.onState(next);
    },
    [props],
  );

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

  const back = () =>
    guard(async () => {
      const r = await backToCartAction(state.orderId);
      if (!r.ok) return setError(r.error);
      props.onBackToCart();
    });

  const paidPayments = state.payments.filter((p) => p.status === 'PAID');
  const failed = state.payments.filter((p) => p.method === 'MOLLIE' && ['FAILED', 'CANCELED', 'EXPIRED'].includes(p.status)).at(-1);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="rounded-2xl bg-slate-900 px-5 py-4 text-white">
        <div className="flex items-baseline justify-between text-slate-300">
          <span>{state.number ?? 'Nieuwe bon'}</span>
          <span>Totaal {formatEUR(state.totalInclCents)}</span>
        </div>
        <div className="mt-1 flex items-baseline justify-between">
          <span className="text-lg">Te betalen</span>
          <Money cents={state.remainingCents + state.pendingCents} className="text-5xl font-extrabold" />
        </div>
        {paidPayments.length > 0 && (
          <ul className="mt-3 space-y-1 border-t border-slate-700 pt-2 text-sm text-slate-300">
            {paidPayments.map((p) => (
              <li key={p.id} className="flex justify-between">
                <span>
                  ✓ {p.method === 'CASH' ? 'Contant' : `Pin (${p.employeeName}${p.mollieMode === 'MANUAL' ? ', handmatig' : ''})`}
                </span>
                <Money cents={p.amountCents} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <ErrorBox message={error} onClose={() => setError(null)} />
      {failed && !pending && <ErrorBox message={`Pinbetaling ${failed.status === 'CANCELED' ? 'geannuleerd' : failed.status === 'EXPIRED' ? 'verlopen' : 'mislukt'}${failed.reason ? `: ${failed.reason}` : ''}. Probeer opnieuw of kies een andere betaalwijze.`} />}

      {pending ? (
        <PinWaiting {...props} pending={pending} apply={apply} setError={setError} />
      ) : (
        <>
          {channel === 'kassa' && (
            <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
              {(['cash', 'pin'] as const).map((t) => (
                <button key={t} type="button" onClick={() => setTab(t)} className={cx('rounded-lg py-3 text-lg font-bold', tab === t ? 'bg-white shadow' : 'text-slate-600')}>
                  {t === 'cash' ? '💶 Contant' : '📱 Pin (Mollie)'}
                </button>
              ))}
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === 'cash' && channel === 'kassa' ? (
              <CashTab {...props} busy={busy} guard={guard} setError={setError} apply={apply} lastChange={lastChange} />
            ) : (
              <PinTab {...props} busy={busy} guard={guard} setError={setError} apply={apply} />
            )}
          </div>
        </>
      )}

      {!pending && (
        <div className="flex gap-2">
          {!state.number ? (
            <Button onClick={back} disabled={busy} className="flex-1">
              ← Terug naar bon
            </Button>
          ) : (
            paidPayments.length === 0 && (
              <Button variant="danger" onClick={() => setVoidOpen(true)} disabled={busy} className="flex-1">
                Bon annuleren
              </Button>
            )
          )}
        </div>
      )}

      {voidOpen && (
        <VoidDialog
          number={state.number!}
          onClose={() => setVoidOpen(false)}
          onConfirm={async (reason) => {
            const r = await voidOrderAction(state.orderId, reason);
            if (!r.ok) return r.error;
            setVoidOpen(false);
            props.onVoided();
            return null;
          }}
        />
      )}
    </div>
  );
}

type TabProps = CheckoutPanelProps & {
  busy: boolean;
  guard: (fn: () => Promise<void>) => Promise<void>;
  setError: (e: string | null) => void;
  apply: (s: CheckoutState) => void;
};

function CashTab({ state, busy, guard, setError, apply, onCashMovement, lastChange }: TabProps & { lastChange: React.RefObject<number | null> }) {
  const remaining = state.remainingCents;
  const [digits, setDigits] = useState('');
  const [key, setKey] = useState(newKey);
  const tendered = digitsToCents(digits);
  const cashPart = Math.min(tendered, remaining);
  const change = tendered - cashPart;
  const rest = remaining - cashPart;

  const pay = () =>
    guard(async () => {
      const r = await payCashAction({ orderId: state.orderId, tenderedCents: tendered, amountCents: null, idempotencyKey: key });
      if (!r.ok) return setError(r.error);
      setKey(newKey());
      setDigits('');
      // Wisselgeld alleen tonen op het eindscherm als contant de bon afrondde
      lastChange.current = r.data.orderPaid ? r.data.changeCents : null;
      if (r.data.movementId && onCashMovement) await onCashMovement(r.data.movementId);
      apply(r.data.state);
    });

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Button variant="primary" size="lg" onClick={() => setDigits(String(remaining))} disabled={remaining <= 0}>
            Gepast
          </Button>
          {BILLS.map((b) => (
            <Button key={b} size="lg" onClick={() => setDigits(String(b))}>
              {formatEUR(b)}
            </Button>
          ))}
          <Button size="lg" onClick={() => setDigits(String(tendered + 500))}>
            + € 5
          </Button>
        </div>
        <div className="space-y-1 rounded-xl bg-slate-50 p-4 text-lg">
          <div className="flex justify-between">
            <span>Ontvangen</span>
            <Money cents={tendered} className="font-bold" />
          </div>
          {tendered > 0 && rest > 0 && (
            <div className="flex justify-between text-amber-700">
              <span>Restant via pin</span>
              <Money cents={rest} className="font-bold" />
            </div>
          )}
          <div className="flex items-baseline justify-between pt-1">
            <span className="font-semibold">Wisselgeld</span>
            <Money cents={change} className={cx('text-4xl font-extrabold', change > 0 ? 'text-emerald-700' : 'text-slate-400')} />
          </div>
        </div>
      </div>
      <div className="space-y-3">
        <NumPad value={digits} onChange={setDigits} />
        <Button variant="success" size="xl" className="w-full" disabled={busy || tendered <= 0 || remaining <= 0} onClick={pay}>
          {rest > 0 && tendered > 0 ? `${formatEUR(cashPart)} contant, rest pinnen` : 'Contant afrekenen'}
        </Button>
        {state.pendingCents > 0 && <p className="text-sm text-slate-500">Er loopt nog een pinbetaling van {formatEUR(state.pendingCents)}.</p>}
      </div>
    </div>
  );
}

function PinTab({ state, channel, users, activeUserId, mollieConfigured, defaultPinMode, busy, guard, setError, apply }: TabProps) {
  const remaining = state.remainingCents;
  const [digits, setDigits] = useState(String(remaining));
  const [employeeId, setEmployeeId] = useState(activeUserId);
  const [confirmManual, setConfirmManual] = useState(false);
  const [key, setKey] = useState(newKey);
  const [editAmount, setEditAmount] = useState(false);

  useEffect(() => setDigits(String(remaining)), [remaining]);

  const amount = Math.min(digitsToCents(digits), remaining);
  const employee = users.find((u) => u.id === employeeId);
  const canPush = mollieConfigured && Boolean(employee?.hasPhone);
  const isMe = employeeId === activeUserId;
  const who = channel === 'telefoon' || isMe ? 'mijn telefoon' : `telefoon van ${employee?.name}`;

  const push = () =>
    guard(async () => {
      const r = await startPinAction({ orderId: state.orderId, amountCents: amount, employeeId, idempotencyKey: key });
      setKey(newKey());
      if (!r.ok) return setError(r.error);
      apply(r.data.state);
    });

  const manual = () =>
    guard(async () => {
      const r = await confirmManualPinAction({ orderId: state.orderId, amountCents: amount, employeeId, idempotencyKey: key });
      setKey(newKey());
      setConfirmManual(false);
      if (!r.ok) return setError(r.error);
      apply(r.data);
    });

  if (remaining <= 0) return <p className="py-6 text-center text-slate-500">Er staat niets meer open.</p>;

  return (
    <div className="space-y-4">
      {channel === 'kassa' && (
        <div>
          <p className="mb-2 font-semibold">Op wiens telefoon wordt gepind?</p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {users.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => setEmployeeId(u.id)}
                className={cx('rounded-xl px-2 py-3 font-semibold ring-2 transition', u.id === employeeId ? '' : 'bg-white text-slate-700 ring-slate-200')}
                style={u.id === employeeId ? { backgroundColor: u.color, color: textOn(u.color), ['--tw-ring-color' as string]: u.color } : undefined}
              >
                {u.name}
                <span className="block text-xs font-normal opacity-80">{u.hasPhone ? '📱 gekoppeld' : 'geen telefoon'}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
        <span className="text-lg">Bedrag via pin</span>
        <button type="button" className="text-3xl font-extrabold tabular underline decoration-dotted underline-offset-4" onClick={() => setEditAmount((v) => !v)}>
          {formatEUR(amount)}
        </button>
      </div>
      {editAmount && (
        <div className="space-y-2">
          <p className="text-sm text-slate-500">Deel van het bedrag pinnen (split-betaling). De rest kan daarna contant of met een tweede pinbetaling.</p>
          <NumPad value={digits} onChange={setDigits} />
        </div>
      )}

      <div className="space-y-2">
        <Button variant="primary" size="xl" className="w-full" disabled={busy || amount <= 0 || !canPush} onClick={push}>
          📲 Stuur {formatEUR(amount)} naar {who}
        </Button>
        {!mollieConfigured && <p className="text-sm text-slate-500">Mollie-koppeling is nog niet ingesteld (API-sleutel). Gebruik handmatig bevestigen.</p>}
        {mollieConfigured && !employee?.hasPhone && <p className="text-sm text-slate-500">De telefoon van {employee?.name} is nog niet gekoppeld (Beheer → Medewerkers).</p>}
        <Button variant={defaultPinMode === 'MANUAL' || !canPush ? 'success' : 'secondary'} size="lg" className="w-full" disabled={busy || amount <= 0} onClick={() => setConfirmManual(true)}>
          ✓ Handmatig ingetikt op {who}
        </Button>
      </div>

      {confirmManual && (
        <Modal title="Pinbetaling bevestigen" onClose={() => setConfirmManual(false)}>
          <div className="space-y-5 text-center">
            <p className="text-lg">Heeft de klant dit bedrag betaald in de Mollie Tap-app op {who}?</p>
            <Money cents={amount} className="block text-6xl font-extrabold" />
            <p className="text-sm text-slate-500">Controleer of op de telefoon “Betaling geslaagd” staat. De kassa vergelijkt dit later automatisch met Mollie.</p>
            <div className="grid grid-cols-2 gap-3">
              <Button size="lg" onClick={() => setConfirmManual(false)}>
                Nee, terug
              </Button>
              <Button variant="success" size="lg" disabled={busy} onClick={manual}>
                Ja, geslaagd
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Wachten tot de klant op de telefoon heeft betaald (polling elke 2 s). */
function PinWaiting({
  state,
  pending,
  apply,
  setError,
}: CheckoutPanelProps & { pending: CheckoutState['payments'][number]; apply: (s: CheckoutState) => void; setError: (e: string | null) => void }) {
  const [cancelling, setCancelling] = useState(false);
  const [seconds, setSeconds] = useState(0);
  // Laatste versies van de callbacks, zonder de polling telkens te herstarten
  const applyRef = useRef(apply);
  const errorRef = useRef(setError);
  useEffect(() => {
    applyRef.current = apply;
    errorRef.current = setError;
  });

  useEffect(() => {
    let stopped = false;
    let failures = 0;
    const tick = async () => {
      if (stopped) return;
      setSeconds((s) => s + 2);
      try {
        const res = await fetch(`/api/payments/${pending.id}/status`, { cache: 'no-store' });
        const body = (await res.json()) as { status?: string; error?: string };
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        failures = 0;
        if (body.status && body.status !== 'PENDING') {
          const r = await checkoutStateAction(state.orderId);
          if (r.ok && !stopped) applyRef.current(r.data);
        }
      } catch (err) {
        failures += 1;
        if (failures >= 5) errorRef.current(`Status ophalen lukt niet: ${err instanceof Error ? err.message : err}`);
      }
    };
    const id = setInterval(tick, 2000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [pending.id, state.orderId]);

  const cancel = async () => {
    setCancelling(true);
    const r = await cancelPinAction(pending.id);
    setCancelling(false);
    if (!r.ok) return setError(r.error);
    apply(r.data);
  };

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 rounded-2xl bg-blue-50 p-6 text-center ring-1 ring-blue-200">
      <div className="h-16 w-16 animate-spin rounded-full border-8 border-blue-200 border-t-blue-600" />
      <div>
        <p className="text-xl font-semibold">Wacht op betaling op de telefoon van {pending.employeeName}</p>
        <Money cents={pending.amountCents} className="mt-2 block text-6xl font-extrabold" />
        <p className="mt-2 text-slate-600">De klant kan de pas of telefoon tegen de telefoon houden.</p>
        <p className="mt-1 text-sm text-slate-400">{seconds} s</p>
      </div>
      <Button variant="danger" onClick={cancel} disabled={cancelling}>
        Pinbetaling annuleren
      </Button>
    </div>
  );
}

function VoidDialog({ number, onClose, onConfirm }: { number: string; onClose: () => void; onConfirm: (reason: string) => Promise<string | null> }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const reasons = ['Klant ziet af van aankoop', 'Verkeerd aangeslagen', 'Klant liep weg'];
  return (
    <Modal
      title={`${number} annuleren`}
      onClose={onClose}
      footer={
        <Button
          variant="danger"
          className="w-full"
          disabled={reason.trim().length < 3}
          onClick={async () => setError(await onConfirm(reason))}
        >
          Bon annuleren
        </Button>
      }
    >
      <p className="mb-3 text-slate-600">Het bonnummer blijft zichtbaar als “geannuleerd”, zodat de nummering sluitend is.</p>
      <div className="mb-3 flex flex-wrap gap-2">
        {reasons.map((r) => (
          <Button key={r} size="sm" onClick={() => setReason(r)}>
            {r}
          </Button>
        ))}
      </div>
      <input value={reason} onChange={(e) => setReason(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2" placeholder="Reden" />
      <div className="mt-3">
        <ErrorBox message={error} />
      </div>
    </Modal>
  );
}
