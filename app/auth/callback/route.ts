/**
 * Magic-link redirect target — exchanges the ?code for a session cookie, then returns the user to
 * where they started. The return-path arrives via the short-lived "tape-next" cookie set by
 * AccountMenu (not a ?next= query param: Supabase validates the redirect URL against its allowlist
 * INCLUDING the query string, and an unmatched redirect silently falls back to the Site URL).
 * Allowlist needs only the bare URL:  https://<your-domain>/auth/callback
 *
 * Redirects are RELATIVE Location headers, never absolute: behind the tunnel + slot proxy the
 * server sees Host "localhost:3000", so any origin computed from request.url mints
 * https://localhost:3000/... (2026-08-09: sign-in completed, then bounced the user onto their own
 * dev port). The browser resolves a relative Location against the URL it actually loaded.
 */
import { NextResponse, type NextRequest } from "next/server";
import { serverSupabase } from "@/lib/supabase/server";

function redirectTo(path: string): NextResponse {
  const res = new NextResponse(null, { status: 303, headers: { Location: path } });
  res.cookies.delete("tape-next");
  return res;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  let next = request.cookies.get("tape-next")?.value || searchParams.get("next") || "/";
  try { next = decodeURIComponent(next); } catch { next = "/"; }
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/"; // don't open-redirect off-site

  if (code) {
    const supabase = await serverSupabase();
    const error = supabase ? (await supabase.auth.exchangeCodeForSession(code)).error : new Error("auth off");
    return redirectTo(error ? "/?auth_error=1" : safeNext);
  }
  return redirectTo("/?auth_error=1");
}
