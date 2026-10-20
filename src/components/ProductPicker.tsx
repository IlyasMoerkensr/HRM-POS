'use client';

import { useMemo, useState } from 'react';

import { formatEUR } from '@/lib/money';
import type { PosCategory, PosProduct } from '@/lib/types';

import { cx, textOn } from './ui';

const FAVORITES = '__favorieten';

/** Productkeuze zonder barcodescanner: favorieten, categorieën en zoeken. */
export function ProductPicker({
  products,
  categories,
  onPick,
  compact,
}: {
  products: PosProduct[];
  categories: PosCategory[];
  onPick: (product: PosProduct) => void;
  compact?: boolean;
}) {
  const hasFavorites = products.some((p) => p.favorite);
  const [tab, setTab] = useState<string>(hasFavorites ? FAVORITES : categories[0]?.id ?? '');
  const [query, setQuery] = useState('');

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q) {
      return products.filter((p) =>
        [p.name, p.shortName, p.sku].some((v) => v?.toLowerCase().includes(q)),
      );
    }
    if (tab === FAVORITES) return products.filter((p) => p.favorite);
    if (tab === '') return products;
    return products.filter((p) => p.categoryId === tab);
  }, [products, tab, query]);

  const catColor = new Map(categories.map((c) => [c.id, c.color]));

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="relative">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Zoek product of artikelcode…"
          className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-lg outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
        />
        {query && (
          <button type="button" onClick={() => setQuery('')} className="absolute top-1/2 right-3 -translate-y-1/2 px-2 text-2xl text-slate-400" aria-label="Wissen">
            ×
          </button>
        )}
      </div>

      {!query && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {hasFavorites && (
            <Tab active={tab === FAVORITES} color="#eab308" onClick={() => setTab(FAVORITES)}>
              ★ Favorieten
            </Tab>
          )}
          {categories.map((c) => (
            <Tab key={c.id} active={tab === c.id} color={c.color} onClick={() => setTab(c.id)}>
              {c.name}
            </Tab>
          ))}
          <Tab active={tab === ''} color="#64748b" onClick={() => setTab('')}>
            Alles
          </Tab>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <p className="py-10 text-center text-slate-500">Geen producten gevonden</p>
        ) : (
          <div className={cx('grid gap-2', compact ? 'grid-cols-2' : 'grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))]')}>
            {visible.map((p) => {
              const color = p.color ?? (p.categoryId ? catColor.get(p.categoryId) : undefined) ?? '#64748b';
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onPick(p)}
                  className="flex min-h-24 flex-col justify-between rounded-xl bg-white p-3 text-left shadow-sm ring-1 ring-slate-200 transition active:scale-[0.97] active:bg-slate-50"
                  style={{ borderTop: `5px solid ${color}` }}
                >
                  <span className="line-clamp-2 font-semibold leading-tight">{p.shortName || p.name}</span>
                  <span className="tabular mt-2 text-sm text-slate-600">{p.openPrice ? 'Vrij bedrag' : formatEUR(p.priceInclCents)}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Tab({ active, color, onClick, children }: { active: boolean; color: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx('shrink-0 rounded-full px-4 py-2 font-semibold whitespace-nowrap transition', active ? 'shadow' : 'bg-white text-slate-700 ring-1 ring-slate-200')}
      style={active ? { backgroundColor: color, color: textOn(color) } : undefined}
    >
      {children}
    </button>
  );
}
