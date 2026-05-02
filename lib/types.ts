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
  alerts?: unknown[];
  remember_tokens?: unknown[];
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
  price: number | null;
  previousClose: number | null;
  changePct: number | null;
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
  realizedGainLoss: number;
  cumulativeGainLoss: number;
  cumulativeReturnPct: number | null;
  totalBuyAmount: number;
  currency: string;
};

export type ChartPoint = {
  time: string;
  close: number;
  volume: number | null;
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
  statements: {
    income: FinancialStatement;
    balance: FinancialStatement;
    cashflow: FinancialStatement;
    ratios: FinancialRatioRow[];
    ratioPeerCount: number;
    ratioIndustry: string;
  };
  refreshedAt: string;
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

export type PortfolioResponse = {
  user: {
    username: string;
    displayName: string;
  };
  rows: PortfolioRow[];
  transactions: PortfolioTransaction[];
  summary: PortfolioSummary;
  refreshedAt: string;
};

export type TradeInput = {
  type: "BUY" | "SELL";
  symbol: string;
  quantity: number;
  price: number;
  currency?: string;
};
