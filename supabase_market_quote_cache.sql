create table if not exists public.market_quote_cache (
  symbol text primary key,
  provider_symbol text not null,
  price numeric,
  previous_close numeric,
  change_pct numeric,
  currency text not null default 'KRW',
  exchange text not null default 'Upbit WebSocket',
  source text not null default 'upbit_ws',
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists market_quote_cache_updated_at_idx
on public.market_quote_cache (updated_at desc);

alter table public.market_quote_cache enable row level security;
