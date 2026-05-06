alter table public.strategy_metric_cache
  add column if not exists technical_payload jsonb;

create index if not exists strategy_metric_cache_market_symbol_idx
  on public.strategy_metric_cache (market, symbol);
