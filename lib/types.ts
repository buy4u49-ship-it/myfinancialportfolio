export type JsonRecord = Record<string, unknown>;

export type PortfolioCashSettings = {
  includeCash: boolean;
  cashBalance: number;
  cashCurrency: string;
};

export type UserRecord = {
  username: string;
  created_at?: string;
  profile?: {
    display_name?: string;
    email?: string;
  };
  password_salt?: string;
  password_hash?: string;
  password_reset?: {
    token_hash: string;
    created_at: string;
    expires_at: string;
  };
  portfolio?: Position[];
  transactions?: PortfolioTransaction[];
  alerts?: PriceAlert[];
  push_tokens?: PushToken[];
  strategies?: StrategyDefinition[];
  strategy_snapshots?: StrategySnapshot[];
  remember_tokens?: unknown[];
  portfolio_calculation?: PortfolioCashSettings | JsonRecord | null;
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

export type PortfolioImportPosition = {
  symbol: string;
  name?: string;
  quantity: number;
  avgCost: number;
  currency: string;
  marketValue?: number | null;
  confidence?: number | null;
  note?: string;
};

export type PortfolioImportPreviewResponse = {
  brokerName?: string;
  accountLabel?: string;
  cashBalance?: number | null;
  cashCurrency?: string;
  positions: PortfolioImportPosition[];
  warnings: string[];
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
  securitiesCurrentValue: number;
  cashBalance: number;
  cashIncluded: boolean;
  cashCurrency: string;
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
    valuationHistory: ValuationHistoryPoint[];
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

export type ValuationHistoryPoint = {
  label: string;
  fiscalYear: number | null;
  companyPer: number | null;
  industryPer: number | null;
  companyRoe: number | null;
  industryRoe: number | null;
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

export type PushToken = {
  id: string;
  provider: "fcm_web";
  token: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  user_agent?: string;
  last_used_at?: string;
};

export type StrategyMarket = "us" | "korea" | "crypto";

export type StrategyConditionCategory = "price" | "volatility" | "volume" | "fundamental";

export type StrategyMetricKey =
  | "price"
  | "changePct"
  | "volume1m"
  | "tradingValue1m"
  | "oneMonthReturnPct"
  | "oneMonthVolatilityPct"
  | "companyEps"
  | "companyPer"
  | "companyPbr"
  | "industryAvgEps"
  | "industryAvgPer"
  | "industryAvgRoe"
  | "sectorAvgEps"
  | "sectorAvgPer"
  | "sectorAvgRoe"
  | "industryPer"
  | "companyRoe"
  | "companyRoa"
  | "companyNetMargin"
  | "companyOperatingMargin"
  | "companyEvEbitda"
  | "revenueGrowthPct"
  | "operatingIncomeGrowthPct"
  | "earningsGrowthPct"
  | "industryRoe"
  | "rollingBeta"
  | "industryRollingBeta"
  | "fullPeriodBeta"
  | "industryFullPeriodBeta"
  | "standardDeviationPct"
  | "movingAverageBreakoutUp"
  | "movingAverageBreakoutDown"
  | "goldenCross"
  | "deadCross"
  | "macdSignal"
  | "rsi"
  | "bollingerBandPosition"
  | "volumeSpike"
  | "volumeProfile"
  | "vwap"
  | "pointOfControl"
  | "valueAreaHigh"
  | "valueAreaLow"
  | "vwapAboveBelowVolumeRatio"
  | "volumeProfileSkew";

export type StrategyOperator = "<" | "<=" | "=" | ">=" | ">";

export type StrategyRightOperand =
  | {
      type: "metric";
      metric: StrategyMetricKey;
    }
  | {
      type: "number";
      value: number;
    };

export type StrategyCondition = {
  id: string;
  category?: StrategyConditionCategory;
  leftMetric: StrategyMetricKey;
  operator: StrategyOperator;
  right: StrategyRightOperand;
  params?: Record<string, number | string | boolean>;
};

export type StrategyDefinition = {
  id: string;
  name: string;
  markets: StrategyMarket[];
  sectors?: string[];
  conditions: StrategyCondition[];
  active: boolean;
  created_at: string;
  updated_at: string;
  last_evaluated_at?: string;
  last_match_count?: number;
};

export type StrategyMatch = {
  symbol: string;
  name: string;
  market: StrategyMarket;
  price: number | null;
  changePct: number | null;
  metrics: Partial<Record<StrategyMetricKey, number | null>>;
  reasons: string[];
};

export type StrategyEvaluation = {
  strategy: StrategyDefinition;
  matches: StrategyMatch[];
  evaluatedAt: string;
  errors: Array<{ symbol: string; message: string }>;
  universeCount?: number;
  cachedCount?: number;
  staleCount?: number;
  priceCachedCount?: number;
  priceMissingCount?: number;
  cacheRefreshedAt?: string;
  batchOffset?: number;
  batchLimit?: number;
  batchEvaluatedCount?: number;
  batchNextOffset?: number | null;
  isPartial?: boolean;
};

export type StrategyMetricSnapshot = {
  symbol: string;
  market: StrategyMarket;
  name: string;
  sector: string;
  industry: string;
  price: number | null;
  changePct: number | null;
  metrics: Partial<Record<StrategyMetricKey, number | null>>;
  technical?: {
    daily: Array<{
      time: string;
      close: number;
      volume: number | null;
    }>;
  };
  source: string;
  refreshedAt: string;
};

export type FinancialFundamentalSnapshot = {
  symbol: string;
  market: StrategyMarket;
  name: string;
  sector: string;
  industry: string;
  currency: string;
  fiscalYear: number | null;
  eps: number | null;
  roePct: number | null;
  roaPct?: number | null;
  netMarginPct?: number | null;
  operatingMarginPct?: number | null;
  revenueGrowthPct?: number | null;
  operatingIncomeGrowthPct?: number | null;
  earningsGrowthPct?: number | null;
  revenue?: number | null;
  operatingIncome?: number | null;
  netIncome: number | null;
  totalAssets?: number | null;
  averageAssets?: number | null;
  totalEquity?: number | null;
  averageEquity: number | null;
  marketCap?: number | null;
  sharesOutstanding?: number | null;
  bookValuePerShare?: number | null;
  ebitda?: number | null;
  totalDebt?: number | null;
  cashAndShortInvestments?: number | null;
  fundamentalType?: string | null;
  epsUnavailableReason?: string | null;
  priceAtRefresh: number | null;
  source: string;
  refreshedAt: string;
};

export type StrategySnapshot = {
  strategy_id: string;
  symbols: string[];
  updated_at: string;
};

export type PortfolioResponse = {
  user: {
    username: string;
    displayName: string;
    email: string;
    isAdmin?: boolean;
  };
  rows: PortfolioRow[];
  transactions: PortfolioTransaction[];
  alerts: PriceAlert[];
  triggeredAlerts: TriggeredAlert[];
  pushEnabled: boolean;
  pushTokenCount: number;
  strategies: StrategyDefinition[];
  cashSettings: PortfolioCashSettings;
  summary: PortfolioSummary;
  projection: PortfolioProjection;
  refreshedAt: string;
};

export type AdminUserSummary = {
  username: string;
  displayName: string;
  email: string;
  createdAt: string;
  positionCount: number;
  transactionCount: number;
  alertCount: number;
};

export type AdminManagedPosition = {
  index: number;
  symbol: string;
  quantity: number;
  avgCost: number;
  currency: string;
};

export type AdminResponse = {
  isAdmin: true;
  users: AdminUserSummary[];
  selectedUsername: string | null;
  selectedUser: PortfolioResponse | null;
  selectedPositions: AdminManagedPosition[];
  refreshedAt: string;
};

export type TradeInput = {
  type: "BUY" | "SELL";
  symbol: string;
  quantity: number;
  price: number;
  currency?: string;
  sellAll?: boolean;
};
