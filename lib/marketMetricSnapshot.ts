import { readFinancialFundamentalsCache } from "./financialFundamentalsCache";
import { getStrategyUniverse, readStrategyMetricCache } from "./strategyMetricCache";
import { normalizeSymbol } from "./symbols";
import { supabaseAdmin } from "./supabaseAdmin";
import type { ChartPoint, FinancialFundamentalSnapshot, StrategyMarket, StrategyMetricKey, StrategyMetricSnapshot } from "./types";

const MARKET_METRIC_SNAPSHOT_TABLE = "market_metric_snapshot";
const MARKET_QUOTE_TABLE = "market_quote_cache";
const MARKET_QUOTE_MAX_AGE_MS = 120_000;
const GROUP_AGGREGATE_MIN_COMPANIES = 5;

type RefreshOptions = {
  markets?: StrategyMarket[];
  limit?: number;
  force?: boolean;
  deadlineMs?: number;
};

type RefreshResult = {
  markets: StrategyMarket[];
  universeCount: number;
  cachedCount: number;
  staleCount: number;
  refreshedCount: number;
  errors: Array<{ symbol: string; market: StrategyMarket; message: string }>;
  refreshedAt: string;
  timeBudgetReached?: boolean;
};

type QuoteCacheRow = {
  symbol?: unknown;
  price?: unknown;
  previous_close?: unknown;
  change_pct?: unknown;
  currency?: unknown;
  exchange?: unknown;
  source?: unknown;
  payload?: unknown;
  updated_at?: unknown;
};

type MarketMetricSnapshot = {
  symbol: string;
  market: StrategyMarket;
  name: string;
  sector: string;
  industry: string;
  price: number | null;
  changePct: number | null;
  volume1m: number | null;
  tradingValue1m: number | null;
  metrics: Partial<Record<StrategyMetricKey, number | null>>;
  metricTimeframe: "1m";
  priceRefreshedAt: string | null;
  volumeRefreshedAt: string | null;
  technicalRefreshedAt: string | null;
  fundamentalRefreshedAt: string | null;
  refreshedAt: string;
  updatedAt: string;
};

type QuoteSnapshot = {
  symbol: string;
  price: number | null;
  previousClose: number | null;
  changePct: number | null;
  volume1m: number | null;
  tradingValue1m: number | null;
  candles1m: ChartPoint[];
  updatedAt: string;
};

type PeerGroupMetrics = {
  avgEps: number | null;
  avgPer: number | null;
  avgRoe: number | null;
  medianPer: number | null;
  medianRoe: number | null;
  epsCount: number;
  perCount: number;
  roeCount: number;
};

type StrategyTechnicalPoint = {
  time: string;
  close: number;
  volume: number | null;
};

type VolumeProfileSummary = {
  vwap: number;
  pointOfControl: number;
  valueAreaHigh: number;
  valueAreaLow: number;
  aboveBelowVolumeRatio: number | null;
  skewPct: number;
};

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function uniqueSorted(symbols: string[]) {
  return Array.from(new Set(symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean))).sort();
}

function finiteNumber(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function positiveNumber(value: unknown) {
  const num = finiteNumber(value);
  return num !== null && num > 0 ? num : null;
}

function nonZeroNumber(value: unknown) {
  const num = finiteNumber(value);
  return num !== null && num !== 0 ? num : null;
}

function pctChange(current: number | null, previous: number | null) {
  if (current === null || previous === null || previous === 0) {
    return null;
  }
  return (current / previous - 1) * 100;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function median(values: Array<number | null | undefined>) {
  const valid = values.filter((value): value is number => value !== null && value !== undefined && Number.isFinite(value)).sort((a, b) => a - b);
  if (!valid.length) {
    return null;
  }
  const middle = Math.floor(valid.length / 2);
  return valid.length % 2 ? valid[middle] : (valid[middle - 1] + valid[middle]) / 2;
}

function movingAverage(values: number[], endExclusive: number, period: number) {
  if (period <= 0 || endExclusive < period) {
    return null;
  }
  return average(values.slice(endExclusive - period, endExclusive));
}

function stddev(values: number[]) {
  const mean = average(values);
  if (mean === null || values.length < 2) {
    return null;
  }
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function ema(values: number[], period: number) {
  if (period <= 0 || values.length < period) {
    return [];
  }
  const multiplier = 2 / (period + 1);
  const output: number[] = [];
  let current = average(values.slice(0, period));
  if (current === null) {
    return [];
  }
  output.push(current);
  for (let index = period; index < values.length; index += 1) {
    current = (values[index] - current) * multiplier + current;
    output.push(current);
  }
  return output;
}

function rsi(values: number[], period: number) {
  if (values.length <= period) {
    return null;
  }
  const window = values.slice(values.length - period - 1);
  let gains = 0;
  let losses = 0;
  for (let index = 1; index < window.length; index += 1) {
    const change = window[index] - window[index - 1];
    if (change >= 0) {
      gains += change;
    } else {
      losses += Math.abs(change);
    }
  }
  const averageGain = gains / period;
  const averageLoss = losses / period;
  if (averageLoss === 0) {
    return 100;
  }
  const rs = averageGain / averageLoss;
  return 100 - 100 / (1 + rs);
}

function chartReturnPct(chart: ChartPoint[]) {
  const closes = chart.map((point) => positiveNumber(point.close)).filter((value): value is number => value !== null);
  if (closes.length < 2 || closes[0] === 0) {
    return null;
  }
  return (closes.at(-1)! / closes[0] - 1) * 100;
}

function chartVolatilityPct(chart: ChartPoint[]) {
  const closes = chart.map((point) => positiveNumber(point.close)).filter((value): value is number => value !== null);
  const returns: number[] = [];
  for (let index = 1; index < closes.length; index += 1) {
    returns.push(closes[index] / closes[index - 1] - 1);
  }
  const mean = average(returns);
  if (mean === null || returns.length < 2) {
    return null;
  }
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * 100;
}

function buildVolumeProfileSummary(points: StrategyTechnicalPoint[], period: number): VolumeProfileSummary | null {
  if (points.length <= period) {
    return null;
  }
  const profilePoints = points
    .slice(-period - 1, -1)
    .filter((point) => point.close > 0 && point.volume !== null && Number.isFinite(point.volume) && point.volume > 0);
  if (!profilePoints.length) {
    return null;
  }
  const totalVolume = profilePoints.reduce((sum, point) => sum + (point.volume || 0), 0);
  if (totalVolume <= 0) {
    return null;
  }
  const vwap = profilePoints.reduce((sum, point) => sum + point.close * (point.volume || 0), 0) / totalVolume;
  if (vwap <= 0) {
    return null;
  }

  const aboveVolume = profilePoints.reduce((sum, point) => (point.close > vwap ? sum + (point.volume || 0) : sum), 0);
  const belowVolume = profilePoints.reduce((sum, point) => (point.close < vwap ? sum + (point.volume || 0) : sum), 0);
  const directionalVolume = aboveVolume + belowVolume;
  const aboveBelowVolumeRatio = belowVolume > 0 ? aboveVolume / belowVolume : aboveVolume > 0 ? null : 1;
  const skewPct = directionalVolume > 0 ? ((aboveVolume - belowVolume) / directionalVolume) * 100 : 0;

  const minClose = Math.min(...profilePoints.map((point) => point.close));
  const maxClose = Math.max(...profilePoints.map((point) => point.close));
  if (minClose <= 0 || maxClose <= 0) {
    return null;
  }
  if (minClose === maxClose) {
    return {
      vwap,
      pointOfControl: minClose,
      valueAreaHigh: minClose,
      valueAreaLow: minClose,
      aboveBelowVolumeRatio,
      skewPct
    };
  }

  const binCount = Math.max(8, Math.min(40, Math.round(Math.sqrt(profilePoints.length) * 2)));
  const binSize = (maxClose - minClose) / binCount;
  const bins = Array.from({ length: binCount }, (_, index) => ({
    low: minClose + index * binSize,
    high: index === binCount - 1 ? maxClose : minClose + (index + 1) * binSize,
    volume: 0,
    weightedClose: 0
  }));

  profilePoints.forEach((point) => {
    const volume = point.volume || 0;
    const binIndex = Math.min(binCount - 1, Math.max(0, Math.floor((point.close - minClose) / binSize)));
    bins[binIndex].volume += volume;
    bins[binIndex].weightedClose += point.close * volume;
  });

  const pointOfControlIndex = bins.reduce((bestIndex, bin, index) => (bin.volume > bins[bestIndex].volume ? index : bestIndex), 0);
  const pointOfControlBin = bins[pointOfControlIndex];
  if (pointOfControlBin.volume <= 0) {
    return null;
  }
  const pointOfControl = pointOfControlBin.weightedClose / pointOfControlBin.volume;
  const targetValueAreaVolume = totalVolume * 0.7;
  let valueAreaVolume = pointOfControlBin.volume;
  let lowIndex = pointOfControlIndex;
  let highIndex = pointOfControlIndex;

  while (valueAreaVolume < targetValueAreaVolume && (lowIndex > 0 || highIndex < bins.length - 1)) {
    const leftVolume = lowIndex > 0 ? bins[lowIndex - 1].volume : -1;
    const rightVolume = highIndex < bins.length - 1 ? bins[highIndex + 1].volume : -1;
    if (rightVolume >= leftVolume) {
      highIndex += 1;
      valueAreaVolume += bins[highIndex].volume;
    } else {
      lowIndex -= 1;
      valueAreaVolume += bins[lowIndex].volume;
    }
  }

  return {
    vwap,
    pointOfControl,
    valueAreaHigh: bins[highIndex].high,
    valueAreaLow: bins[lowIndex].low,
    aboveBelowVolumeRatio,
    skewPct
  };
}

function technicalMetricsFromCandles(candles: ChartPoint[]) {
  const points = candles
    .filter((point) => Number.isFinite(point.close) && point.close > 0)
    .map((point) => ({
      time: point.time,
      close: point.close,
      volume: finiteNumber(point.volume)
    }));
  const closes = points.map((point) => point.close);
  if (!closes.length) {
    return {};
  }
  const metrics: Partial<Record<StrategyMetricKey, number | null>> = {};
  const currentIndex = closes.length;
  const previousIndex = closes.length - 1;

  const currentMa20 = movingAverage(closes, currentIndex, 20);
  const previousMa20 = movingAverage(closes, previousIndex, 20);
  if (currentMa20 !== null && previousMa20 !== null && closes.length >= 2) {
    metrics.movingAverageBreakoutUp = closes.at(-1)! > currentMa20 && closes.at(-2)! <= previousMa20 ? 1 : 0;
    metrics.movingAverageBreakoutDown = closes.at(-1)! < currentMa20 && closes.at(-2)! >= previousMa20 ? 1 : 0;
  }

  const currentShort = movingAverage(closes, currentIndex, 20);
  const currentLong = movingAverage(closes, currentIndex, 60);
  const previousShort = movingAverage(closes, previousIndex, 20);
  const previousLong = movingAverage(closes, previousIndex, 60);
  if (currentShort !== null && currentLong !== null && previousShort !== null && previousLong !== null) {
    metrics.goldenCross = currentShort > currentLong && previousShort <= previousLong ? 1 : 0;
    metrics.deadCross = currentShort < currentLong && previousShort >= previousLong ? 1 : 0;
  }

  const fast = ema(closes, 12);
  const slow = ema(closes, 26);
  const overlap = Math.min(fast.length, slow.length);
  if (overlap >= 9) {
    const fastTail = fast.slice(-overlap);
    const slowTail = slow.slice(-overlap);
    const macd = fastTail.map((value, index) => value - slowTail[index]);
    const signal = ema(macd, 9);
    metrics.macdSignal = signal.length ? macd.at(-1)! - signal.at(-1)! : null;
  }

  metrics.rsi = rsi(closes, 14);

  if (closes.length >= 20) {
    const window = closes.slice(-20);
    const mean = average(window);
    const sigma = stddev(window);
    if (mean !== null && sigma !== null && sigma !== 0) {
      const lower = mean - sigma * 2;
      const upper = mean + sigma * 2;
      metrics.bollingerBandPosition = upper === lower ? null : ((closes.at(-1)! - lower) / (upper - lower)) * 100;
    }
  }

  if (points.length > 20) {
    const previousVolumes = points
      .slice(-21, -1)
      .map((point) => (point.volume !== null && point.volume > 0 ? point.volume : 0))
      .filter((value) => value > 0);
    const avgVolume = average(previousVolumes);
    const currentVolume = points.at(-1)?.volume;
    metrics.volumeSpike =
      currentVolume !== null && currentVolume !== undefined && currentVolume > 0 && avgVolume !== null && avgVolume > 0 ? currentVolume / avgVolume : null;
  }

  const profile = buildVolumeProfileSummary(points, 60);
  if (profile) {
    metrics.vwap = profile.vwap;
    metrics.pointOfControl = profile.pointOfControl;
    metrics.valueAreaHigh = profile.valueAreaHigh;
    metrics.valueAreaLow = profile.valueAreaLow;
    metrics.vwapAboveBelowVolumeRatio = profile.aboveBelowVolumeRatio;
    metrics.volumeProfileSkew = profile.skewPct;
    metrics.volumeProfile = profile.vwap > 0 ? (points.at(-1)!.close / profile.vwap - 1) * 100 : null;
  }

  return metrics;
}

function rowPayload(row: QuoteCacheRow) {
  return row.payload && typeof row.payload === "object" ? (row.payload as Record<string, unknown>) : {};
}

function nestedRecord(input: unknown) {
  return input && typeof input === "object" ? (input as Record<string, unknown>) : {};
}

function quotePayloadCandles(payload: Record<string, unknown>, updatedAt: string, price: number | null) {
  const directResponse = Array.isArray(payload.response) ? payload.response[0] : null;
  const chart = nestedRecord(payload.chart);
  const chartResult = Array.isArray(chart.result) ? chart.result[0] : null;
  const result = nestedRecord(directResponse || chartResult);
  const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
  const indicators = nestedRecord(result.indicators);
  const quotes = Array.isArray(indicators.quote) ? nestedRecord(indicators.quote[0]) : {};
  const closes = Array.isArray(quotes.close) ? quotes.close : [];
  const opens = Array.isArray(quotes.open) ? quotes.open : [];
  const highs = Array.isArray(quotes.high) ? quotes.high : [];
  const lows = Array.isArray(quotes.low) ? quotes.low : [];
  const volumes = Array.isArray(quotes.volume) ? quotes.volume : [];

  const candles = timestamps
    .map((timestamp, index): ChartPoint | null => {
      const close = positiveNumber(closes[index]);
      if (close === null) {
        return null;
      }
      const epoch = Number(timestamp);
      const time = Number.isFinite(epoch) ? new Date(epoch * 1000).toISOString() : updatedAt;
      return {
        time,
        open: positiveNumber(opens[index]),
        high: positiveNumber(highs[index]),
        low: positiveNumber(lows[index]),
        close,
        volume: finiteNumber(volumes[index])
      };
    })
    .filter((point): point is ChartPoint => point !== null);

  if (candles.length || price === null) {
    return candles;
  }
  return [{ time: updatedAt || new Date().toISOString(), close: price, volume: finiteNumber(payload.trade_volume ?? payload.acc_trade_volume) }];
}

function payloadNumber(payload: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = finiteNumber(payload[key]);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

function rowToQuoteSnapshot(row: QuoteCacheRow): QuoteSnapshot | null {
  const symbol = normalizeSymbol(String(row.symbol || ""));
  const updatedAt = String(row.updated_at || "");
  const updatedMs = Date.parse(updatedAt);
  if (!symbol || !Number.isFinite(updatedMs) || Date.now() - updatedMs > MARKET_QUOTE_MAX_AGE_MS) {
    return null;
  }
  const price = positiveNumber(row.price);
  if (price === null) {
    return null;
  }
  const payload = rowPayload(row);
  const candles1m = quotePayloadCandles(payload, updatedAt, price);
  const lastCandle = candles1m.at(-1);
  const volume1m =
    finiteNumber(lastCandle?.volume) ??
    payloadNumber(payload, "trade_volume", "acc_trade_volume", "acc_trade_volume_24h", "volume");
  return {
    symbol,
    price,
    previousClose: positiveNumber(row.previous_close),
    changePct: finiteNumber(row.change_pct) ?? pctChange(price, positiveNumber(row.previous_close)),
    volume1m,
    tradingValue1m: volume1m !== null ? volume1m * price : payloadNumber(payload, "acc_trade_price", "acc_trade_price_24h"),
    candles1m,
    updatedAt
  };
}

async function readQuoteCache(symbols: string[]) {
  const map = new Map<string, QuoteSnapshot>();
  const normalized = uniqueSorted(symbols);
  for (const symbolChunk of chunk(normalized, 400)) {
    const { data, error } = await supabaseAdmin()
      .from(MARKET_QUOTE_TABLE)
      .select("symbol,price,previous_close,change_pct,currency,exchange,source,payload,updated_at")
      .in("symbol", symbolChunk);
    if (error) {
      continue;
    }
    (data || []).forEach((row) => {
      const quote = rowToQuoteSnapshot(row as QuoteCacheRow);
      if (quote) {
        map.set(quote.symbol, quote);
      }
    });
  }
  return map;
}

function companyPerFromFundamental(fundamental: FinancialFundamentalSnapshot, priceValue: number | null | undefined) {
  const price = positiveNumber(priceValue);
  const eps = nonZeroNumber(fundamental.eps);
  if (price === null || eps === null) {
    return null;
  }
  return price / eps;
}

function companyPbrFromFundamental(fundamental: FinancialFundamentalSnapshot, priceValue: number | null | undefined) {
  const price = positiveNumber(priceValue);
  const bookValuePerShare = nonZeroNumber(fundamental.bookValuePerShare);
  if (price === null || bookValuePerShare === null) {
    return null;
  }
  return price / bookValuePerShare;
}

function companyEvEbitdaFromFundamental(fundamental: FinancialFundamentalSnapshot, priceValue: number | null | undefined) {
  const price = positiveNumber(priceValue);
  const ebitda = nonZeroNumber(fundamental.ebitda);
  if (ebitda === null) {
    return null;
  }
  const marketCap =
    price !== null && positiveNumber(fundamental.sharesOutstanding) !== null
      ? price * positiveNumber(fundamental.sharesOutstanding)!
      : positiveNumber(fundamental.marketCap);
  if (marketCap === null) {
    return null;
  }
  const enterpriseValue = marketCap + (finiteNumber(fundamental.totalDebt) || 0) - (finiteNumber(fundamental.cashAndShortInvestments) || 0);
  return enterpriseValue / ebitda;
}

function oneMonthMetrics(supplemental: StrategyMetricSnapshot | undefined, quote: QuoteSnapshot | undefined) {
  const dailyChart = supplemental?.technical?.daily || [];
  const recentDaily = dailyChart.length > 24 ? dailyChart.slice(-24) : dailyChart;
  const recentMinute = quote?.candles1m.length ? quote.candles1m.slice(-60) : [];
  const basis = recentDaily.length >= 2 ? recentDaily : recentMinute;
  return {
    returnPct: finiteNumber(supplemental?.metrics.oneMonthReturnPct) ?? chartReturnPct(basis),
    volatilityPct: finiteNumber(supplemental?.metrics.oneMonthVolatilityPct) ?? chartVolatilityPct(basis)
  };
}

function snapshotFromInputs(
  market: StrategyMarket,
  symbol: string,
  fundamental: FinancialFundamentalSnapshot | undefined,
  supplemental: StrategyMetricSnapshot | undefined,
  quote: QuoteSnapshot | undefined
): MarketMetricSnapshot | null {
  const now = new Date().toISOString();
  const supplementalMetrics = supplemental?.metrics || {};
  const price = positiveNumber(quote?.price) ?? positiveNumber(supplementalMetrics.price) ?? positiveNumber(supplemental?.price) ?? positiveNumber(fundamental?.priceAtRefresh);
  const changePct = finiteNumber(quote?.changePct) ?? finiteNumber(supplementalMetrics.changePct) ?? finiteNumber(supplemental?.changePct);
  const volume1m = finiteNumber(quote?.volume1m);
  const tradingValue1m = finiteNumber(quote?.tradingValue1m) ?? (volume1m !== null && price !== null ? volume1m * price : null);
  const oneMonth = oneMonthMetrics(supplemental, quote);
  const technicalMetrics = quote?.candles1m.length ? technicalMetricsFromCandles(quote.candles1m) : {};
  const companyPer = fundamental ? companyPerFromFundamental(fundamental, price) ?? finiteNumber(supplementalMetrics.companyPer) : finiteNumber(supplementalMetrics.companyPer);

  const metrics: Partial<Record<StrategyMetricKey, number | null>> = {
    ...supplementalMetrics,
    ...technicalMetrics,
    price,
    changePct,
    volume1m,
    tradingValue1m,
    oneMonthReturnPct: oneMonth.returnPct,
    oneMonthVolatilityPct: oneMonth.volatilityPct,
    standardDeviationPct: finiteNumber(supplementalMetrics.standardDeviationPct) ?? oneMonth.volatilityPct,
    companyEps: fundamental?.eps ?? finiteNumber(supplementalMetrics.companyEps),
    companyPer,
    companyPbr: fundamental ? companyPbrFromFundamental(fundamental, price) ?? finiteNumber(supplementalMetrics.companyPbr) : finiteNumber(supplementalMetrics.companyPbr),
    companyRoe: fundamental?.roePct ?? finiteNumber(supplementalMetrics.companyRoe),
    companyRoa: fundamental?.roaPct ?? finiteNumber(supplementalMetrics.companyRoa),
    companyNetMargin: fundamental?.netMarginPct ?? finiteNumber(supplementalMetrics.companyNetMargin),
    companyOperatingMargin: fundamental?.operatingMarginPct ?? finiteNumber(supplementalMetrics.companyOperatingMargin),
    companyEvEbitda: fundamental
      ? companyEvEbitdaFromFundamental(fundamental, price) ?? finiteNumber(supplementalMetrics.companyEvEbitda)
      : finiteNumber(supplementalMetrics.companyEvEbitda),
    revenueGrowthPct: fundamental?.revenueGrowthPct ?? finiteNumber(supplementalMetrics.revenueGrowthPct),
    operatingIncomeGrowthPct: fundamental?.operatingIncomeGrowthPct ?? finiteNumber(supplementalMetrics.operatingIncomeGrowthPct),
    earningsGrowthPct: fundamental?.earningsGrowthPct ?? finiteNumber(supplementalMetrics.earningsGrowthPct)
  };

  const name = fundamental?.name || supplemental?.name || symbol;
  const sector = fundamental?.sector || supplemental?.sector || "Unclassified";
  const industry = fundamental?.industry || fundamental?.sector || supplemental?.industry || supplemental?.sector || "Unclassified";
  if (!fundamental && !supplemental && !quote) {
    return null;
  }

  return {
    symbol,
    market,
    name,
    sector,
    industry,
    price,
    changePct,
    volume1m,
    tradingValue1m,
    metrics,
    metricTimeframe: "1m",
    priceRefreshedAt: quote?.updatedAt || null,
    volumeRefreshedAt: quote?.updatedAt || null,
    technicalRefreshedAt: quote?.updatedAt || supplemental?.refreshedAt || null,
    fundamentalRefreshedAt: fundamental?.refreshedAt || null,
    refreshedAt: quote?.updatedAt || supplemental?.refreshedAt || fundamental?.refreshedAt || now,
    updatedAt: now
  };
}

function groupKey(snapshot: MarketMetricSnapshot, scope: "industry" | "sector") {
  const value = (scope === "industry" ? snapshot.industry : snapshot.sector).trim() || "Unclassified";
  return `${snapshot.market}:${value}`;
}

function isClassified(snapshot: MarketMetricSnapshot, scope: "industry" | "sector") {
  const value = (scope === "industry" ? snapshot.industry : snapshot.sector).trim();
  return Boolean(value && value !== "Unclassified");
}

function peerGroupMetrics(snapshots: MarketMetricSnapshot[], scope: "industry" | "sector") {
  const groups = new Map<string, MarketMetricSnapshot[]>();
  snapshots.forEach((snapshot) => {
    if (!isClassified(snapshot, scope)) {
      return;
    }
    const key = groupKey(snapshot, scope);
    groups.set(key, [...(groups.get(key) || []), snapshot]);
  });

  const metrics = new Map<string, PeerGroupMetrics>();
  groups.forEach((items, key) => {
    const epsValues = items.map((item) => finiteNumber(item.metrics.companyEps)).filter((value): value is number => value !== null);
    const perValues = items.map((item) => finiteNumber(item.metrics.companyPer)).filter((value): value is number => value !== null);
    const roeValues = items.map((item) => finiteNumber(item.metrics.companyRoe)).filter((value): value is number => value !== null);
    metrics.set(key, {
      avgEps: epsValues.length >= GROUP_AGGREGATE_MIN_COMPANIES ? average(epsValues) : null,
      avgPer: perValues.length >= GROUP_AGGREGATE_MIN_COMPANIES ? average(perValues) : null,
      avgRoe: roeValues.length >= GROUP_AGGREGATE_MIN_COMPANIES ? average(roeValues) : null,
      medianPer: perValues.length >= GROUP_AGGREGATE_MIN_COMPANIES ? median(perValues) : null,
      medianRoe: roeValues.length >= GROUP_AGGREGATE_MIN_COMPANIES ? median(roeValues) : null,
      epsCount: epsValues.length,
      perCount: perValues.length,
      roeCount: roeValues.length
    });
  });
  return metrics;
}

function attachPeerAggregates(snapshots: MarketMetricSnapshot[]) {
  const industryGroups = peerGroupMetrics(snapshots, "industry");
  const sectorGroups = peerGroupMetrics(snapshots, "sector");
  snapshots.forEach((snapshot) => {
    const industry = industryGroups.get(groupKey(snapshot, "industry"));
    const sector = sectorGroups.get(groupKey(snapshot, "sector"));
    snapshot.metrics = {
      ...snapshot.metrics,
      industryAvgEps: industry?.avgEps ?? null,
      industryAvgPer: industry?.avgPer ?? null,
      industryAvgRoe: industry?.avgRoe ?? null,
      industryPer: industry?.medianPer ?? null,
      industryRoe: industry?.medianRoe ?? null,
      sectorAvgEps: sector?.avgEps ?? null,
      sectorAvgPer: sector?.avgPer ?? null,
      sectorAvgRoe: sector?.avgRoe ?? null
    };
  });
}

function cleanMetrics(metrics: Partial<Record<StrategyMetricKey, number | null>>) {
  return Object.fromEntries(
    Object.entries(metrics).filter(([, value]) => value === null || (typeof value === "number" && Number.isFinite(value)))
  );
}

function numericMetrics(input: unknown) {
  const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  return Object.entries(record).reduce<Partial<Record<StrategyMetricKey, number | null>>>((next, [key, value]) => {
    if (value === null) {
      next[key as StrategyMetricKey] = null;
      return next;
    }
    const num = finiteNumber(value);
    if (num !== null) {
      next[key as StrategyMetricKey] = num;
    }
    return next;
  }, {});
}

function rowToMarketMetricSnapshot(row: Record<string, unknown>): MarketMetricSnapshot | null {
  const symbol = normalizeSymbol(String(row.symbol || ""));
  const market = String(row.market || "") as StrategyMarket;
  if (!symbol || (market !== "us" && market !== "korea" && market !== "crypto")) {
    return null;
  }
  const price = finiteNumber(row.price);
  const changePct = finiteNumber(row.change_pct);
  const volume1m = finiteNumber(row.volume_1m);
  const tradingValue1m = finiteNumber(row.trading_value_1m);
  return {
    symbol,
    market,
    name: String(row.name || symbol),
    sector: String(row.sector || "Unclassified"),
    industry: String(row.industry || row.sector || "Unclassified"),
    price,
    changePct,
    volume1m,
    tradingValue1m,
    metrics: {
      ...numericMetrics(row.metrics),
      price,
      changePct,
      volume1m,
      tradingValue1m
    },
    metricTimeframe: "1m",
    priceRefreshedAt: row.price_refreshed_at ? String(row.price_refreshed_at) : null,
    volumeRefreshedAt: row.volume_refreshed_at ? String(row.volume_refreshed_at) : null,
    technicalRefreshedAt: row.technical_refreshed_at ? String(row.technical_refreshed_at) : null,
    fundamentalRefreshedAt: row.fundamental_refreshed_at ? String(row.fundamental_refreshed_at) : null,
    refreshedAt: String(row.refreshed_at || row.updated_at || ""),
    updatedAt: String(row.updated_at || row.refreshed_at || "")
  };
}

async function readExistingMarketMetricSnapshots(markets: StrategyMarket[]) {
  const map = new Map<string, MarketMetricSnapshot>();
  for (let from = 0; ; from += 1000) {
    let query = supabaseAdmin()
      .from(MARKET_METRIC_SNAPSHOT_TABLE)
      .select(
        "symbol,market,name,sector,industry,price,change_pct,volume_1m,trading_value_1m,metrics,price_refreshed_at,volume_refreshed_at,technical_refreshed_at,fundamental_refreshed_at,refreshed_at,updated_at"
      )
      .range(from, from + 999);
    if (markets.length) {
      query = query.in("market", markets);
    }
    const { data, error } = await query;
    if (error) {
      return map;
    }
    if (!data?.length) {
      break;
    }
    data.forEach((row) => {
      const snapshot = rowToMarketMetricSnapshot(row as Record<string, unknown>);
      if (snapshot) {
        map.set(`${snapshot.market}:${snapshot.symbol}`, snapshot);
      }
    });
    if (data.length < 1000) {
      break;
    }
  }
  return map;
}

function snapshotUpdatedAtMs(snapshot: MarketMetricSnapshot | undefined) {
  const updated = snapshot?.updatedAt ? Date.parse(snapshot.updatedAt) : 0;
  return Number.isFinite(updated) ? updated : 0;
}

function shouldRefreshSnapshot(snapshot: MarketMetricSnapshot | undefined, force?: boolean) {
  if (force || !snapshot) {
    return true;
  }
  const updated = snapshotUpdatedAtMs(snapshot);
  return !updated || Date.now() - updated > MARKET_QUOTE_MAX_AGE_MS;
}

function snapshotRow(snapshot: MarketMetricSnapshot) {
  const updatedAt = new Date().toISOString();
  return {
    symbol: snapshot.symbol,
    market: snapshot.market,
    name: snapshot.name,
    sector: snapshot.sector,
    industry: snapshot.industry,
    price: snapshot.price,
    change_pct: snapshot.changePct,
    volume_1m: snapshot.volume1m,
    trading_value_1m: snapshot.tradingValue1m,
    metrics: cleanMetrics(snapshot.metrics),
    metric_timeframe: snapshot.metricTimeframe,
    price_refreshed_at: snapshot.priceRefreshedAt,
    volume_refreshed_at: snapshot.volumeRefreshedAt,
    technical_refreshed_at: snapshot.technicalRefreshedAt,
    fundamental_refreshed_at: snapshot.fundamentalRefreshedAt,
    aggregate_refreshed_at: updatedAt,
    refreshed_at: snapshot.refreshedAt,
    updated_at: updatedAt
  };
}

export async function writeMarketMetricSnapshot(snapshots: MarketMetricSnapshot[]) {
  if (!snapshots.length) {
    return;
  }
  for (const rowChunk of chunk(snapshots.map(snapshotRow), 150)) {
    const { error } = await supabaseAdmin()
      .from(MARKET_METRIC_SNAPSHOT_TABLE)
      .upsert(rowChunk, { onConflict: "symbol,market" });
    if (error) {
      throw new Error(error.message || "Market metric snapshot write failed.");
    }
  }
}

export async function refreshMarketMetricSnapshot(options: RefreshOptions = {}): Promise<RefreshResult> {
  const markets = options.markets?.length ? options.markets : (["us", "korea", "crypto"] as StrategyMarket[]);
  const limit = Math.max(1, Math.min(350, Math.round(options.limit || 250)));
  const universeByMarket = await Promise.all(markets.map(async (market) => ({ market, symbols: await getStrategyUniverse(market) })));
  const universeEntries = universeByMarket.flatMap(({ market, symbols }) => symbols.map((symbol) => ({ market, symbol })));
  const existingSnapshots = await readExistingMarketMetricSnapshots(markets);
  const candidates = universeEntries
    .filter((entry) => shouldRefreshSnapshot(existingSnapshots.get(`${entry.market}:${entry.symbol}`), options.force))
    .sort((a, b) => {
      const left = existingSnapshots.get(`${a.market}:${a.symbol}`);
      const right = existingSnapshots.get(`${b.market}:${b.symbol}`);
      return snapshotUpdatedAtMs(left) - snapshotUpdatedAtMs(right) || a.market.localeCompare(b.market) || a.symbol.localeCompare(b.symbol);
    });
  const selectedEntries = candidates.slice(0, limit);
  const selectedSymbols = uniqueSorted(selectedEntries.map((entry) => entry.symbol));
  const selectedMarkets = Array.from(new Set(selectedEntries.map((entry) => entry.market)));
  const stockMarkets = selectedMarkets.filter((market) => market === "us" || market === "korea");
  const [fundamentalCache, supplementalCache, quoteCache] = await Promise.all([
    stockMarkets.length && selectedSymbols.length
      ? readFinancialFundamentalsCache(selectedSymbols, stockMarkets)
      : Promise.resolve(new Map<string, FinancialFundamentalSnapshot>()),
    selectedSymbols.length ? readStrategyMetricCache(selectedSymbols, selectedMarkets) : Promise.resolve(new Map<string, StrategyMetricSnapshot>()),
    selectedSymbols.length ? readQuoteCache(selectedSymbols) : Promise.resolve(new Map<string, QuoteSnapshot>())
  ]);

  const snapshots = selectedEntries
    .map(({ market, symbol }) =>
      snapshotFromInputs(market, symbol, fundamentalCache.get(`${market}:${symbol}`), supplementalCache.get(`${market}:${symbol}`), quoteCache.get(symbol))
    )
    .filter((snapshot): snapshot is MarketMetricSnapshot => snapshot !== null);

  const aggregateUniverse = new Map(existingSnapshots);
  snapshots.forEach((snapshot) => {
    aggregateUniverse.set(`${snapshot.market}:${snapshot.symbol}`, snapshot);
  });
  attachPeerAggregates(Array.from(aggregateUniverse.values()));
  await writeMarketMetricSnapshot(snapshots);

  const refreshedAt = new Date().toISOString();
  const cachedCount = existingSnapshots.size + snapshots.filter((snapshot) => !existingSnapshots.has(`${snapshot.market}:${snapshot.symbol}`)).length;
  return {
    markets,
    universeCount: universeEntries.length,
    cachedCount,
    staleCount: Math.max(0, candidates.length - snapshots.length),
    refreshedCount: snapshots.length,
    errors: [],
    refreshedAt,
    timeBudgetReached: candidates.length > snapshots.length
  };
}
