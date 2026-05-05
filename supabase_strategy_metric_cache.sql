create table if not exists public.strategy_metric_cache (
  symbol text not null,
  market text not null check (market in ('us', 'korea', 'crypto')),
  name text not null default '',
  sector text not null default '',
  industry text not null default '',
  price numeric,
  change_pct numeric,
  metrics jsonb not null default '{}'::jsonb,
  source text not null default 'symbol_detail',
  refreshed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (symbol, market)
);

create index if not exists strategy_metric_cache_market_refreshed_idx
  on public.strategy_metric_cache (market, refreshed_at desc);

create index if not exists strategy_metric_cache_metrics_gin_idx
  on public.strategy_metric_cache using gin (metrics);

alter table public.strategy_metric_cache enable row level security;
