export type JsonRecord = Record<string, unknown>;

export type UserRecord = {
  username: string;
  created_at?: string;
  profile?: {
    display_name?: string;
    email?: string;
  };
  password_salt?: string;
  password_hash?: string;
  portfolio?: Position[];
  transactions?: PortfolioTransaction[];
  alerts?: PriceAlert[];
  remember_tokens?: unknown[];
  portfolio_calculation?: unknown;
};

export type Position = {
  symbol: string;
  quantity: number;
  avg_cost: number;
  cost_currency?: string;
  currency?: string;
  note?: string;
  created_at?: string;
  updated_at?: string;
};

export type Quote = {
  symbol: string;
  name?: string;
  sector?: string;
  industry?: string;
  price: number | null;
  previousClose: number | null;
  changePct: number | null;
  volume?: number | null;
  tradingValue?: number | null;
  currency: string;
  exchange: string;
  source: string;
  updatedAt: string;
};

export type PortfolioRow = {
  symbol: string;
  quantity: number;
  avgCost: number;
  currency: string;
  price: number | null;
  previousClose: number | null;
  changePct: number | null;
  marketValue: number | null;
  costBasis: number;
  gainLoss: number | null;
  gainLossPct: number | null;
  allocationPct: number | null;
  source: string;
  updatedAt: string;
};

export type PortfolioTransaction = {
  id: string;
  type: "BUY" | "SELL";
  symbol: string;
  quantity: number;
  price: number;
  currency: string;
  value: number;
  cost_basis?: number;
  realized_gain_loss?: number | null;
  created_at: string;
};

export type PortfolioSummary = {
  currentValue: number;
  costBasis: number;
  unrealizedGainLoss: number;
  totalReturnPct: number | null;
  realizedGainLoss: number;
  cumulativeGainLoss: number;
  cumulativeReturnPct: number | null;
  cumulativeInvestmentValue: number;
  totalBuyAmount: number;
  currency: string;
};

export type ChartPoint = {
  time: string;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  close: number;
  volume: number | null;
};

export type MacroPoint = {
  date: string;
  country: "United States" | "Korea" | "Europe" | "Japan" | "China";
  policyRatePct: number | null;
  m2: number | null;
};

export type MarketMoverRow = {
  symbol: string;
  price: number | null;
  changePct: number | null;
  volume: number | null;
  tradingValue: number | null;
  currency: string;
};

export type MarketPageResponse = {
  market: "crypto" | "us" | "korea";
  title: string;
  representative: {
    symbol: string;
    name: string;
    quote: Quote;
    chart: ChartPoint[];
  };
  indices: Quote[];
  macro: MacroPoint[];
  movers: {
    tradingValue: MarketMoverRow[];
    volume: MarketMoverRow[];
    gainers: MarketMoverRow[];
    losers: MarketMoverRow[];
  };
  refreshedAt: string;
};

export type SymbolDetailResponse = {
  symbol: string;
  quote: Quote;
  chart: ChartPoint[];
  profile: {
    name: string;
    sector: string;
    industry: string;
    country: string;
    website: string;
    summary: string;
  };
  metrics: {
    avgReturnPct: number | null;
    volatilityPct: number | null;
    high: number | null;
    low: number | null;
    volume: number | null;
  };
  peers: Quote[];
  benchmark: {
    symbol: string;
    historyYears: number;
    rollingWindowMonths: number;
    rollingBeta: number | null;
    fullPeriodBeta: number | null;
    industryRollingBeta: number | null;
    industryFullPeriodBeta: number | null;
    comparisons: FinancialRatioRow[];
    monthlyLogReturns: HistoricalMetricPoint[];
    monthlyRisk: HistoricalRiskPoint[];
  };
  statements: {
    income: FinancialStatement;
    balance: FinancialStatement;
    cashflow: FinancialStatement;
    ratios: FinancialRatioRow[];
    ratioPeerCount: number;
    ratioIndustry: string;
    dataSource: string;
    dataNotes: string[];
    mappingCandidates: FinancialStatementMappingCandidate[];
  };
  refreshedAt: string;
};

export type HistoricalMetricPoint = {
  time: string;
  value: number | null;
};

export type HistoricalRiskPoint = {
  time: string;
  monthlyVolatilityPct: number | null;
  rollingBeta: number | null;
};

export type FinancialLine = {
  key: string;
  label: string;
  values: Array<number | null>;
};

export type FinancialStatement = {
  columns: string[];
  lines: FinancialLine[];
};

export type FinancialRatioRow = {
  metric: string;
  company: string;
  industryAverage: string;
};

export type FinancialStatementMappingCandidate = {
  statement: string;
  statementDiv: string;
  accountId: string;
  accountName: string;
  sampleValue: string;
  years: string[];
};

export type PortfolioProjection = {
  portfolioBeta: number | null;
  betaCoveragePct: number | null;
  expectedMonthlyLogReturnPct: number | null;
  expectedPortfolioValue: number | null;
  expectedGainLoss: number | null;
  calculatedAt: string;
};

export type PriceAlert = {
  id: string;
  symbol: string;
  direction: "above" | "below";
  target_price: number;
  active: boolean;
  created_at: string;
  last_checked_at?: string;
  last_triggered_at?: string;
  last_price?: number | null;
  currency?: string;
};

export type TriggeredAlert = {
  id: string;
  symbol: string;
  direction: "above" | "below";
  target_price: number;
  price: number;
  currency: string;
};

export type PortfolioResponse = {
  user: {
    username: string;
    displayName: string;
    email: string;
  };
  rows: PortfolioRow[];
  transactions: PortfolioTransaction[];
  alerts: PriceAlert[];
  triggeredAlerts: TriggeredAlert[];
  summary: PortfolioSummary;
  projection: PortfolioProjection;
  refreshedAt: string;
};

export type TradeInput = {
  type: "BUY" | "SELL";
  symbol: string;
  quantity: number;
  price: number;
  currency?: string;
};
