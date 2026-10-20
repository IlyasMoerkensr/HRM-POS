import { NextResponse } from 'next/server';

import { mollieErrorMessage, refreshPaymentStatus } from '@/lib/mollie/mollieService';

/**
 * Polling vanaf kassascherm of telefoon: GET /api/payments/{id}/status
 * TODO stap 2: afschermen met de medewerker-sessie.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return NextResponse.json(await refreshPaymentStatus(id));
  } catch (err) {
    return NextResponse.json({ error: mollieErrorMessage(err) }, { status: 502 });
  }
}
