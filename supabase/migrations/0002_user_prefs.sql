-- Tape — cross-device My Names state (2026-08, the accounts unshelving).
-- The monitoring loop's per-browser state graduates to the account: the "since you last looked"
-- cursor (the ledger's NEW badges), the ntfy push topic, and the pasted book — so phone and
-- desktop stop disagreeing about what's new. localStorage remains the signed-out fallback.
-- Safe to re-run (IF NOT EXISTS + drop/recreate policies), same conventions as 0001.

create table if not exists public.user_prefs (
  user_id    uuid primary key references auth.users on delete cascade default auth.uid(),
  -- the My Names "since you last looked" cursor (ledger NEW badges + the header count)
  last_seen  timestamptz,
  -- the per-user ntfy topic the push evaluator sends to
  push_topic text,
  -- the pasted Prism book (raw text, parsed client-side by lib/portfolio.parsePositions)
  book_text  text,
  updated_at timestamptz not null default now()
);

alter table public.user_prefs enable row level security;
drop policy if exists "user_prefs_own" on public.user_prefs;
create policy "user_prefs_own" on public.user_prefs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
