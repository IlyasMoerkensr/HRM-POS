'use client';

import { useState } from 'react';

import { formatEUR } from '@/lib/money';
import type { OrderDiscount } from '@/lib/orders/calc';
import type { PosProduct } from '@/lib/types';

import { Button, cx, digitsToCents, Modal, Money, NumPad } from './ui';
import type { Cart, CartLine } from './useCart';

const VAT_LABEL: Record<string, string> = { HOOG: 'Btw 21%', LAAG: 'Btw 9%', NUL: 'Btw 0%' };
export const vatLabel = (code: string, bp: number) => VAT_LABEL[code] ?? `Btw ${bp / 100}%`;

/** De actieve bon met live btw-uitsplitsing. */
export function CartView({ cart, compact }: { cart: Cart; compact?: boolean }) {
  const [editing, setEditing] = useState<CartLine | null>(null);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const { calc } = cart;
  const lines = cart.cart.lines;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {lines.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 py-10 text-slate-400">
            <span className="text-4xl">🧾</span>
            <span>Tik op een product om te beginnen</span>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {lines.map((l, i) => {
              const c = calc?.lines[i];
              return (
                <li key={l.key} className="flex items-center gap-2 py-2">
                  <div className="flex items-center gap-1">
                    <button type="button" className="h-10 w-10 rounded-lg bg-slate-100 text-xl font-bold active:bg-slate-300" onClick={() => cart.update(l.key, { quantity: l.quantity - 1 })} aria-label="Minder">
                      −
                    </button>
                    <span className="tabular w-8 text-center text-lg font-semibold">{l.quantity}</span>
                    <button type="button" className="h-10 w-10 rounded-lg bg-slate-100 text-xl font-bold active:bg-slate-300" onClick={() => cart.update(l.key, { quantity: l.quantity + 1 })} aria-label="Meer">
                      +
                    </button>
                  </div>
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setEditing(l)}>
                    <div className="truncate font-medium">{l.product.name}</div>
                    <div className="text-xs text-slate-500">
                      {formatEUR(l.unitPriceInclCents)} · {vatLabel(l.product.vatCode, l.product.vatRateBp)}
                      {l.lineDiscountCents > 0 && <span className="text-amber-700"> · korting {formatEUR(l.lineDiscountCents)}</span>}
                      {l.note && <span className="text-blue-700"> · {l.note}</span>}
                    </div>
                  </button>
                  <Money cents={c?.totalInclCents ?? l.quantity * l.unitPriceInclCents - l.lineDiscountCents} className="w-20 text-right font-semibold" />
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {!compact && lines.length > 0 && (
        <div className="flex gap-2 border-t border-slate-200 pt-2">
          <Button size="sm" onClick={() => setDiscountOpen(true)} className="flex-1">
            {cart.cart.discount ? 'Bonkorting wijzigen' : '% / € korting'}
          </Button>
          <Button size="sm" onClick={() => setNoteOpen(true)} className="flex-1">
            {cart.cart.note ? 'Opmerking ✓' : 'Opmerking'}
          </Button>
        </div>
      )}

      {calc && lines.length > 0 && (
        <dl className="mt-2 space-y-0.5 border-t border-slate-200 pt-2 text-sm text-slate-600">
          {!compact && (
            <>
              <Row label="Subtotaal excl. btw" cents={calc.subtotalExclCents} />
              {calc.vatLines.map((v) => (
                <Row key={v.vatCode} label={`${vatLabel(v.vatCode, v.vatRateBp)} over ${formatEUR(v.totalExclCents)}`} cents={v.vatCents} />
              ))}
            </>
          )}
          {calc.discountCents > 0 && <Row label="Totale korting" cents={-calc.discountCents} className="text-amber-700" />}
          <div className="flex items-baseline justify-between pt-1 text-2xl font-bold text-slate-900">
            <dt>Totaal</dt>
            <dd className="tabular">{formatEUR(calc.totalInclCents)}</dd>
          </div>
        </dl>
      )}
      {cart.error && <p className="mt-2 text-sm text-rose-700">{cart.error}</p>}

      {editing && (
        <LineEditor
          line={lines.find((l) => l.key === editing.key) ?? editing}
          onClose={() => setEditing(null)}
          onChange={(patch) => cart.update(editing.key, patch)}
          onRemove={() => {
            cart.remove(editing.key);
            setEditing(null);
          }}
        />
      )}
      {discountOpen && <OrderDiscountEditor value={cart.cart.discount} onClose={() => setDiscountOpen(false)} onSave={(d) => { cart.setDiscount(d); setDiscountOpen(false); }} />}
      {noteOpen && <NoteEditor value={cart.cart.note} onClose={() => setNoteOpen(false)} onSave={(n) => { cart.setNote(n); setNoteOpen(false); }} />}
    </div>
  );
}

function Row({ label, cents, className }: { label: string; cents: number; className?: string }) {
  return (
    <div className={cx('flex justify-between', className)}>
      <dt>{label}</dt>
      <dd className="tabular">{formatEUR(cents)}</dd>
    </div>
  );
}

function LineEditor({
  line,
  onClose,
  onChange,
  onRemove,
}: {
  line: CartLine;
  onClose: () => void;
  onChange: (patch: Partial<Omit<CartLine, 'key' | 'product'>>) => void;
  onRemove: () => void;
}) {
  const [mode, setMode] = useState<'EUR' | 'PCT'>('EUR');
  const [digits, setDigits] = useState(line.lineDiscountCents ? String(line.lineDiscountCents) : '');
  const [note, setNote] = useState(line.note ?? '');
  const gross = line.quantity * line.unitPriceInclCents;
  const discountCents = mode === 'EUR' ? digitsToCents(digits) : Math.round((gross * Math.min(Number(digits || 0), 100)) / 100);

  return (
    <Modal
      title={line.product.name}
      onClose={onClose}
      footer={
        <div className="flex gap-2">
          <Button variant="danger" onClick={onRemove}>
            Verwijderen
          </Button>
          <Button
            variant="primary"
            className="flex-1"
            onClick={() => {
              onChange({ lineDiscountCents: Math.min(discountCents, gross), note: note.trim() || null });
              onClose();
            }}
          >
            Opslaan
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center justify-center gap-4">
          <Button size="lg" onClick={() => onChange({ quantity: line.quantity - 1 })}>
            −
          </Button>
          <span className="tabular w-16 text-center text-3xl font-bold">{line.quantity}</span>
          <Button size="lg" onClick={() => onChange({ quantity: line.quantity + 1 })}>
            +
          </Button>
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="font-semibold">Korting op deze regel</span>
            <div className="flex rounded-lg bg-slate-100 p-1">
              {(['EUR', 'PCT'] as const).map((m) => (
                <button key={m} type="button" onClick={() => { setMode(m); setDigits(''); }} className={cx('rounded-md px-3 py-1 font-semibold', mode === m && 'bg-white shadow')}>
                  {m === 'EUR' ? '€' : '%'}
                </button>
              ))}
            </div>
          </div>
          <div className="mb-2 rounded-xl bg-slate-50 px-4 py-3 text-right text-2xl font-bold">
            {mode === 'EUR' ? formatEUR(digitsToCents(digits)) : `${digits || 0}%  (${formatEUR(discountCents)})`}
          </div>
          <NumPad value={digits} onChange={setDigits} maxLength={mode === 'EUR' ? 6 : 3} mode={mode === 'EUR' ? 'money' : 'pin'} />
        </div>
        <label className="block">
          <span className="font-semibold">Opmerking</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" placeholder="bijv. zonder ijs" />
        </label>
      </div>
    </Modal>
  );
}

function OrderDiscountEditor({ value, onClose, onSave }: { value: OrderDiscount; onClose: () => void; onSave: (d: OrderDiscount) => void }) {
  const [mode, setMode] = useState<'PERCENT' | 'AMOUNT'>(value?.type ?? 'PERCENT');
  const [digits, setDigits] = useState(value ? String(value.type === 'PERCENT' ? value.value / 100 : value.value) : '');
  const display = mode === 'AMOUNT' ? formatEUR(digitsToCents(digits)) : `${digits || 0}%`;
  return (
    <Modal
      title="Korting op de hele bon"
      onClose={onClose}
      footer={
        <div className="flex gap-2">
          <Button onClick={() => onSave(null)}>Geen korting</Button>
          <Button
            variant="primary"
            className="flex-1"
            onClick={() => {
              const n = Number(digits || 0);
              if (n === 0) return onSave(null);
              onSave(mode === 'PERCENT' ? { type: 'PERCENT', value: Math.min(n, 100) * 100 } : { type: 'AMOUNT', value: n });
            }}
          >
            Toepassen
          </Button>
        </div>
      }
    >
      <div className="mb-3 flex justify-center rounded-lg bg-slate-100 p-1">
        {(['PERCENT', 'AMOUNT'] as const).map((m) => (
          <button key={m} type="button" onClick={() => { setMode(m); setDigits(''); }} className={cx('flex-1 rounded-md px-3 py-2 font-semibold', mode === m && 'bg-white shadow')}>
            {m === 'PERCENT' ? 'Percentage' : 'Bedrag'}
          </button>
        ))}
      </div>
      {mode === 'PERCENT' && (
        <div className="mb-3 grid grid-cols-4 gap-2">
          {[5, 10, 15, 25].map((p) => (
            <Button key={p} onClick={() => setDigits(String(p))}>
              {p}%
            </Button>
          ))}
        </div>
      )}
      <div className="mb-2 rounded-xl bg-slate-50 px-4 py-3 text-right text-3xl font-bold">{display}</div>
      <NumPad value={digits} onChange={setDigits} mode={mode === 'AMOUNT' ? 'money' : 'pin'} maxLength={mode === 'AMOUNT' ? 6 : 3} />
    </Modal>
  );
}

function NoteEditor({ value, onClose, onSave }: { value: string; onClose: () => void; onSave: (v: string) => void }) {
  const [note, setNote] = useState(value);
  return (
    <Modal title="Opmerking bij de bon" onClose={onClose} footer={<Button variant="primary" className="w-full" onClick={() => onSave(note.trim())}>Opslaan</Button>}>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={4} autoFocus className="w-full rounded-xl border border-slate-300 p-3" placeholder="Bijv. naam klant, afspraak…" />
    </Modal>
  );
}

/** Bedrag invoeren voor een product met vrije prijs ("Diversen"). */
export function OpenPriceDialog({ product, onClose, onConfirm }: { product: PosProduct; onClose: () => void; onConfirm: (cents: number) => void }) {
  const [digits, setDigits] = useState('');
  const cents = digitsToCents(digits);
  return (
    <Modal
      title={`Bedrag voor ${product.name}`}
      onClose={onClose}
      footer={
        <Button variant="primary" size="lg" className="w-full" disabled={cents <= 0} onClick={() => onConfirm(cents)}>
          Toevoegen
        </Button>
      }
    >
      <div className="mb-3 rounded-xl bg-slate-50 px-4 py-4 text-right text-4xl font-bold">{formatEUR(cents)}</div>
      <NumPad value={digits} onChange={setDigits} />
      <p className="mt-3 text-sm text-slate-500">Inclusief btw ({vatLabel(product.vatCode, product.vatRateBp)})</p>
    </Modal>
  );
}
