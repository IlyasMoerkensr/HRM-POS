'use client';

import { useCallback, useMemo, useState } from 'react';

import { calculateOrder, type CalculatedOrder, type OrderDiscount } from '@/lib/orders/calc';
import type { CartRequest } from '@/lib/orders/orderService';
import type { PosProduct } from '@/lib/types';

export interface CartLine {
  key: string;
  product: PosProduct;
  quantity: number;
  unitPriceInclCents: number;
  lineDiscountCents: number;
  note: string | null;
}

export interface CartState {
  orderId: string | null;
  lines: CartLine[];
  discount: OrderDiscount;
  note: string;
  label: string;
}

const empty = (): CartState => ({ orderId: null, lines: [], discount: null, note: '', label: '' });
let seq = 0;
const lineKey = () => `l${Date.now().toString(36)}${(seq++).toString(36)}`;

export function useCart() {
  const [cart, setCart] = useState<CartState>(empty);

  const add = useCallback((product: PosProduct, unitPriceInclCents?: number) => {
    setCart((c) => {
      const price = product.openPrice ? unitPriceInclCents ?? 0 : product.priceInclCents;
      // Zelfde product zonder korting/opmerking → aantal ophogen
      const existing = c.lines.find(
        (l) => l.product.id === product.id && !product.openPrice && l.lineDiscountCents === 0 && !l.note,
      );
      if (existing) {
        return { ...c, lines: c.lines.map((l) => (l === existing ? { ...l, quantity: l.quantity + 1 } : l)) };
      }
      return { ...c, lines: [...c.lines, { key: lineKey(), product, quantity: 1, unitPriceInclCents: price, lineDiscountCents: 0, note: null }] };
    });
  }, []);

  const update = useCallback((key: string, patch: Partial<Omit<CartLine, 'key' | 'product'>>) => {
    setCart((c) => ({
      ...c,
      lines: c.lines
        .map((l) => {
          if (l.key !== key) return l;
          const next = { ...l, ...patch };
          // Korting nooit hoger dan het regelbedrag
          next.lineDiscountCents = Math.min(next.lineDiscountCents, next.quantity * next.unitPriceInclCents);
          return next;
        })
        .filter((l) => l.quantity > 0),
    }));
  }, []);

  const remove = useCallback((key: string) => setCart((c) => ({ ...c, lines: c.lines.filter((l) => l.key !== key) })), []);
  const setDiscount = useCallback((discount: OrderDiscount) => setCart((c) => ({ ...c, discount })), []);
  const setNote = useCallback((note: string) => setCart((c) => ({ ...c, note })), []);
  const clear = useCallback(() => setCart(empty()), []);

  const load = useCallback(
    (
      order: {
        id: string;
        note: string | null;
        label: string | null;
        discount: OrderDiscount;
        lines: { productId: string; quantity: number; unitPriceInclCents: number; lineDiscountCents: number; note: string | null }[];
      },
      products: PosProduct[],
    ) => {
      const byId = new Map(products.map((p) => [p.id, p]));
      const lines: CartLine[] = [];
      for (const l of order.lines) {
        const product = byId.get(l.productId);
        if (!product) continue; // product inmiddels uitgeschakeld
        lines.push({ key: lineKey(), product, quantity: l.quantity, unitPriceInclCents: product.openPrice ? l.unitPriceInclCents : product.priceInclCents, lineDiscountCents: l.lineDiscountCents, note: l.note });
      }
      setCart({ orderId: order.id, lines, discount: order.discount, note: order.note ?? '', label: order.label ?? '' });
      return lines.length !== order.lines.length;
    },
    [],
  );

  const setOrderId = useCallback((orderId: string | null) => setCart((c) => ({ ...c, orderId })), []);

  const { calc, error } = useMemo((): { calc: CalculatedOrder | null; error: string | null } => {
    try {
      return {
        calc: calculateOrder(
          cart.lines.map((l) => ({
            productId: l.product.id,
            description: l.product.name,
            quantity: l.quantity,
            unitPriceInclCents: l.unitPriceInclCents,
            vatCode: l.product.vatCode,
            vatRateBp: l.product.vatRateBp,
            revenueAccountCode: l.product.revenueAccountCode,
            vatAccountCode: l.product.vatAccountCode,
            lineDiscountCents: l.lineDiscountCents,
            note: l.note,
          })),
          cart.discount,
        ),
        error: null,
      };
    } catch (err) {
      return { calc: null, error: err instanceof Error ? err.message : String(err) };
    }
  }, [cart]);

  const toRequest = useCallback(
    (): CartRequest => ({
      lines: cart.lines.map((l) => ({
        productId: l.product.id,
        quantity: l.quantity,
        unitPriceInclCents: l.product.openPrice ? l.unitPriceInclCents : undefined,
        lineDiscountCents: l.lineDiscountCents,
        note: l.note,
      })),
      discount: cart.discount,
      note: cart.note || null,
    }),
    [cart],
  );

  return { cart, calc, error, add, update, remove, setDiscount, setNote, clear, load, setOrderId, toRequest };
}

export type Cart = ReturnType<typeof useCart>;
