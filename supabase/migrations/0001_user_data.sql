-- Tape — user accounts, persistence, and alerts.
-- Run ONCE in the Supabase SQL editor (Dashboard → SQL → New query → paste → Run).
-- Safe to re-run: tables use IF NOT EXISTS and policies are dropped/recreated.
--
-- Auth is Supabase's built-in auth.users (Google OAuth). Each table below is private to its owner
-- via Row-Level Security; user_id defaults to auth.uid() so the app never sends it. The alert
-- evaluator connects with the service key (RESEARCH_DATABASE_URL / service role), which bypasses
-- RLS, so it can write alert_events for any user.

-- 1) Watchlist — one row per (user, symbol).
create table if not exists public.watchlist (
  user_id    uuid not null references auth.users on delete cascade default auth.uid(),
  symbol     text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, symbol)
);

-- 2) Saved natural-language screens.
create table if not exists public.saved_screens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade default auth.uid(),
  name       text not null,
  query      text not null default '',
  spec       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists saved_screens_user_idx on public.saved_screens (user_id, created_at desc);

-- 3) Alert rules. kind ∈ price | event | earnings | signal; symbol null = applies to whole watchlist.
create table if not exists public.alert_rules (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade default auth.uid(),
  symbol     text,
  kind       text not null check (kind in ('price','event','earnings','signal')),
  params     jsonb not null default '{}'::jsonb,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists alert_rules_user_idx on public.alert_rules (user_id);
create index if not exists alert_rules_active_idx on public.alert_rules (active) where active;

-- 4) Fired alerts (the in-app feed). dedup_key makes the evaluator idempotent (fire each thing once).
create table if not exists public.alert_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade default auth.uid(),
  rule_id    uuid references public.alert_rules on delete set null,
  symbol     text,
  kind       text not null,
  title      text not null,
  body       text,
  href       text,
  dedup_key  text not null,
  fired_at   timestamptz not null default now(),
  read_at    timestamptz,
  unique (user_id, dedup_key)
);
create index if not exists alert_events_feed_idx on public.alert_events (user_id, fired_at desc);
create index if not exists alert_events_unread_idx on public.alert_events (user_id) where read_at is null;

-- ── Row-Level Security: every row private to its owner ─────────────────────────────────
alter table public.watchlist     enable row level security;
alter table public.saved_screens enable row level security;
alter table public.alert_rules   enable row level security;
alter table public.alert_events  enable row level security;

do $$
declare t text;
begin
  foreach t in array array['watchlist','saved_screens','alert_rules','alert_events'] loop
    execute format('drop policy if exists own_rows on public.%I', t);
    execute format(
      'create policy own_rows on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t);
  end loop;
end $$;
