/**
 * Magic-link redirect target — exchanges the ?code for a session cookie, then returns the user to
 * where they started. The return-path arrives via the short-lived "tape-next" cookie set by
 * AccountMenu (not a ?next= query param: Supabase validates the redirect URL against its allowlist
 * INCLUDING the query string, and an unmatched redirect silently falls back to the Site URL).
 * Allowlist needs only the bare URL:  https://<your-domain>/auth/callback
 */
import { NextResponse, type NextRequest } from "next/server";
import { serverSupabase } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  let next = request.cookies.get("tape-next")?.value || searchParams.get("next") || "/";
  try { next = decodeURIComponent(next); } catch { next = "/"; }
  const safeNext = next.startsWith("/") ? next : "/"; // don't open-redirect off-site

  let res: NextResponse;
  if (code) {
    const supabase = await serverSupabase();
    const error = supabase ? (await supabase.auth.exchangeCodeForSession(code)).error : new Error("auth off");
    res = error ? NextResponse.redirect(`${origin}/?auth_error=1`) : NextResponse.redirect(`${origin}${safeNext}`);
  } else {
    res = NextResponse.redirect(`${origin}/?auth_error=1`);
  }
  res.cookies.delete("tape-next");
  return res;
}
