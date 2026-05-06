import type { StrategyCondition, StrategyDefinition, StrategyMarket, StrategyMetricKey, StrategyOperator } from "./types";

export const STRATEGY_MARKETS: Array<{ key: StrategyMarket; label: string }> = [
  { key: "us", label: "US Stocks" },
  { key: "korea", label: "Korea Stocks" },
  { key: "crypto", label: "Crypto" }
];

export const STRATEGY_METRICS: Array<{ key: StrategyMetricKey; label: string; kind: "price" | "percent" | "ratio" | "beta" }> = [
  { key: "price", label: "Current Price", kind: "price" },
  { key: "changePct", label: "Daily Change", kind: "percent" },
  { key: "oneMonthReturnPct", label: "1M Return", kind: "percent" },
  { key: "oneMonthVolatilityPct", label: "1M Volatility", kind: "percent" },
  { key: "companyPer", label: "Company PER", kind: "ratio" },
  { key: "industryPer", label: "Industry Median PER", kind: "ratio" },
  { key: "companyRoe", label: "Company ROE", kind: "percent" },
  { key: "industryRoe", label: "Industry Median ROE", kind: "percent" },
  { key: "rollingBeta", label: "Company Rolling Beta", kind: "beta" },
  { key: "industryRollingBeta", label: "Industry Rolling Beta", kind: "beta" },
  { key: "fullPeriodBeta", label: "Company Full Period Beta", kind: "beta" },
  { key: "industryFullPeriodBeta", label: "Industry Full Period Beta", kind: "beta" }
];

export const STRATEGY_OPERATORS: StrategyOperator[] = ["<", "<=", "=", ">=", ">"];

export function strategyMetricLabel(metric: StrategyMetricKey) {
  return STRATEGY_METRICS.find((item) => item.key === metric)?.label || metric;
}

export function defaultStrategyCondition(index = 1): StrategyCondition {
  return {
    id: `condition-${index}`,
    leftMetric: "companyPer",
    operator: "<",
    right: { type: "metric", metric: "industryPer" }
  };
}

export function defaultStrategyDefinition(): StrategyDefinition {
  return {
    id: "",
    name: "New Strategy",
    markets: ["us", "korea"],
    conditions: [defaultStrategyCondition()],
    active: true,
    created_at: "",
    updated_at: ""
  };
}
