import crypto from "node:crypto";
import { buildSymbolDetail, strategyUniverseSymbols } from "./marketData";
import { normalizeSymbol } from "./symbols";
import { defaultStrategyCondition, strategyMetricLabel, STRATEGY_METRICS, STRATEGY_OPERATORS } from "./strategyConfig";
import type {
  StrategyCondition,
  StrategyDefinition,
  StrategyEvaluation,
  StrategyMarket,
  StrategyMetricKey,
  StrategyOperator,
  StrategyRightOperand,
  SymbolDetailResponse
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

function currentValuation(detail: SymbolDetailResponse) {
  return detail.benchmark.valuationHistory.find((point) => point.label === "Current") || detail.benchmark.valuationHistory[0];
}

function symbolMetrics(detail: SymbolDetailResponse): Partial<Record<StrategyMetricKey, number | null>> {
  const valuation = currentValuation(detail);
  return {
    price: detail.quote.price,
    changePct: detail.quote.changePct,
    oneMonthReturnPct: detail.metrics.avgReturnPct,
    oneMonthVolatilityPct: detail.metrics.volatilityPct,
    companyPer: valuation?.companyPer ?? null,
    industryPer: valuation?.industryPer ?? null,
    companyRoe: valuation?.companyRoe === null || valuation?.companyRoe === undefined ? null : valuation.companyRoe * 100,
    industryRoe: valuation?.industryRoe === null || valuation?.industryRoe === undefined ? null : valuation.industryRoe * 100,
    rollingBeta: detail.benchmark.rollingBeta,
    industryRollingBeta: detail.benchmark.industryRollingBeta,
    fullPeriodBeta: detail.benchmark.fullPeriodBeta,
    industryFullPeriodBeta: detail.benchmark.industryFullPeriodBeta
  };
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

function defaultBenchmark(market: StrategyMarket) {
  if (market === "korea") {
    return "^KS11";
  }
  if (market === "crypto") {
    return "BTC-KRW";
  }
  return "SPY";
}

async function evaluateSymbol(symbol: string, market: StrategyMarket, strategy: StrategyDefinition) {
  const normalized = normalizeSymbol(symbol);
  const detail = await buildSymbolDetail(normalized, "1M", {
    benchmark: defaultBenchmark(market),
    historyYears: 20,
    rollingWindow: 36
  });
  const metrics = symbolMetrics(detail);
  const passed = strategy.conditions.every((condition) =>
    compare(metrics[condition.leftMetric], condition.operator, rightValue(condition.right, metrics))
  );
  if (!passed) {
    return null;
  }
  return {
    symbol: detail.symbol,
    name: detail.profile.name || detail.symbol,
    market,
    price: detail.quote.price,
    changePct: detail.quote.changePct,
    metrics,
    reasons: strategy.conditions.map((condition) => conditionReason(condition, metrics))
  };
}

export async function evaluateStrategy(input: unknown): Promise<StrategyEvaluation> {
  const strategy = normalizeStrategy(input);
  const symbols = strategy.markets.flatMap((market) => strategyUniverseSymbols(market).map((symbol) => ({ symbol, market })));
  const matches: StrategyEvaluation["matches"] = [];
  const errors: StrategyEvaluation["errors"] = [];
  const batchSize = 4;

  for (let index = 0; index < symbols.length; index += batchSize) {
    const batch = symbols.slice(index, index + batchSize);
    const settled = await Promise.allSettled(batch.map((item) => evaluateSymbol(item.symbol, item.market, strategy)));
    settled.forEach((result, resultIndex) => {
      const item = batch[resultIndex];
      if (result.status === "fulfilled") {
        if (result.value) {
          matches.push(result.value);
        }
      } else {
        errors.push({ symbol: item.symbol, message: result.reason instanceof Error ? result.reason.message : "Evaluation failed." });
      }
    });
  }

  const evaluatedAt = utcNowIso();
  return {
    strategy: {
      ...strategy,
      last_evaluated_at: evaluatedAt,
      last_match_count: matches.length
    },
    matches: matches.sort((a, b) => a.market.localeCompare(b.market) || a.symbol.localeCompare(b.symbol)),
    evaluatedAt,
    errors
  };
}
