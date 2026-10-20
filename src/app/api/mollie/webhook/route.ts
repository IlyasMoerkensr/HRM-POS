import { NextResponse } from 'next/server';

import { mollieErrorMessage, syncMolliePayment } from '@/lib/mollie/mollieService';

/**
 * Mollie-webhook. Alleen actief als PUBLIC_BASE_URL een publiek https-adres is.
 * Mollie stuurt alleen `id=tr_xxx`; de echte status halen we zelf op.
 * Onbekende ID's krijgen ook 200 (zo lekt er geen informatie).
 * Bij een fout 500 → Mollie probeert het later opnieuw.
 */
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const id = form?.get('id');
  if (typeof id !== 'string' || !id.startsWith('tr_')) {
    return new NextResponse(null, { status: 200 });
  }
  try {
    await syncMolliePayment(id);
    return new NextResponse(null, { status: 200 });
  } catch (err) {
    console.error('[mollie-webhook]', id, mollieErrorMessage(err));
    return new NextResponse(null, { status: 500 });
  }
}
