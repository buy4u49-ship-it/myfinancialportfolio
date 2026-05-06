import type { StrategyCondition, StrategyConditionCategory, StrategyDefinition, StrategyMarket, StrategyMetricKey, StrategyOperator } from "./types";

export const STRATEGY_MARKETS: Array<{ key: StrategyMarket; label: string }> = [
  { key: "us", label: "US Stocks" },
  { key: "korea", label: "Korea Stocks" },
  { key: "crypto", label: "Crypto" }
];

export const STRATEGY_CONDITION_CATEGORIES: Array<{ key: StrategyConditionCategory; label: string }> = [
  { key: "price", label: "Price Indicators" },
  { key: "volatility", label: "Volatility Indicators" },
  { key: "volume", label: "Volume Indicators" },
  { key: "fundamental", label: "Fundamental Indicators" }
];

export const STRATEGY_SECTORS = [
  "All Industries",
  "Technology",
  "Communication Services",
  "Consumer Cyclical",
  "Consumer Defensive",
  "Financial Services",
  "Healthcare",
  "Industrials",
  "Energy",
  "Basic Materials",
  "Real Estate",
  "Utilities"
];

export type StrategyMetricKind = "price" | "percent" | "ratio" | "beta" | "signal";
export type StrategyMetricParam = {
  key: string;
  label: string;
  type: "number";
  defaultValue: number;
  min?: number;
  max?: number;
  step?: number;
};
export type StrategyMetricOption = {
  key: StrategyMetricKey;
  label: string;
  category: StrategyConditionCategory;
  kind: StrategyMetricKind;
  params?: StrategyMetricParam[];
};

export const STRATEGY_METRICS: StrategyMetricOption[] = [
  { key: "price", label: "Current Price", category: "price", kind: "price" },
  { key: "changePct", label: "Daily Change", category: "price", kind: "percent" },
  { key: "oneMonthReturnPct", label: "1M Return", category: "price", kind: "percent" },
  {
    key: "movingAverageBreakoutUp",
    label: "MA Upward Breakout",
    category: "price",
    kind: "signal",
    params: [{ key: "period", label: "MA days", type: "number", defaultValue: 20, min: 2, max: 300, step: 1 }]
  },
  {
    key: "movingAverageBreakoutDown",
    label: "MA Downward Breakout",
    category: "price",
    kind: "signal",
    params: [{ key: "period", label: "MA days", type: "number", defaultValue: 20, min: 2, max: 300, step: 1 }]
  },
  {
    key: "goldenCross",
    label: "Golden Cross",
    category: "price",
    kind: "signal",
    params: [
      { key: "shortPeriod", label: "Short MA", type: "number", defaultValue: 20, min: 2, max: 250, step: 1 },
      { key: "longPeriod", label: "Long MA", type: "number", defaultValue: 50, min: 3, max: 400, step: 1 }
    ]
  },
  {
    key: "deadCross",
    label: "Dead Cross",
    category: "price",
    kind: "signal",
    params: [
      { key: "shortPeriod", label: "Short MA", type: "number", defaultValue: 20, min: 2, max: 250, step: 1 },
      { key: "longPeriod", label: "Long MA", type: "number", defaultValue: 50, min: 3, max: 400, step: 1 }
    ]
  },
  {
    key: "macdSignal",
    label: "MACD Signal",
    category: "price",
    kind: "ratio",
    params: [
      { key: "fastPeriod", label: "Fast", type: "number", defaultValue: 12, min: 2, max: 80, step: 1 },
      { key: "slowPeriod", label: "Slow", type: "number", defaultValue: 26, min: 3, max: 160, step: 1 },
      { key: "signalPeriod", label: "Signal", type: "number", defaultValue: 9, min: 2, max: 80, step: 1 }
    ]
  },
  {
    key: "rsi",
    label: "RSI",
    category: "price",
    kind: "ratio",
    params: [{ key: "period", label: "RSI days", type: "number", defaultValue: 14, min: 2, max: 100, step: 1 }]
  },
  {
    key: "bollingerBandPosition",
    label: "Bollinger Band Position",
    category: "price",
    kind: "percent",
    params: [
      { key: "period", label: "Window", type: "number", defaultValue: 20, min: 5, max: 200, step: 1 },
      { key: "deviation", label: "Deviation", type: "number", defaultValue: 2, min: 0.5, max: 5, step: 0.1 }
    ]
  },
  { key: "oneMonthVolatilityPct", label: "1M Volatility", category: "volatility", kind: "percent" },
  { key: "rollingBeta", label: "Company Rolling Beta", category: "volatility", kind: "beta" },
  { key: "industryRollingBeta", label: "Industry Rolling Beta", category: "volatility", kind: "beta" },
  { key: "fullPeriodBeta", label: "Company Full Period Beta", category: "volatility", kind: "beta" },
  { key: "industryFullPeriodBeta", label: "Industry Full Period Beta", category: "volatility", kind: "beta" },
  { key: "standardDeviationPct", label: "Standard Deviation", category: "volatility", kind: "percent" },
  {
    key: "volumeSpike",
    label: "Volume Spike",
    category: "volume",
    kind: "ratio",
    params: [{ key: "lookbackDays", label: "Lookback", type: "number", defaultValue: 20, min: 2, max: 250, step: 1 }]
  },
  {
    key: "volumeProfile",
    label: "Volume Profile",
    category: "volume",
    kind: "percent",
    params: [{ key: "lookbackDays", label: "Lookback", type: "number", defaultValue: 60, min: 5, max: 500, step: 1 }]
  },
  { key: "companyEps", label: "Company EPS", category: "fundamental", kind: "ratio" },
  { key: "companyPer", label: "Company PER", category: "fundamental", kind: "ratio" },
  { key: "industryPer", label: "Industry Median PER", category: "fundamental", kind: "ratio" },
  { key: "companyPbr", label: "Company PBR", category: "fundamental", kind: "ratio" },
  { key: "companyRoe", label: "Company ROE", category: "fundamental", kind: "percent" },
  { key: "industryRoe", label: "Industry Median ROE", category: "fundamental", kind: "percent" },
  { key: "companyRoa", label: "Company ROA", category: "fundamental", kind: "percent" },
  { key: "companyNetMargin", label: "Net Margin", category: "fundamental", kind: "percent" },
  { key: "companyOperatingMargin", label: "Operating Margin", category: "fundamental", kind: "percent" },
  { key: "companyEvEbitda", label: "EV/EBITDA", category: "fundamental", kind: "ratio" },
  { key: "revenueGrowthPct", label: "Revenue Growth", category: "fundamental", kind: "percent" },
  { key: "operatingIncomeGrowthPct", label: "Operating Income Growth", category: "fundamental", kind: "percent" },
  { key: "earningsGrowthPct", label: "Earnings Growth", category: "fundamental", kind: "percent" }
];

export const STRATEGY_OPERATORS: StrategyOperator[] = ["<", "<=", "=", ">=", ">"];

export function strategyMetricLabel(metric: StrategyMetricKey) {
  return STRATEGY_METRICS.find((item) => item.key === metric)?.label || metric;
}

export function strategyMetricOption(metric: StrategyMetricKey) {
  return STRATEGY_METRICS.find((item) => item.key === metric);
}

export function strategyMetricDefaultParams(metric: StrategyMetricKey) {
  return Object.fromEntries((strategyMetricOption(metric)?.params || []).map((param) => [param.key, param.defaultValue]));
}

export function defaultStrategyCondition(index = 1): StrategyCondition {
  return {
    id: `condition-${index}`,
    category: "fundamental",
    leftMetric: "companyPer",
    operator: "<",
    right: { type: "metric", metric: "industryPer" },
    params: {}
  };
}

export function defaultStrategyDefinition(): StrategyDefinition {
  return {
    id: "",
    name: "New Strategy",
    markets: ["us", "korea"],
    sectors: [],
    conditions: [defaultStrategyCondition()],
    active: true,
    created_at: "",
    updated_at: ""
  };
}
