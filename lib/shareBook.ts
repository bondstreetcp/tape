/**
 * Shareable book links for the Portfolio Cockpit — encode the positions + account equity into a URL-safe
 * blob so a user can share their read without any backend. Stored in the URL HASH (never sent to the
 * server), base64url of {t: text, a: aum}. Pure → unit-tested (tests/shareBook.test.ts).
 */

export function encodeBook(text: string, aum: string): string {
  const json = JSON.stringify({ t: text, a: aum });
  return btoa(encodeURIComponent(json)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeBook(encoded: string): { text: string; aum: string } | null {
  try {
    const b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const o = JSON.parse(decodeURIComponent(atob(b64)));
    if (typeof o?.t !== "string") return null;
    return { text: o.t, aum: typeof o.a === "string" ? o.a : "" };
  } catch {
    return null;
  }
}
