create table if not exists public.financial_fundamentals_cache (
  symbol text not null,
  market text not null check (market in ('us', 'korea')),
  name text not null default '',
  sector text not null default '',
  industry text not null default '',
  currency text not null default '',
  fiscal_year integer,
  eps numeric,
  roe_pct numeric,
  net_income numeric,
  average_equity numeric,
  price_at_refresh numeric,
  source text not null default 'financial_sources',
  refreshed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (symbol, market)
);

create index if not exists financial_fundamentals_cache_market_refreshed_idx
  on public.financial_fundamentals_cache (market, refreshed_at desc);

create index if not exists financial_fundamentals_cache_industry_idx
  on public.financial_fundamentals_cache (market, industry);

alter table public.financial_fundamentals_cache enable row level security;
