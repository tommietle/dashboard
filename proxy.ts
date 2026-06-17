import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';

// Bewaakt het hele dashboard: zonder geldige sessie stuur je naar /login.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const session = verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);

  if (pathname === '/login') {
    // Al ingelogd? Dan hoeft de inlogpagina niet.
    return session
      ? NextResponse.redirect(new URL('/', request.url))
      : NextResponse.next();
  }

  if (!session) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Alles bewaken behalve API-routes en statische bestanden.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|ico|jpg|jpeg)$).*)'],
};
