import { NextResponse, type NextRequest } from 'next/server';

import { isRemoteRequest } from '@/lib/auth/network';

/**
 * Op afstand (via internet/tunnel) zijn alleen inloggen, beheer, rapporten en
 * export bereikbaar. Kassa, telefoonweergave en koppelen werken alleen op het
 * eigen netwerk. (De acties zelf controleren dit ook nog eens.)
 */
const REMOTE_ALLOWED = [/^\/login(\/|$)/, /^\/beheer(\/|$)/, /^\/rapporten(\/|$)/, /^\/export(\/|$)/, /^\/api\/export(\/|$)/, /^\/api\/mollie\/webhook$/, /^\/api\/products\/[^/]+\/image$/];

export function proxy(request: NextRequest) {
  if (!isRemoteRequest(request.headers)) return NextResponse.next();
  const path = request.nextUrl.pathname;
  if (path === '/') return NextResponse.redirect(new URL('/login', request.url));
  if (REMOTE_ALLOWED.some((r) => r.test(path))) return NextResponse.next();
  return new NextResponse(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Niet op afstand</title>' +
      '<body style="font-family:system-ui;padding:2rem;max-width:36rem;margin:auto"><h1>Alleen in de zaak</h1>' +
      '<p>De kassa en de telefoonweergave werken alleen op het netwerk van de zaak.</p>' +
      '<p><a href="/login">Inloggen voor beheer, Z-rapporten en export</a></p></body>',
    { status: 403, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
