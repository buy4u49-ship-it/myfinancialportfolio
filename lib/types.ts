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
