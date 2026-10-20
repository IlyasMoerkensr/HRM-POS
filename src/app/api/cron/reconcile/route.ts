import { NextResponse } from 'next/server';

import { runDailyReconciliation } from '@/lib/mollie/mollieService';

/**
 * Automatische dagcontrole kassa ↔ Mollie.
 * Aanroepen met header `Authorization: Bearer <CRON_SECRET>`, bijv. via
 * Windows Taakplanner (curl) of Vercel Cron.
 */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Niet toegestaan' }, { status: 401 });
  }
  const results = await runDailyReconciliation();
  return NextResponse.json(
    results.map((r) => ({
      date: r.date,
      status: r.status,
      posTotalCents: r.posTotalCents,
      mollieTotalCents: r.mollieTotalCents,
      differenceCents: r.differenceCents,
      issues: r.issues.length,
      error: r.errorMessage,
    })),
  );
}
