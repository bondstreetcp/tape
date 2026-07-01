# Accounts, persistence & alerts — setup

Everything ships **inert** until you complete the steps below: with the two `NEXT_PUBLIC_*` vars unset,
`supabaseEnabled` is false and the app runs exactly as before (anonymous, localStorage watchlist, no
account menu / bell). Once configured, sign-in appears, watchlists + saved screens persist per-user,
and alert rules fire into the header bell.

Reuse the **same Supabase project** as the Research Desk. You'll do all of this once; Claude can't
enter credentials into dashboards.

## 1. Run the database migration
Supabase Dashboard → **SQL** → New query → paste all of `supabase/migrations/0001_user_data.sql` → **Run**.
Creates `watchlist`, `saved_screens`, `alert_rules`, `alert_events`, all with Row-Level Security
(each row private to its owner). Safe to re-run.

## 2. Google OAuth
1. **Google Cloud Console** → APIs & Services → Credentials → **Create OAuth client ID** → *Web application*.
2. Under **Authorized redirect URIs** add: `https://<your-project-ref>.supabase.co/auth/v1/callback`
   (copy the exact value from Supabase → Auth → Providers → Google — it's shown there).
3. Copy the **Client ID** and **Client secret**.
4. Supabase → **Auth → Providers → Google** → enable → paste the Client ID + secret → save.

## 3. Auth redirect URLs
Supabase → **Auth → URL Configuration**:
- **Site URL:** your production URL (e.g. `https://tape.vercel.app`).
- **Redirect URLs** (add both): `https://<your-domain>/auth/callback` and `http://localhost:3000/auth/callback`.

## 4. Env vars
Add to **Vercel** (Project → Settings → Environment Variables) and your local `.env.local`:

| Var | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | same as your existing `SUPABASE_URL` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API → **anon / publishable** key (NOT the secret) |

The `anon` key is safe to expose (RLS enforces per-user access). Your `SUPABASE_SECRET_KEY` stays
server-only. Redeploy Vercel after adding them.

## 5. Alert evaluator (GitHub Actions)
The evaluator (`scripts/eval-alerts.ts`) runs inside the existing data-refresh workflow (every
intraday tick for price alerts + the nightly FULL run for the rest). It needs the DB connection as a
repo secret:

GitHub → repo → Settings → Secrets and variables → Actions → **New repository secret**:
- `RESEARCH_DATABASE_URL` = the exact same value already set on Vercel for the Research Desk (the Supabase Postgres connection string).

If unset, the alert step no-ops cleanly (no error); everything else keeps working.

## How it works
- **Auth:** Supabase Auth (Google), `@supabase/ssr`. `proxy.ts` refreshes the session cookie.
- **Persistence:** `useWatchlist` / `useSavedScreens` read+write Postgres under RLS when signed in,
  localStorage when not; local data merges up on first login.
- **Alerts:** create rules on `/u/<universe>/alerts` or the **＋ Alert** button on a stock page
  (price level/%, new filing/campaign/insider on a watched name, N days pre-earnings, or a signal:
  cheap-vs-10yr / RS-breakout / short-squeeze). The evaluator checks them against the data Tape
  already collects and writes deduped rows to `alert_events`; the header **bell** shows unread.
