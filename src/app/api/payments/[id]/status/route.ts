import { NextResponse } from 'next/server';

import { AuthError, requireAnyActor } from '@/lib/auth/session';
import { mollieErrorMessage, refreshPaymentStatus } from '@/lib/mollie/mollieService';

/** Polling vanaf kassascherm of telefoon: GET /api/payments/{id}/status */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await requireAnyActor();
    return NextResponse.json(await refreshPaymentStatus(id), { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    return NextResponse.json({ error: mollieErrorMessage(err) }, { status: 502 });
  }
}
