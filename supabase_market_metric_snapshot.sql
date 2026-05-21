create table if not exists public.market_metric_snapshot (
  symbol text not null,
  market text not null check (market in ('us', 'korea', 'crypto')),
  name text not null default '',
  sector text not null default '',
  industry text not null default '',
  price numeric,
  change_pct numeric,
  volume_1m numeric,
  trading_value_1m numeric,
  metrics jsonb not null default '{}'::jsonb,
  metric_timeframe text not null default '1m',
  price_refreshed_at timestamptz,
  volume_refreshed_at timestamptz,
  technical_refreshed_at timestamptz,
  fundamental_refreshed_at timestamptz,
  aggregate_refreshed_at timestamptz,
  refreshed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (symbol, market)
);

create index if not exists market_metric_snapshot_market_symbol_idx
  on public.market_metric_snapshot (market, symbol);

create index if not exists market_metric_snapshot_market_sector_idx
  on public.market_metric_snapshot (market, sector);

create index if not exists market_metric_snapshot_market_industry_idx
  on public.market_metric_snapshot (market, industry);

create index if not exists market_metric_snapshot_refreshed_idx
  on public.market_metric_snapshot (market, refreshed_at desc);

create index if not exists market_metric_snapshot_metrics_gin_idx
  on public.market_metric_snapshot using gin (metrics);

alter table public.market_metric_snapshot
  add column if not exists volume_1m numeric,
  add column if not exists trading_value_1m numeric,
  add column if not exists metric_timeframe text not null default '1m',
  add column if not exists price_refreshed_at timestamptz,
  add column if not exists volume_refreshed_at timestamptz,
  add column if not exists technical_refreshed_at timestamptz,
  add column if not exists fundamental_refreshed_at timestamptz,
  add column if not exists aggregate_refreshed_at timestamptz;

create table if not exists public.market_metric_update_policy (
  metric_group text primary key,
  refresh_interval interval not null,
  description text not null default '',
  updated_at timestamptz not null default now()
);

insert into public.market_metric_update_policy (metric_group, refresh_interval, description)
values
  ('fast_price', interval '1 minute', 'Price, change, PER/PBR/EV multiples, and 1-minute volume-derived indicators.'),
  ('technical_1m', interval '1 minute', '1-minute candle technical indicators. The timeframe can be expanded later.'),
  ('financial_fundamental', interval '31 days', 'Statement-derived EPS, ROE, ROA, margins, and growth metrics.'),
  ('peer_aggregate', interval '1 minute', 'Sector and industry aggregate values that depend on current price, plus cached financial aggregates.')
on conflict (metric_group) do update
set refresh_interval = excluded.refresh_interval,
    description = excluded.description,
    updated_at = now();

create or replace function public.metric_numeric(value text)
returns numeric
language plpgsql
immutable
as $$
begin
  if value is null or btrim(value) = '' then
    return null;
  end if;
  return value::numeric;
exception when others then
  return null;
end;
$$;

create or replace function public.strategy_metric_value(
  row_price numeric,
  row_change_pct numeric,
  row_volume_1m numeric,
  row_trading_value_1m numeric,
  row_metrics jsonb,
  metric_key text
)
returns numeric
language sql
stable
as $$
  select case metric_key
    when 'price' then row_price
    when 'changePct' then row_change_pct
    when 'volume1m' then row_volume_1m
    when 'tradingValue1m' then row_trading_value_1m
    else public.metric_numeric(row_metrics ->> metric_key)
  end;
$$;

create or replace function public.strategy_condition_pass(
  row_price numeric,
  row_change_pct numeric,
  row_volume_1m numeric,
  row_trading_value_1m numeric,
  row_metrics jsonb,
  condition jsonb
)
returns boolean
language plpgsql
stable
as $$
declare
  left_value numeric;
  right_value numeric;
  operator_text text;
  right_operand jsonb;
begin
  left_value := public.strategy_metric_value(
    row_price,
    row_change_pct,
    row_volume_1m,
    row_trading_value_1m,
    row_metrics,
    condition ->> 'leftMetric'
  );
  operator_text := condition ->> 'operator';
  right_operand := condition -> 'right';

  if right_operand ->> 'type' = 'number' then
    right_value := public.metric_numeric(right_operand ->> 'value');
  else
    right_value := public.strategy_metric_value(
      row_price,
      row_change_pct,
      row_volume_1m,
      row_trading_value_1m,
      row_metrics,
      right_operand ->> 'metric'
    );
  end if;

  if left_value is null or right_value is null then
    return false;
  end if;

  if operator_text = '<' then
    return left_value < right_value;
  elsif operator_text = '<=' then
    return left_value <= right_value;
  elsif operator_text = '>' then
    return left_value > right_value;
  elsif operator_text = '>=' then
    return left_value >= right_value;
  elsif operator_text = '=' then
    return abs(left_value - right_value) <= greatest(0.000001, abs(right_value) * 0.000001);
  end if;

  return false;
end;
$$;

create or replace function public.screen_market_metric_snapshot(
  p_markets text[],
  p_sectors text[] default array[]::text[],
  p_conditions jsonb default '[]'::jsonb,
  p_offset integer default 0,
  p_limit integer default 500
)
returns table (
  symbol text,
  market text,
  name text,
  sector text,
  industry text,
  price numeric,
  change_pct numeric,
  volume_1m numeric,
  trading_value_1m numeric,
  metrics jsonb,
  refreshed_at timestamptz,
  filtered_count bigint
)
language sql
stable
as $$
  with candidates as (
    select *
    from public.market_metric_snapshot m
    where (coalesce(array_length(p_markets, 1), 0) = 0 or m.market = any(p_markets))
      and (
        coalesce(array_length(p_sectors, 1), 0) = 0
        or m.market = 'crypto'
        or m.sector = any(p_sectors)
      )
  ),
  matched as (
    select c.*
    from candidates c
    where not exists (
      select 1
      from jsonb_array_elements(coalesce(p_conditions, '[]'::jsonb)) as condition(value)
      where not public.strategy_condition_pass(
        c.price,
        c.change_pct,
        c.volume_1m,
        c.trading_value_1m,
        c.metrics,
        condition.value
      )
    )
  ),
  counted as (
    select matched.*, count(*) over () as filtered_count
    from matched
  )
  select
    counted.symbol,
    counted.market,
    counted.name,
    counted.sector,
    counted.industry,
    counted.price,
    counted.change_pct,
    counted.volume_1m,
    counted.trading_value_1m,
    counted.metrics,
    counted.refreshed_at,
    counted.filtered_count
  from counted
  order by counted.market, counted.symbol
  offset greatest(coalesce(p_offset, 0), 0)
  limit greatest(1, least(coalesce(p_limit, 500), 5000));
$$;

alter table public.market_metric_snapshot enable row level security;
alter table public.market_metric_update_policy enable row level security;
