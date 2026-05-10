import crypto from "node:crypto";
import {
  financialFundamentalFresh,
  readFinancialFundamentalsCache,
  STRATEGY_QUOTE_CACHE_MAX_AGE_MS
} from "./financialFundamentalsCache";
import { getCachedMarketQuotes, getQuotes } from "./prices";
import { defaultStrategyCondition, strategyMetricLabel, strategyMetricOption, STRATEGY_METRICS, STRATEGY_OPERATORS } from "./strategyConfig";
import { getStrategyUniverse, readStrategyMetricCache, strategyMetricSnapshotFresh } from "./strategyMetricCache";
import type {
  FinancialFundamentalSnapshot,
  Quote,
  StrategyCondition,
  StrategyConditionCategory,
  StrategyDefinition,
  StrategyEvaluation,
  StrategyMarket,
  StrategyMetricKey,
  StrategyOperator,
  StrategyMetricSnapshot,
  StrategyRightOperand
} from "./types";

const VALID_MARKETS = new Set<StrategyMarket>(["us", "korea", "crypto"]);
const VALID_METRICS = new Set<StrategyMetricKey>(STRATEGY_METRICS.map((item) => item.key));
const VALID_OPERATORS = new Set<StrategyOperator>(STRATEGY_OPERATORS);
const VALID_CATEGORIES = new Set<StrategyConditionCategory>(["price", "volatility", "volume", "fundamental"]);

function utcNowIso() {
  return new Date().toISOString();
}

function isStrategyMarket(value: string): value is StrategyMarket {
  return VALID_MARKETS.has(value as StrategyMarket);
}

function isStrategyMetric(value: string): value is StrategyMetricKey {
  return VALID_METRICS.has(value as StrategyMetricKey);
}

function isStrategyOperator(value: string): value is StrategyOperator {
  return VALID_OPERATORS.has(value as StrategyOperator);
}

function isStrategyCategory(value: string): value is StrategyConditionCategory {
  return VALID_CATEGORIES.has(value as StrategyConditionCategory);
}

function normalizeConditionParams(input: unknown) {
  const source = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  return Object.entries(source).reduce<Record<string, number | string | boolean>>((next, [key, value]) => {
    if (!key) {
      return next;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      next[key] = value;
    } else if (typeof value === "string" || typeof value === "boolean") {
      next[key] = value;
    }
    return next;
  }, {});
}

function normalizeSectors(input: unknown, previous?: string[]) {
  const raw = Array.isArray(input) ? input : previous || [];
  return Array.from(
    new Set(
      raw
        .map((sector) => String(sector || "").trim())
        .filter((sector) => sector && sector !== "All Industries")
    )
  );
}

function normalizeRightOperand(input: unknown): StrategyRightOperand {
  const candidate = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  if (candidate.type === "number") {
    const value = Number(candidate.value);
    return { type: "number", value: Number.isFinite(value) ? value : 0 };
  }
  const metric = String(candidate.metric || "industryPer");
  return { type: "metric", metric: isStrategyMetric(metric) ? metric : "industryPer" };
}

export function normalizeStrategy(input: unknown, previous?: StrategyDefinition): StrategyDefinition {
  const candidate = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const now = utcNowIso();
  const markets = Array.isArray(candidate.markets)
    ? candidate.markets.map((market) => String(market)).filter(isStrategyMarket)
    : previous?.markets || ["us", "korea"];
  const conditions = Array.isArray(candidate.conditions)
    ? candidate.conditions
        .map((condition, index): StrategyCondition | null => {
          const raw = condition && typeof condition === "object" ? (condition as Record<string, unknown>) : {};
          const leftMetric = String(raw.leftMetric || "");
          const operator = String(raw.operator || "");
          if (!isStrategyMetric(leftMetric) || !isStrategyOperator(operator)) {
            return null;
          }
          const category = String(raw.category || "");
          const inferredCategory = strategyMetricOption(leftMetric)?.category || "fundamental";
          return {
            id: String(raw.id || `condition-${index + 1}`),
            category: isStrategyCategory(category) ? category : inferredCategory,
            leftMetric,
            operator,
            right: normalizeRightOperand(raw.right),
            params: normalizeConditionParams(raw.params)
          };
        })
        .filter((condition): condition is StrategyCondition => condition !== null)
    : previous?.conditions || [defaultStrategyCondition()];

  return {
    id: String(candidate.id || previous?.id || crypto.randomUUID()),
    name: String(candidate.name || previous?.name || "New Strategy").trim() || "New Strategy",
    markets: markets.length ? markets : ["us", "korea"],
    sectors: normalizeSectors(candidate.sectors, previous?.sectors),
    conditions: conditions.length ? conditions : [defaultStrategyCondition()],
    active: candidate.active === undefined ? previous?.active !== false : candidate.active !== false,
    created_at: String(candidate.created_at || previous?.created_at || now),
    updated_at: now,
    last_evaluated_at: previous?.last_evaluated_at,
    last_match_count: previous?.last_match_count
  };
}

export function normalizeStrategies(record: { strategies?: StrategyDefinition[] }) {
  return (Array.isArray(record.strategies) ? record.strategies : [])
    .filter((strategy) => Boolean(strategy && typeof strategy === "object"))
    .map((strategy) => normalizeStrategy(strategy));
}

function rightValue(right: StrategyRightOperand, metrics: Partial<Record<StrategyMetricKey, number | null>>) {
  return right.type === "number" ? right.value : metrics[right.metric] ?? null;
}

function compare(left: number | null | undefined, operator: StrategyOperator, right: number | null | undefined) {
  if (left === null || left === undefined || right === null || right === undefined || !Number.isFinite(left) || !Number.isFinite(right)) {
    return false;
  }
  if (operator === "<") {
    return left < right;
  }
  if (operator === "<=") {
    return left <= right;
  }
  if (operator === ">") {
    return left > right;
  }
  if (operator === ">=") {
    return left >= right;
  }
  return Math.abs(left - right) <= Math.max(0.000001, Math.abs(right) * 0.000001);
}

function conditionReason(
  condition: StrategyCondition,
  metrics: Partial<Record<StrategyMetricKey, number | null>>,
  snapshot: EvaluationSnapshot
) {
  const leftLabel = strategyMetricLabel(condition.leftMetric);
  const rightLabel = condition.right.type === "number" ? String(condition.right.value) : strategyMetricLabel(condition.right.metric);
  const left = metricValue(condition.leftMetric, metrics, snapshot, condition.params);
  const right = rightValueForCondition(condition.right, metrics, snapshot, condition.params);
  return `${leftLabel} ${condition.operator} ${rightLabel} (${left ?? "N/A"} vs ${right ?? "N/A"})`;
}

type EvaluationSnapshot = {
  symbol: string;
  market: StrategyMarket;
  name: string;
  sector: string;
  industry: string;
  price: number | null;
  changePct: number | null;
  metrics: Partial<Record<StrategyMetricKey, number | null>>;
  technical?: StrategyMetricSnapshot["technical"];
  fresh: boolean;
  refreshedAt: string;
};

type StrategyTechnicalPoint = NonNullable<StrategyMetricSnapshot["technical"]>["daily"][number];

const INDUSTRY_MEDIAN_MIN_COMPANIES = 5;

type EvaluationOptions = {
  offset?: number;
  limit?: number;
};

function finiteNumber(value: number | null | undefined) {
  return value !== null && value !== undefined && Number.isFinite(value) ? value : null;
}

function positiveNumber(value: number | null | undefined) {
  const num = finiteNumber(value);
  return num !== null && num > 0 ? num : null;
}

function nonZeroNumber(value: number | null | undefined) {
  const num = finiteNumber(value);
  return num !== null && num !== 0 ? num : null;
}

function metricReferencesIndustryMedian(metric: StrategyMetricKey) {
  return metric === "industryPer" || metric === "industryRoe";
}

function strategyUsesIndustryMedians(strategy: StrategyDefinition) {
  return strategy.conditions.some(
    (condition) =>
      metricReferencesIndustryMedian(condition.leftMetric) ||
      (condition.right.type === "metric" && metricReferencesIndustryMedian(condition.right.metric))
  );
}

function companyPerFromFundamental(fundamental: FinancialFundamentalSnapshot, priceValue: number | null | undefined) {
  const price = positiveNumber(priceValue);
  const eps = nonZeroNumber(fundamental.eps);
  if (price === null || eps === null) {
    return null;
  }
  return price / eps;
}

function latestTechnicalClose(technical: StrategyMetricSnapshot["technical"] | undefined) {
  const daily = technical?.daily || [];
  for (let index = daily.length - 1; index >= 0; index -= 1) {
    const close = positiveNumber(daily[index]?.close);
    if (close !== null) {
      return close;
    }
  }
  return null;
}

function technicalChangePct(technical: StrategyMetricSnapshot["technical"] | undefined) {
  const daily = technical?.daily || [];
  const closes: number[] = [];
  for (let index = daily.length - 1; index >= 0 && closes.length < 2; index -= 1) {
    const close = positiveNumber(daily[index]?.close);
    if (close !== null) {
      closes.unshift(close);
    }
  }
  if (closes.length < 2 || closes[0] === 0) {
    return null;
  }
  return (closes[1] / closes[0] - 1) * 100;
}

function evaluationFromFundamental(
  fundamental: FinancialFundamentalSnapshot,
  quote: Quote | undefined,
  supplemental?: StrategyMetricSnapshot
): EvaluationSnapshot {
  const supplementalMetrics = supplemental?.metrics || {};
  const price =
    positiveNumber(quote?.price) ??
    positiveNumber(supplementalMetrics.price) ??
    positiveNumber(supplemental?.price) ??
    positiveNumber(fundamental.priceAtRefresh) ??
    latestTechnicalClose(supplemental?.technical);
  const changePct =
    finiteNumber(quote?.changePct) ??
    finiteNumber(supplementalMetrics.changePct) ??
    finiteNumber(supplemental?.changePct) ??
    technicalChangePct(supplemental?.technical);
  const companyPer = companyPerFromFundamental(fundamental, price) ?? finiteNumber(supplementalMetrics.companyPer);
  const metrics: Partial<Record<StrategyMetricKey, number | null>> = {
    ...supplementalMetrics,
    price,
    changePct,
    companyEps: fundamental.eps,
    companyPer,
    companyRoe: fundamental.roePct ?? finiteNumber(supplementalMetrics.companyRoe)
  };
  return {
    symbol: fundamental.symbol,
    market: fundamental.market,
    name: fundamental.name || supplemental?.name || fundamental.symbol,
    sector: fundamental.sector || supplemental?.sector || "Unclassified",
    industry: fundamental.industry || fundamental.sector || supplemental?.industry || supplemental?.sector || "Unclassified",
    price,
    changePct,
    metrics,
    technical: supplemental?.technical,
    fresh: financialFundamentalFresh(fundamental),
    refreshedAt: fundamental.refreshedAt
  };
}

function evaluationFromSupplemental(snapshot: StrategyMetricSnapshot, quote: Quote | undefined): EvaluationSnapshot {
  const price = positiveNumber(quote?.price) ?? positiveNumber(snapshot.metrics.price) ?? positiveNumber(snapshot.price) ?? latestTechnicalClose(snapshot.technical);
  const changePct =
    finiteNumber(quote?.changePct) ??
    finiteNumber(snapshot.metrics.changePct) ??
    finiteNumber(snapshot.changePct) ??
    technicalChangePct(snapshot.technical);
  return {
    symbol: snapshot.symbol,
    market: snapshot.market,
    name: snapshot.name || snapshot.symbol,
    sector: snapshot.sector || "Unclassified",
    industry: snapshot.industry || snapshot.sector || "Unclassified",
    price,
    changePct,
    metrics: {
      ...snapshot.metrics,
      price,
      changePct
    },
    technical: snapshot.technical,
    fresh: strategyMetricSnapshotFresh(snapshot),
    refreshedAt: snapshot.refreshedAt
  };
}

async function getStrategyQuotes(symbols: string[], markets: StrategyMarket[]) {
  const quoteCache = await getCachedMarketQuotes(symbols, { maxAgeMs: STRATEGY_QUOTE_CACHE_MAX_AGE_MS });
  if (!markets.includes("crypto")) {
    return quoteCache;
  }
  const missingCryptoSymbols = symbols.filter((symbol) => symbol.endsWith("-KRW") && !quoteCache.has(symbol));
  if (!missingCryptoSymbols.length) {
    return quoteCache;
  }
  const liveQuotes = await getQuotes(missingCryptoSymbols);
  liveQuotes.forEach((quote, symbol) => {
    if (positiveNumber(quote.price) !== null) {
      quoteCache.set(symbol, quote);
    }
  });
  return quoteCache;
}

function median(values: Array<number | null | undefined>) {
  const valid = values.filter((value): value is number => value !== null && value !== undefined && Number.isFinite(value)).sort((a, b) => a - b);
  if (!valid.length) {
    return null;
  }
  const middle = Math.floor(valid.length / 2);
  return valid.length % 2 ? valid[middle] : (valid[middle - 1] + valid[middle]) / 2;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
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

function conditionParam(params: StrategyCondition["params"], key: string, fallback: number) {
  const raw = params?.[key];
  if (raw === "" || raw === null || raw === undefined) {
    return fallback;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(1, Math.round(value)) : fallback;
}

function decimalConditionParam(params: StrategyCondition["params"], key: string, fallback: number) {
  const raw = params?.[key];
  if (raw === "" || raw === null || raw === undefined) {
    return fallback;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
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

type VolumeProfileBin = {
  low: number;
  high: number;
  volume: number;
  weightedClose: number;
};

type VolumeProfileSummary = {
  vwap: number;
  pointOfControl: number;
  valueAreaHigh: number;
  valueAreaLow: number;
  aboveBelowVolumeRatio: number | null;
  skewPct: number;
};

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
  const bins: VolumeProfileBin[] = Array.from({ length: binCount }, (_, index) => ({
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

function technicalMetricValue(metric: StrategyMetricKey, snapshot: EvaluationSnapshot, params?: StrategyCondition["params"]) {
  const daily = snapshot.technical?.daily || [];
  const points = daily.filter((point) => Number.isFinite(point.close));
  const closes = points.map((point) => point.close);
  if (!closes.length) {
    return null;
  }
  const currentIndex = closes.length;
  const previousIndex = closes.length - 1;
  if (metric === "movingAverageBreakoutUp" || metric === "movingAverageBreakoutDown") {
    const period = conditionParam(params, "period", 20);
    const currentMa = movingAverage(closes, currentIndex, period);
    const previousMa = movingAverage(closes, previousIndex, period);
    if (currentMa === null || previousMa === null || closes.length < 2) {
      return null;
    }
    const upward = closes.at(-1)! > currentMa && closes.at(-2)! <= previousMa;
    const downward = closes.at(-1)! < currentMa && closes.at(-2)! >= previousMa;
    return metric === "movingAverageBreakoutUp" ? (upward ? 1 : 0) : downward ? 1 : 0;
  }
  if (metric === "goldenCross" || metric === "deadCross") {
    const shortPeriod = conditionParam(params, "shortPeriod", 20);
    const longPeriod = conditionParam(params, "longPeriod", 60);
    const currentShort = movingAverage(closes, currentIndex, shortPeriod);
    const currentLong = movingAverage(closes, currentIndex, longPeriod);
    const previousShort = movingAverage(closes, previousIndex, shortPeriod);
    const previousLong = movingAverage(closes, previousIndex, longPeriod);
    if (currentShort === null || currentLong === null || previousShort === null || previousLong === null) {
      return null;
    }
    const golden = currentShort > currentLong && previousShort <= previousLong;
    const dead = currentShort < currentLong && previousShort >= previousLong;
    return metric === "goldenCross" ? (golden ? 1 : 0) : dead ? 1 : 0;
  }
  if (metric === "macdSignal") {
    const fastPeriod = conditionParam(params, "fastPeriod", 12);
    const slowPeriod = conditionParam(params, "slowPeriod", 26);
    const signalPeriod = conditionParam(params, "signalPeriod", 9);
    const fast = ema(closes, fastPeriod);
    const slow = ema(closes, slowPeriod);
    const overlap = Math.min(fast.length, slow.length);
    if (overlap < signalPeriod) {
      return null;
    }
    const macd = fast.slice(-overlap).map((value, index) => value - slow.slice(-overlap)[index]);
    const signal = ema(macd, signalPeriod);
    if (!signal.length) {
      return null;
    }
    return macd.at(-1)! - signal.at(-1)!;
  }
  if (metric === "rsi") {
    return rsi(closes, conditionParam(params, "period", 14));
  }
  if (metric === "bollingerBandPosition") {
    const period = conditionParam(params, "period", 20);
    const deviation = decimalConditionParam(params, "deviation", 2);
    if (closes.length < period) {
      return null;
    }
    const window = closes.slice(-period);
    const mean = average(window);
    const sigma = stddev(window);
    if (mean === null || sigma === null || sigma === 0) {
      return null;
    }
    const lower = mean - sigma * deviation;
    const upper = mean + sigma * deviation;
    if (upper === lower) {
      return null;
    }
    return ((closes.at(-1)! - lower) / (upper - lower)) * 100;
  }
  if (
    metric === "volumeSpike" ||
    metric === "volumeProfile" ||
    metric === "vwap" ||
    metric === "pointOfControl" ||
    metric === "valueAreaHigh" ||
    metric === "valueAreaLow" ||
    metric === "vwapAboveBelowVolumeRatio" ||
    metric === "volumeProfileSkew"
  ) {
    const period = conditionParam(params, "lookbackDays", metric === "volumeSpike" ? 20 : 60);
    if (points.length <= period) {
      return null;
    }
    const previousPoints = points.slice(-period - 1, -1);
    if (metric === "volumeSpike") {
      const previousVolumes = previousPoints.map((point) => (point.volume !== null && Number.isFinite(point.volume) ? point.volume : 0));
      const averageVolume = average(previousVolumes.filter((value) => value > 0));
      const currentVolume = points.at(-1)?.volume;
      if (currentVolume === null || currentVolume === undefined || !Number.isFinite(currentVolume) || currentVolume <= 0 || averageVolume === null || averageVolume <= 0) {
        return null;
      }
      return currentVolume / averageVolume;
    }

    const profile = buildVolumeProfileSummary(points, period);
    if (!profile) {
      return null;
    }
    if (metric === "vwap") {
      return profile.vwap;
    }
    if (metric === "pointOfControl") {
      return profile.pointOfControl;
    }
    if (metric === "valueAreaHigh") {
      return profile.valueAreaHigh;
    }
    if (metric === "valueAreaLow") {
      return profile.valueAreaLow;
    }
    if (metric === "vwapAboveBelowVolumeRatio") {
      return profile.aboveBelowVolumeRatio;
    }
    if (metric === "volumeProfileSkew") {
      return profile.skewPct;
    }
    return profile.vwap > 0 ? (points.at(-1)!.close / profile.vwap - 1) * 100 : null;
  }
  return null;
}

function metricValue(
  metric: StrategyMetricKey,
  metrics: Partial<Record<StrategyMetricKey, number | null>>,
  snapshot: EvaluationSnapshot,
  params?: StrategyCondition["params"]
) {
  const stored = metrics[metric];
  if (stored !== undefined) {
    return stored;
  }
  return technicalMetricValue(metric, snapshot, params);
}

function rightValueForCondition(
  right: StrategyRightOperand,
  metrics: Partial<Record<StrategyMetricKey, number | null>>,
  snapshot: EvaluationSnapshot,
  params?: StrategyCondition["params"]
) {
  return right.type === "number" ? right.value : metricValue(right.metric, metrics, snapshot, params);
}

function industryGroupKey(snapshot: EvaluationSnapshot) {
  return `${snapshot.market}:${snapshot.industry || "Unclassified"}`;
}

function strategySectorMatches(strategy: StrategyDefinition, snapshot: EvaluationSnapshot) {
  if (!strategy.sectors?.length || snapshot.market === "crypto") {
    return true;
  }
  return strategy.sectors.includes(snapshot.sector);
}

function isIndustryMedianEligible(snapshot: EvaluationSnapshot) {
  const industry = snapshot.industry.trim();
  const per = finiteNumber(snapshot.metrics.companyPer);
  const roe = finiteNumber(snapshot.metrics.companyRoe);
  return (
    Boolean(industry && industry !== "Unclassified") &&
    per !== null &&
    roe !== null
  );
}

function universeIndustryMetrics(snapshots: EvaluationSnapshot[]) {
  const groups = new Map<string, EvaluationSnapshot[]>();
  snapshots.forEach((snapshot) => {
    if (!isIndustryMedianEligible(snapshot)) {
      return;
    }
    const key = industryGroupKey(snapshot);
    groups.set(key, [...(groups.get(key) || []), snapshot]);
  });
  const metrics = new Map<string, { per: number | null; roe: number | null; count: number }>();
  groups.forEach((items, key) => {
    metrics.set(key, {
      per: median(items.map((item) => item.metrics.companyPer)),
      roe: median(items.map((item) => item.metrics.companyRoe)),
      count: items.length
    });
  });
  return metrics;
}

function evaluateSnapshot(snapshot: EvaluationSnapshot, strategy: StrategyDefinition, industryMetrics: Map<string, { per: number | null; roe: number | null; count: number }>) {
  if (!strategySectorMatches(strategy, snapshot)) {
    return null;
  }
  const industry = industryMetrics.get(industryGroupKey(snapshot));
  if (strategyUsesIndustryMedians(strategy)) {
    if (!industry || industry.count < INDUSTRY_MEDIAN_MIN_COMPANIES || !isIndustryMedianEligible(snapshot)) {
      return null;
    }
  }
  const metrics = {
    ...snapshot.metrics,
    price: snapshot.metrics.price ?? snapshot.price,
    changePct: snapshot.metrics.changePct ?? snapshot.changePct,
    industryPer: industry?.per ?? snapshot.metrics.industryPer ?? null,
    industryRoe: industry?.roe ?? snapshot.metrics.industryRoe ?? null
  };
  const resolvedMetrics = { ...metrics };
  strategy.conditions.forEach((condition) => {
    resolvedMetrics[condition.leftMetric] = metricValue(condition.leftMetric, metrics, snapshot, condition.params);
    if (condition.right.type === "metric") {
      resolvedMetrics[condition.right.metric] = metricValue(condition.right.metric, metrics, snapshot, condition.params);
    }
  });
  const passed = strategy.conditions.every((condition) =>
    compare(
      metricValue(condition.leftMetric, metrics, snapshot, condition.params),
      condition.operator,
      rightValueForCondition(condition.right, metrics, snapshot, condition.params)
    )
  );
  if (!passed) {
    return null;
  }
  return {
    symbol: snapshot.symbol,
    name: snapshot.name || snapshot.symbol,
    market: snapshot.market,
    price: snapshot.price,
    changePct: snapshot.changePct,
    metrics: resolvedMetrics,
    reasons: strategy.conditions.map((condition) => conditionReason(condition, metrics, snapshot))
  };
}

export async function evaluateStrategy(input: unknown, options: EvaluationOptions = {}): Promise<StrategyEvaluation> {
  const strategy = normalizeStrategy(input);
  const universeByMarket = await Promise.all(strategy.markets.map(async (market) => ({ market, symbols: await getStrategyUniverse(market) })));
  const universeEntries = universeByMarket.flatMap(({ market, symbols }) => symbols.map((symbol) => ({ market, symbol })));
  const universeCount = universeEntries.length;
  const batchOffset = Math.max(0, Math.round(options.offset || 0));
  const batchLimit = Math.max(1, Math.min(800, Math.round(options.limit || universeCount || 1)));
  const selectedEntries = options.limit ? universeEntries.slice(batchOffset, batchOffset + batchLimit) : universeEntries;
  const selectedMarkets = Array.from(new Set(selectedEntries.map((entry) => entry.market)));
  const symbols = Array.from(new Set(selectedEntries.map((entry) => entry.symbol)));
  const [fundamentalCache, supplementalCache, quoteCache] = await Promise.all([
    readFinancialFundamentalsCache(symbols, selectedMarkets.length ? selectedMarkets : strategy.markets),
    readStrategyMetricCache(symbols, selectedMarkets.length ? selectedMarkets : strategy.markets),
    getStrategyQuotes(symbols, selectedMarkets.length ? selectedMarkets : strategy.markets)
  ]);
  const matches: StrategyEvaluation["matches"] = [];
  const errors: StrategyEvaluation["errors"] = [];
  const evaluationSnapshots = new Map<string, EvaluationSnapshot>();

  for (const fundamental of fundamentalCache.values()) {
    const key = `${fundamental.market}:${fundamental.symbol}`;
    evaluationSnapshots.set(
      key,
      evaluationFromFundamental(fundamental, quoteCache.get(fundamental.symbol), supplementalCache.get(key))
    );
  }

  for (const supplemental of supplementalCache.values()) {
    const key = `${supplemental.market}:${supplemental.symbol}`;
    if (!evaluationSnapshots.has(key) && supplemental.market === "crypto") {
      evaluationSnapshots.set(key, evaluationFromSupplemental(supplemental, quoteCache.get(supplemental.symbol)));
    }
  }

  const cachedSnapshots = Array.from(evaluationSnapshots.values()).filter((snapshot) => selectedMarkets.includes(snapshot.market));
  const industryMetrics = universeIndustryMetrics(cachedSnapshots);
  const priceCachedCount = cachedSnapshots.filter((snapshot) => snapshot.price !== null).length;
  const priceMissingCount = Math.max(0, cachedSnapshots.length - priceCachedCount);

  const selectedByMarket = new Map<StrategyMarket, string[]>();
  selectedEntries.forEach(({ market, symbol }) => {
    selectedByMarket.set(market, [...(selectedByMarket.get(market) || []), symbol]);
  });

  selectedByMarket.forEach((marketSymbols, market) => {
    let missingCount = 0;
    let missingPriceCount = 0;
    marketSymbols.forEach((symbol) => {
      const snapshot = evaluationSnapshots.get(`${market}:${symbol}`);
      if (!snapshot) {
        missingCount += 1;
        return;
      }
      if (snapshot.price === null) {
        missingPriceCount += 1;
      }
      const match = evaluateSnapshot(snapshot, strategy, industryMetrics);
      if (match) {
        matches.push(match);
      }
    });
    if (missingCount) {
      errors.push({ symbol: `${market}:cache`, message: `${missingCount} symbols in this batch do not have cached fundamentals or strategy metrics yet.` });
    }
    if (missingPriceCount) {
      errors.push({ symbol: `${market}:price-cache`, message: `${missingPriceCount} cached symbols in this batch do not have a fresh positive quote cache row yet.` });
    }
  });

  const evaluatedAt = utcNowIso();
  const refreshedTimes = cachedSnapshots.map((snapshot) => Date.parse(snapshot.refreshedAt)).filter((value) => Number.isFinite(value));
  const nextOffset = options.limit && batchOffset + selectedEntries.length < universeCount ? batchOffset + selectedEntries.length : null;
  return {
    strategy: {
      ...strategy,
      last_evaluated_at: evaluatedAt,
      last_match_count: matches.length
    },
    matches: matches.sort((a, b) => a.market.localeCompare(b.market) || a.symbol.localeCompare(b.symbol)),
    evaluatedAt,
    errors,
    universeCount,
    cachedCount: cachedSnapshots.length,
    staleCount: cachedSnapshots.filter((snapshot) => !snapshot.fresh).length,
    priceCachedCount,
    priceMissingCount,
    cacheRefreshedAt: refreshedTimes.length ? new Date(Math.max(...refreshedTimes)).toISOString() : undefined,
    batchOffset,
    batchLimit,
    batchEvaluatedCount: selectedEntries.length,
    batchNextOffset: nextOffset,
    isPartial: nextOffset !== null || batchOffset > 0
  };
}
