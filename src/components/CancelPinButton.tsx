'use client';

import { useState } from 'react';

import { cancelPinAction } from '@/app/actions/pos';
import { formatEUR } from '@/lib/money';
import type { CheckoutState } from '@/lib/types';

import { Button, Modal } from './ui';

/**
 * Pinverzoek annuleren. Lukt dat niet bij Mollie, dan volgt een tweede stap:
 * "Toch afbreken in de kassa" met duidelijke uitleg.
 */
export function CancelPinButton({
  paymentId,
  amountCents,
  onDone,
  onError,
  label = 'Pinbetaling annuleren',
  size = 'md',
}: {
  paymentId: string;
  amountCents: number;
  onDone: (state: CheckoutState) => void;
  onError: (message: string | null) => void;
  label?: string;
  size?: 'sm' | 'md';
}) {
  const [busy, setBusy] = useState(false);
  const [needsForce, setNeedsForce] = useState<string | null>(null);

  const cancel = async (force: boolean) => {
    setBusy(true);
    onError(null);
    const r = await cancelPinAction(paymentId, force);
    setBusy(false);
    if (r.ok) {
      setNeedsForce(null);
      return onDone(r.data);
    }
    if (!force && /in de kassa afbreken/.test(r.error)) return setNeedsForce(r.error);
    setNeedsForce(null);
    onError(r.error);
  };

  return (
    <>
      <Button variant="danger" size={size} disabled={busy} onClick={() => cancel(false)}>
        {busy ? 'Bezig…' : label}
      </Button>
      {needsForce && (
        <Modal title="Pinbetaling afbreken in de kassa?" onClose={() => setNeedsForce(null)}>
          <div className="space-y-4">
            <p className="rounded-xl bg-amber-50 px-4 py-3 text-amber-900">{needsForce}</p>
            <p>
              Doe dit alleen als de klant <strong>niet</strong> heeft betaald ({formatEUR(amountCents)}).
            </p>
            <p className="text-sm text-slate-600">
              Slaagt de betaling later toch nog, dan zie je dat bij de Mollie-controle in de dagafsluiting als “alleen in Mollie”. Er raakt dus niets kwijt.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button size="lg" onClick={() => setNeedsForce(null)}>
                Terug
              </Button>
              <Button variant="danger" size="lg" disabled={busy} onClick={() => cancel(true)}>
                Ja, afbreken
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
