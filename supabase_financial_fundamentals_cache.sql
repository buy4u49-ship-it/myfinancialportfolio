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
  roa_pct numeric,
  net_margin_pct numeric,
  operating_margin_pct numeric,
  revenue_growth_pct numeric,
  operating_income_growth_pct numeric,
  earnings_growth_pct numeric,
  revenue numeric,
  operating_income numeric,
  net_income numeric,
  total_assets numeric,
  average_assets numeric,
  total_equity numeric,
  average_equity numeric,
  market_cap numeric,
  shares_outstanding numeric,
  book_value_per_share numeric,
  ebitda numeric,
  total_debt numeric,
  cash_and_short_investments numeric,
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

create index if not exists financial_fundamentals_cache_sector_idx
  on public.financial_fundamentals_cache (market, sector);

alter table public.financial_fundamentals_cache
  add column if not exists roa_pct numeric,
  add column if not exists net_margin_pct numeric,
  add column if not exists operating_margin_pct numeric,
  add column if not exists revenue_growth_pct numeric,
  add column if not exists operating_income_growth_pct numeric,
  add column if not exists earnings_growth_pct numeric,
  add column if not exists revenue numeric,
  add column if not exists operating_income numeric,
  add column if not exists total_assets numeric,
  add column if not exists average_assets numeric,
  add column if not exists total_equity numeric,
  add column if not exists market_cap numeric,
  add column if not exists shares_outstanding numeric,
  add column if not exists book_value_per_share numeric,
  add column if not exists ebitda numeric,
  add column if not exists total_debt numeric,
  add column if not exists cash_and_short_investments numeric;

alter table public.financial_fundamentals_cache enable row level security;
