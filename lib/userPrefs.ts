"use client";
/**
 * Cross-device My Names state (the accounts unshelving, 2026-08) — the three per-browser values
 * that made phone and desktop disagree, graduated to the account when signed in:
 *   - myNames.lastSeen  → user_prefs.last_seen  (the ledger's "since you last looked" cursor)
 *   - myNames.pushTopic → user_prefs.push_topic (the ntfy topic the evaluator sends to)
 *   - tape.portfolio.positions → user_prefs.book_text (the pasted Prism book)
 *
 * Merge doctrine (mirrors the watchlist's local→cloud merge): on first sign-in, any LOCAL value
 * fills an EMPTY cloud column; thereafter the cloud is authoritative and every write goes through
 * BOTH (cloud + localStorage), so signing out degrades gracefully to the same values. Pure merge
 * logic exported for tests. All best-effort: a Supabase hiccup falls back to localStorage silently.
 */
import { browserSupabase } from "./supabase/client";

export interface UserPrefs {
  last_seen: string | null;
  push_topic: string | null;
  book_text: string | null;
}

/** Pure: given local + cloud, what should the app USE, and what (if anything) should upload to
 *  fill empty cloud columns? Cloud wins wherever it has a value; local only ever fills gaps. */
export function mergePrefs(local: UserPrefs, cloud: UserPrefs | null): { use: UserPrefs; upload: Partial<UserPrefs> | null } {
  if (!cloud) return { use: local, upload: hasAny(local) ? local : null };
  const use: UserPrefs = {
    last_seen: cloud.last_seen ?? local.last_seen,
    push_topic: cloud.push_topic ?? local.push_topic,
    book_text: cloud.book_text ?? local.book_text,
  };
  const upload: Partial<UserPrefs> = {};
  if (!cloud.last_seen && local.last_seen) upload.last_seen = local.last_seen;
  if (!cloud.push_topic && local.push_topic) upload.push_topic = local.push_topic;
  if (!cloud.book_text && local.book_text) upload.book_text = local.book_text;
  return { use, upload: Object.keys(upload).length ? upload : null };
}
const hasAny = (p: UserPrefs) => !!(p.last_seen || p.push_topic || p.book_text);

export function readLocalPrefs(): UserPrefs {
  const g = (k: string) => { try { return window.localStorage.getItem(k); } catch { return null; } };
  return { last_seen: g("myNames.lastSeen"), push_topic: g("myNames.pushTopic"), book_text: g("tape.portfolio.positions") };
}

export function writeLocalPrefs(p: Partial<UserPrefs>): void {
  const s = (k: string, v: string | null | undefined) => { if (v != null) try { window.localStorage.setItem(k, v); } catch { /* ignore */ } };
  s("myNames.lastSeen", p.last_seen);
  s("myNames.pushTopic", p.push_topic);
  s("tape.portfolio.positions", p.book_text);
}

/** Load cloud prefs (null when signed out / not configured / error). */
export async function loadCloudPrefs(): Promise<UserPrefs | null> {
  const sb = browserSupabase();
  if (!sb) return null;
  try {
    const { data: u } = await sb.auth.getUser();
    if (!u.user) return null;
    const { data } = await sb.from("user_prefs").select("last_seen,push_topic,book_text").maybeSingle();
    return data ? { last_seen: data.last_seen, push_topic: data.push_topic, book_text: data.book_text } : { last_seen: null, push_topic: null, book_text: null };
  } catch { return null; }
}

/** Upsert selected columns for the signed-in user. Silent no-op when signed out. */
export async function saveCloudPrefs(p: Partial<UserPrefs>): Promise<void> {
  const sb = browserSupabase();
  if (!sb || !Object.keys(p).length) return;
  try {
    const { data: u } = await sb.auth.getUser();
    if (!u.user) return;
    await sb.from("user_prefs").upsert({ user_id: u.user.id, ...p, updated_at: new Date().toISOString() });
  } catch { /* localStorage remains the fallback */ }
}

/** The sign-in sync: merge local↔cloud per the doctrine, persist both sides, return what to use. */
export async function syncPrefs(): Promise<UserPrefs> {
  const local = readLocalPrefs();
  const cloud = await loadCloudPrefs();
  const { use, upload } = mergePrefs(local, cloud);
  if (cloud && upload) await saveCloudPrefs(upload);
  writeLocalPrefs(use);
  return use;
}

// Debounced book upload — the cockpit/radar textareas save per keystroke; the cloud gets the
// settled value 2s after typing stops.
let bookTimer: ReturnType<typeof setTimeout> | null = null;
export function saveBookDebounced(text: string): void {
  if (bookTimer) clearTimeout(bookTimer);
  bookTimer = setTimeout(() => { void saveCloudPrefs({ book_text: text }); }, 2000);
}
