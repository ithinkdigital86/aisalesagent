// lib/supabase/middleware.ts
//
// Refreshes the Supabase auth session on every request and guards the app.
// Unauthenticated visitors are sent to /login; a signed-in visitor on /login
// is sent to the app. This runs in the edge middleware, so it uses the anon
// key only. The service role key never appears here.

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// Prefixes an unauthenticated visitor is allowed to reach.
//
// /api/unsubscribe is public by necessity: the recipient of an outbound email
// has no session, so guarding it would redirect every unsubscribe click to the
// login page and silently break the one-click control mail clients render from
// the List-Unsubscribe headers. It authenticates the caller itself, with the
// HMAC-signed token in the query string, and does nothing without a valid one.
const PUBLIC_PREFIXES = ['/login', '/auth', '/api/unsubscribe'];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Do not run other code between creating the client and getUser: this call is
  // what refreshes the token and rewrites the auth cookies onto the response.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  if (user && pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  return response;
}
