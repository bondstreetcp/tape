/**
 * OAuth redirect target — exchanges the ?code for a session cookie, then returns the user to where
 * they started (?next). Add this URL to Supabase → Auth → URL Configuration → Redirect URLs:
 *   http://localhost:3000/auth/callback  and  https://<your-domain>/auth/callback
 */
import { NextResponse, type NextRequest } from "next/server";
import { serverSupabase } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") || "/";
  const safeNext = next.startsWith("/") ? next : "/"; // don't open-redirect off-site

  if (code) {
    const supabase = await serverSupabase();
    if (supabase) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) return NextResponse.redirect(`${origin}${safeNext}`);
    }
  }
  return NextResponse.redirect(`${origin}/?auth_error=1`);
}
