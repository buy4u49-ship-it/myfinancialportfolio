import crypto from "node:crypto";
import { defaultStrategyCondition, strategyMetricLabel, STRATEGY_METRICS, STRATEGY_OPERATORS } from "./strategyConfig";
import { getStrategyUniverse, readStrategyMetricCache, strategyMetricSnapshotFresh } from "./strategyMetricCache";
import type {
  StrategyCondition,
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
          return {
            id: String(raw.id || `condition-${index + 1}`),
            leftMetric,
            operator,
            right: normalizeRightOperand(raw.right)
          };
        })
        .filter((condition): condition is StrategyCondition => condition !== null)
    : previous?.conditions || [defaultStrategyCondition()];

  return {
    id: String(candidate.id || previous?.id || crypto.randomUUID()),
    name: String(candidate.name || previous?.name || "New Strategy").trim() || "New Strategy",
    markets: markets.length ? markets : ["us", "korea"],
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

function conditionReason(condition: StrategyCondition, metrics: Partial<Record<StrategyMetricKey, number | null>>) {
  const leftLabel = strategyMetricLabel(condition.leftMetric);
  const rightLabel = condition.right.type === "number" ? String(condition.right.value) : strategyMetricLabel(condition.right.metric);
  const left = metrics[condition.leftMetric];
  const right = rightValue(condition.right, metrics);
  return `${leftLabel} ${condition.operator} ${rightLabel} (${left ?? "N/A"} vs ${right ?? "N/A"})`;
}

function median(values: Array<number | null | undefined>) {
  const valid = values.filter((value): value is number => value !== null && value !== undefined && Number.isFinite(value)).sort((a, b) => a - b);
  if (!valid.length) {
    return null;
  }
  const middle = Math.floor(valid.length / 2);
  return valid.length % 2 ? valid[middle] : (valid[middle - 1] + valid[middle]) / 2;
}

function positiveMedian(values: Array<number | null | undefined>) {
  return median(values.filter((value): value is number => value !== null && value !== undefined && Number.isFinite(value) && value > 0));
}

function industryGroupKey(snapshot: StrategyMetricSnapshot) {
  return `${snapshot.market}:${snapshot.industry || snapshot.sector || "Unclassified"}`;
}

function universeIndustryMetrics(snapshots: StrategyMetricSnapshot[]) {
  const groups = new Map<string, StrategyMetricSnapshot[]>();
  snapshots.forEach((snapshot) => {
    const key = industryGroupKey(snapshot);
    groups.set(key, [...(groups.get(key) || []), snapshot]);
  });
  const metrics = new Map<string, { per: number | null; roe: number | null; count: number }>();
  groups.forEach((items, key) => {
    metrics.set(key, {
      per: positiveMedian(items.map((item) => item.metrics.companyPer)),
      roe: median(items.map((item) => item.metrics.companyRoe)),
      count: items.length
    });
  });
  return metrics;
}

function evaluateSnapshot(snapshot: StrategyMetricSnapshot, strategy: StrategyDefinition, industryMetrics: Map<string, { per: number | null; roe: number | null; count: number }>) {
  const industry = industryMetrics.get(industryGroupKey(snapshot));
  const metrics = {
    ...snapshot.metrics,
    price: snapshot.metrics.price ?? snapshot.price,
    changePct: snapshot.metrics.changePct ?? snapshot.changePct,
    industryPer: industry?.per ?? snapshot.metrics.industryPer ?? null,
    industryRoe: industry?.roe ?? snapshot.metrics.industryRoe ?? null
  };
  const passed = strategy.conditions.every((condition) =>
    compare(metrics[condition.leftMetric], condition.operator, rightValue(condition.right, metrics))
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
    metrics,
    reasons: strategy.conditions.map((condition) => conditionReason(condition, metrics))
  };
}

export async function evaluateStrategy(input: unknown): Promise<StrategyEvaluation> {
  const strategy = normalizeStrategy(input);
  const universeByMarket = await Promise.all(strategy.markets.map(async (market) => ({ market, symbols: await getStrategyUniverse(market) })));
  const symbols = universeByMarket.flatMap((item) => item.symbols);
  const cache = await readStrategyMetricCache(symbols, strategy.markets);
  const matches: StrategyEvaluation["matches"] = [];
  const errors: StrategyEvaluation["errors"] = [];
  const cachedSnapshots = Array.from(cache.values()).filter((snapshot) => strategy.markets.includes(snapshot.market));
  const industryMetrics = universeIndustryMetrics(cachedSnapshots);

  universeByMarket.forEach(({ market, symbols: marketSymbols }) => {
    let missingCount = 0;
    marketSymbols.forEach((symbol) => {
      const snapshot = cache.get(`${market}:${symbol}`);
      if (!snapshot) {
        missingCount += 1;
        return;
      }
      const match = evaluateSnapshot(snapshot, strategy, industryMetrics);
      if (match) {
        matches.push(match);
      }
    });
    if (missingCount) {
      errors.push({ symbol: `${market}:cache`, message: `${missingCount} symbols do not have cached strategy metrics yet.` });
    }
  });

  const evaluatedAt = utcNowIso();
  const refreshedTimes = cachedSnapshots.map((snapshot) => Date.parse(snapshot.refreshedAt)).filter((value) => Number.isFinite(value));
  return {
    strategy: {
      ...strategy,
      last_evaluated_at: evaluatedAt,
      last_match_count: matches.length
    },
    matches: matches.sort((a, b) => a.market.localeCompare(b.market) || a.symbol.localeCompare(b.symbol)),
    evaluatedAt,
    errors,
    universeCount: universeByMarket.reduce((sum, item) => sum + item.symbols.length, 0),
    cachedCount: cachedSnapshots.length,
    staleCount: cachedSnapshots.filter((snapshot) => !strategyMetricSnapshotFresh(snapshot)).length,
    cacheRefreshedAt: refreshedTimes.length ? new Date(Math.max(...refreshedTimes)).toISOString() : undefined
  };
}
