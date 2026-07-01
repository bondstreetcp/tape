/**
 * Refreshes the Supabase auth session cookie on navigation so Server Components see a valid user.
 * (Next 16's rename of the old `middleware` convention.) No-op passthrough until Supabase is
 * configured (NEXT_PUBLIC_ vars unset) — keeps the app fully functional pre-auth.
 */
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export async function proxy(request: NextRequest) {
  if (!URL || !ANON) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(URL, ANON, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // Touch getUser() to rotate the refresh token into the response cookies. Do not gate routes here.
  await supabase.auth.getUser();
  return response;
}

export const config = {
  // Exclude /api (public data routes that don't read the session — no need to pay a getUser()
  // round-trip per poll), static assets, the service worker, and the manifest.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
