create table if not exists public.financial_statement_cache (
  symbol text primary key,
  cache_date date not null,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists financial_statement_cache_date_idx
  on public.financial_statement_cache (cache_date desc);

alter table public.financial_statement_cache enable row level security;
