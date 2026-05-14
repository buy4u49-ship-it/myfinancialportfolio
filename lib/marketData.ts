import { cryptoBaseSymbol, isCryptoSymbol, isKoreaSymbol, marketDataSymbol, normalizeSymbol } from "./symbols";
import { getQuote, getQuotes } from "./prices";
import { supabaseAdmin } from "./supabaseAdmin";
import { getUpbitKrwSymbols, isUpbitKrwSymbol } from "./upbitMarkets";
import type {
  ChartPoint,
  FinancialFundamentalSnapshot,
  FinancialRatioRow,
  FinancialStatement,
  FinancialStatementMappingCandidate,
  MacroPoint,
  MarketMoverRow,
  MarketPageResponse,
  Quote,
  StrategyMarket,
  SymbolDetailResponse,
  ValuationHistoryPoint
} from "./types";
import { inflateRawSync } from "node:zlib";

type MarketKey = "crypto" | "us" | "korea";
export type ChartRange = "1D" | "1W" | "1M" | "1Y" | "YTD";
type RatioValues = {
  eps: number | null;
  per: number | null;
  netMargin: number | null;
  operatingMargin: number | null;
  roe: number | null;
  roa: number | null;
  revenueGrowth: number | null;
  operatingIncomeGrowth: number | null;
  earningsGrowth: number | null;
  bookValuePerShare: number | null;
  sharesOutstanding: number | null;
  ebitda: number | null;
  totalDebt: number | null;
  cashAndShortInvestments: number | null;
  revenue: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  totalAssets: number | null;
  averageAssets: number | null;
  totalEquity: number | null;
  averageEquity: number | null;
};
type PeriodRatioValues = RatioValues & { fiscalYear: number | null };
type MonthlyReturnPoint = { time: string; month: string; value: number };
type BenchmarkAnalyticsResult = {
  symbol: string;
  historyYears: number;
  rollingWindowMonths: number;
  rollingBeta: number | null;
  fullPeriodBeta: number | null;
  industryRollingBeta: number | null;
  industryFullPeriodBeta: number | null;
  monthlyLogReturns: Array<{ time: string; value: number | null }>;
  monthlyRisk: Array<{ time: string; monthlyVolatilityPct: number | null; rollingBeta: number | null }>;
};
type KoreaFinancialPayload = {
  source: "opendart";
  symbol: string;
  mappingVersion: number;
  mappingSignature: string;
  refreshedAt: string;
  ratioValues: RatioValues;
  ratioHistory?: PeriodRatioValues[];
  statements: {
    income: FinancialStatement;
    balance: FinancialStatement;
    cashflow: FinancialStatement;
  };
  mappingCandidates: FinancialStatementMappingCandidate[];
};
type SavedOpenDartMapping = {
  sjDiv: string;
  accountId: string;
  accountName: string;
  lineKey: string;
  updatedAt?: string;
};

const FINANCIAL_STATEMENT_CACHE_TABLE = "financial_statement_cache";
const FINANCIAL_MAPPING_CACHE_SYMBOL = "__opendart_account_mappings__";
const FINANCIAL_STATEMENT_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const KOREA_FINANCIAL_MAPPING_VERSION = 4;
const MONTHLY_VOLATILITY_WINDOW_MONTHS = 12;
const OPENDART_ANNUAL_REPORT_CODE = "11011";

const KOREA_DART_CORP_CODES: Record<string, string> = {
  "005930.KS": "00126380",
  "000660.KS": "00164779",
  "373220.KS": "01515323",
  "207940.KS": "00877059",
  "005380.KS": "00164742",
  "000270.KS": "00106641",
  "068270.KS": "00413046",
  "035420.KS": "00266961",
  "105560.KS": "00688996",
  "012450.KS": "00126566",
  "035720.KS": "00258801",
  "066570.KS": "00401731",
  "012330.KS": "00164788",
  "055550.KS": "00382199",
  "032830.KS": "00126256"
};
let openDartCorpCodeCache: Map<string, string> | null = null;

const MARKET_CONFIG: Record<
  MarketKey,
  {
    title: string;
    representative: string;
    representativeName: string;
    indices: string[];
    universe: string[];
  }
> = {
  crypto: {
    title: "Coin Main",
    representative: "BTC-KRW",
    representativeName: "Bitcoin (BTC-KRW)",
    indices: ["BTC-KRW", "ETH-KRW", "SOL-KRW", "BNB-KRW"],
    universe: [
      "BTC-KRW",
      "ETH-KRW",
      "SOL-KRW",
      "XRP-KRW",
      "BNB-KRW",
      "DOGE-KRW",
      "TRX-KRW",
      "ADA-KRW",
      "XLM-KRW",
      "BCH-KRW",
      "HBAR-KRW",
      "LTC-KRW",
      "DOT-KRW",
      "BGB-KRW",
      "XMR-KRW",
      "UNI-KRW",
      "PEPE-KRW",
      "APT-KRW",
      "NEAR-KRW",
      "ICP-KRW",
      "ETC-KRW",
      "LINK-KRW",
      "AVAX-KRW",
      "ONDO-KRW",
      "AAVE-KRW",
      "ARB-KRW",
      "POL-KRW",
      "VET-KRW",
      "ATOM-KRW",
      "FIL-KRW",
      "RENDER-KRW",
      "ALGO-KRW",
      "KAS-KRW",
      "FET-KRW",
      "OP-KRW",
      "WLD-KRW",
      "SUI-KRW"
    ]
  },
  us: {
    title: "US Stock Main",
    representative: "^GSPC",
    representativeName: "S&P 500 Index (^GSPC)",
    indices: ["^GSPC", "^IXIC", "^DJI", "^RUT", "^VIX"],
    universe: ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "AVGO", "LLY", "JPM", "UNH", "V", "SPY", "QQQ"]
  },
  korea: {
    title: "Korea Stock Main",
    representative: "^KS11",
    representativeName: "KOSPI Composite Index (^KS11)",
    indices: ["^KS11", "^KQ11", "005930.KS", "000660.KS"],
    universe: [
      "005930.KS",
      "000660.KS",
      "373220.KS",
      "207940.KS",
      "005380.KS",
      "000270.KS",
      "068270.KS",
      "035420.KS",
      "105560.KS",
      "012450.KS"
    ]
  }
};

const SECTOR_PEERS: Record<string, string[]> = {
  Technology: ["MSFT", "NVDA", "AAPL", "AVGO", "AMD", "CRM", "ADBE", "NOW"],
  "Communication Services": ["GOOGL", "META", "NFLX", "DIS", "TMUS", "SPOT"],
  "Consumer Cyclical": ["AMZN", "TSLA", "HD", "NKE", "MCD", "BKNG"],
  "Consumer Defensive": ["WMT", "COST", "PG", "KO", "PEP", "PM"],
  "Financial Services": ["JPM", "BAC", "V", "MA", "GS", "MS"],
  Healthcare: ["LLY", "UNH", "JNJ", "MRK", "ABBV", "TMO"],
  Industrials: ["GE", "CAT", "HON", "RTX", "UPS", "BA"],
  Energy: ["XOM", "CVX", "COP", "SLB", "EOG", "MPC"],
  "Basic Materials": ["LIN", "APD", "SHW", "FCX", "NEM", "NUE"],
  "Real Estate": ["PLD", "AMT", "EQIX", "WELL", "SPG", "O"],
  Utilities: ["NEE", "SO", "DUK", "AEP", "SRE", "D"],
  ETF: ["SPY", "VOO", "QQQ"],
  "Korea Technology": ["005930.KS", "000660.KS", "035420.KS", "035720.KS", "066570.KS"],
  "Korea Healthcare": ["207940.KS", "068270.KS"],
  "Korea Consumer Cyclical": ["005380.KS", "000270.KS", "012330.KS"],
  "Korea Financial Services": ["105560.KS", "055550.KS", "032830.KS"],
  "Korea Industrials": ["373220.KS", "012450.KS"],
  crypto: ["BTC-KRW", "ETH-KRW", "SOL-KRW", "XRP-KRW", "LINK-KRW"]
};

const KOREA_SECTOR_PEERS: Record<string, string[]> = {
  Technology: ["005930.KS", "000660.KS", "035420.KS", "035720.KS", "066570.KS"],
  Healthcare: ["207940.KS", "068270.KS"],
  "Consumer Cyclical": ["005380.KS", "000270.KS", "012330.KS"],
  "Financial Services": ["105560.KS", "055550.KS", "032830.KS"],
  Industrials: ["373220.KS", "012450.KS"]
};

const PROFILE_FALLBACKS: Record<string, { name: string; sector: string; industry: string; country: string; website: string; summary: string }> = {
  AAPL: {
    name: "Apple Inc.",
    sector: "Technology",
    industry: "Consumer Electronics",
    country: "United States",
    website: "https://www.apple.com",
    summary: "Apple designs consumer electronics, software, and services including iPhone, Mac, iPad, wearables, and digital platforms."
  },
  AVGO: {
    name: "Broadcom Inc.",
    sector: "Technology",
    industry: "Semiconductors",
    country: "United States",
    website: "https://www.broadcom.com",
    summary: "Broadcom designs semiconductor and infrastructure software products for networking, broadband, wireless, storage, and enterprise markets."
  },
  CRWV: {
    name: "CoreWeave, Inc.",
    sector: "Technology",
    industry: "Cloud Infrastructure",
    country: "United States",
    website: "https://www.coreweave.com",
    summary: "CoreWeave provides cloud infrastructure focused on accelerated computing workloads, including artificial intelligence and high-performance computing."
  },
  MSFT: {
    name: "Microsoft Corporation",
    sector: "Technology",
    industry: "Software - Infrastructure",
    country: "United States",
    website: "https://www.microsoft.com",
    summary: "Microsoft develops software, cloud services, devices, gaming platforms, and productivity applications."
  },
  NVDA: {
    name: "NVIDIA Corporation",
    sector: "Technology",
    industry: "Semiconductors",
    country: "United States",
    website: "https://www.nvidia.com",
    summary: "NVIDIA designs GPUs, accelerated computing platforms, networking products, and AI software infrastructure."
  },
  SPY: {
    name: "SPDR S&P 500 ETF Trust",
    sector: "ETF",
    industry: "Exchange Traded Fund",
    country: "United States",
    website: "https://www.ssga.com",
    summary: "SPY is an exchange-traded fund designed to track the S&P 500 Index."
  },
  VOO: {
    name: "Vanguard S&P 500 ETF",
    sector: "ETF",
    industry: "Exchange Traded Fund",
    country: "United States",
    website: "https://investor.vanguard.com",
    summary: "VOO is an exchange-traded fund designed to track the S&P 500 Index."
  },
  QQQ: {
    name: "Invesco QQQ Trust",
    sector: "ETF",
    industry: "Exchange Traded Fund",
    country: "United States",
    website: "https://www.invesco.com",
    summary: "QQQ is an exchange-traded fund designed to track the Nasdaq-100 Index."
  },
  "005930.KS": {
    name: "Samsung Electronics Co., Ltd.",
    sector: "Korea Technology",
    industry: "Consumer Electronics and Semiconductors",
    country: "South Korea",
    website: "https://www.samsung.com",
    summary: "Samsung Electronics produces memory chips, displays, mobile devices, appliances, and consumer electronics."
  },
  "000660.KS": {
    name: "SK hynix Inc.",
    sector: "Korea Technology",
    industry: "Semiconductors",
    country: "South Korea",
    website: "https://www.skhynix.com",
    summary: "SK hynix manufactures memory semiconductors including DRAM and NAND flash products."
  }
};

const SECTOR_DEFAULT_INDUSTRIES: Record<string, string> = {
  Technology: "Technology Hardware, Software, and Semiconductors",
  "Communication Services": "Media, Internet, and Telecommunications",
  "Consumer Cyclical": "Consumer Discretionary",
  "Consumer Defensive": "Consumer Staples",
  "Financial Services": "Banks, Payments, and Capital Markets",
  Healthcare: "Pharmaceuticals, Healthcare Equipment, and Services",
  Industrials: "Capital Goods, Transportation, and Aerospace",
  Energy: "Oil, Gas, and Energy Services",
  "Basic Materials": "Chemicals, Metals, and Materials",
  "Real Estate": "REITs and Real Estate Services",
  Utilities: "Regulated Electric, Gas, and Water Utilities",
  ETF: "Exchange Traded Fund"
};

function fallbackProfile(symbol: string, summaryProfile: Record<string, unknown>, priceModule: Record<string, unknown>) {
  const fallback = PROFILE_FALLBACKS[symbol] || PROFILE_FALLBACKS[marketDataSymbol(symbol)] || {};
  const providerSymbol = marketDataSymbol(symbol);
  const watchlists = isKoreaSymbol(providerSymbol) ? KOREA_SECTOR_PEERS : SECTOR_PEERS;
  const sectorFromWatchlist =
    Object.entries(watchlists).find(([, peers]) => peers.includes(symbol) || peers.includes(providerSymbol))?.[0] || "";
  const sector = String(summaryProfile.sector || fallback.sector || sectorFromWatchlist || (isCryptoSymbol(symbol) ? "crypto" : ""));
  return {
    name: String(rawValue(priceModule.longName) || rawValue(priceModule.shortName) || fallback.name || symbol),
    sector,
    industry: String(summaryProfile.industry || fallback.industry || SECTOR_DEFAULT_INDUSTRIES[sector] || ""),
    country: String(summaryProfile.country || fallback.country || (isKoreaSymbol(providerSymbol) ? "South Korea" : sector && !isCryptoSymbol(symbol) ? "United States" : "")),
    website: String(summaryProfile.website || fallback.website || ""),
    summary: String(summaryProfile.longBusinessSummary || fallback.summary || "")
  };
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function positiveNumberOrNull(value: unknown) {
  const num = numberOrNull(value);
  return num !== null && num > 0 ? num : null;
}

function nonZeroNumberOrNull(value: unknown) {
  const num = numberOrNull(value);
  return num !== null && num !== 0 ? num : null;
}

function growthRate(current: number | null, previous: number | null) {
  if (current === null || previous === null || previous === 0) {
    return null;
  }
  return current / previous - 1;
}

function ratioPct(numerator: number | null, denominator: number | null) {
  if (numerator === null || denominator === null || denominator === 0) {
    return null;
  }
  return (numerator / denominator) * 100;
}

function epsNumberOrNull(value: unknown) {
  const eps = numberOrNull(value);
  return eps === 0 ? null : eps;
}

function quoteToMover(quote: Quote): MarketMoverRow {
  return {
    symbol: quote.symbol,
    price: quote.price,
    changePct: quote.changePct,
    volume: quote.volume ?? null,
    tradingValue: quote.tradingValue ?? (quote.volume && quote.price ? quote.volume * quote.price : null),
    currency: quote.currency
  };
}

function sortTop(rows: MarketMoverRow[], key: keyof MarketMoverRow, direction: "asc" | "desc" = "desc") {
  return [...rows]
    .filter((row) => Number.isFinite(Number(row[key])))
    .sort((a, b) => {
      const delta = Number(a[key]) - Number(b[key]);
      return direction === "asc" ? delta : -delta;
    })
    .slice(0, 10);
}

function yahooChartSettings(range: ChartRange) {
  return {
    "1D": ["1d", "5m"],
    "1W": ["7d", "30m"],
    "1M": ["1mo", "4h"],
    "1Y": ["1y", "1d"],
    "YTD": ["ytd", "1d"]
  }[range] as [string, string];
}

async function fetchYahooChart(symbol: string, range: ChartRange = "1M"): Promise<ChartPoint[]> {
  const [period, interval] = yahooChartSettings(range);
  const providerSymbol = marketDataSymbol(symbol);
  const response = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(providerSymbol)}?range=${period}&interval=${interval}`,
    {
      headers: { accept: "application/json", "user-agent": "myfinancialportfolio-next/1.0" },
      next: { revalidate: 30 }
    }
  );
  if (!response.ok) {
    return [];
  }
  const payload = (await response.json()) as {
    chart?: {
      result?: Array<{
        timestamp?: number[];
        indicators?: {
          quote?: Array<{
            open?: Array<number | null>;
            high?: Array<number | null>;
            low?: Array<number | null>;
            close?: Array<number | null>;
            volume?: Array<number | null>;
          }>;
        };
      }>;
    };
  };
  const result = payload.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const quote = result?.indicators?.quote?.[0];
  const opens = quote?.open || [];
  const highs = quote?.high || [];
  const lows = quote?.low || [];
  const closes = quote?.close || [];
  const volumes = quote?.volume || [];
  return timestamps
    .map((timestamp, index): ChartPoint | null => {
      const open = numberOrNull(opens[index]);
      const high = numberOrNull(highs[index]);
      const low = numberOrNull(lows[index]);
      const close = numberOrNull(closes[index]);
      if (
        close === null ||
        close <= 0 ||
        (open !== null && open <= 0) ||
        (high !== null && high <= 0) ||
        (low !== null && low <= 0)
      ) {
        return null;
      }
      return {
        time: new Date(timestamp * 1000).toISOString(),
        open,
        high,
        low,
        close,
        volume: numberOrNull(volumes[index])
      };
    })
    .filter((point): point is ChartPoint => point !== null);
}

function upbitChartSettings(range: ChartRange) {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const ytdDays = Math.max(1, Math.min(200, Math.ceil((now.getTime() - startOfYear.getTime()) / 86_400_000) + 1));
  return {
    "1D": ["minutes/5", 200],
    "1W": ["minutes/60", 168],
    "1M": ["days", 31],
    "1Y": ["days", 200],
    "YTD": ["days", ytdDays]
  }[range] as [string, number];
}

async function fetchUpbitChart(symbol: string, range: ChartRange = "1M"): Promise<ChartPoint[]> {
  const base = cryptoBaseSymbol(symbol);
  if (!(await isUpbitKrwSymbol(`${base}-KRW`))) {
    return [];
  }
  const [path, count] = upbitChartSettings(range);
  const response = await fetch(`https://api.upbit.com/v1/candles/${path}?market=KRW-${encodeURIComponent(base)}&count=${count}`, {
    headers: { accept: "application/json" },
    cache: "no-store"
  });
  if (!response.ok) {
    return [];
  }
  const rows = (await response.json()) as Array<Record<string, unknown>>;
  return rows
    .map((row): ChartPoint | null => {
      const open = numberOrNull(row.opening_price);
      const high = numberOrNull(row.high_price);
      const low = numberOrNull(row.low_price);
      const close = numberOrNull(row.trade_price);
      const time = String(row.candle_date_time_kst || row.candle_date_time_utc || "");
      if (!time || close === null || close <= 0 || (open !== null && open <= 0) || (high !== null && high <= 0) || (low !== null && low <= 0)) {
        return null;
      }
      return {
        time,
        open,
        high,
        low,
        close,
        volume: numberOrNull(row.candle_acc_trade_volume)
      };
    })
    .filter((point): point is ChartPoint => point !== null)
    .reverse();
}

export async function fetchChart(symbol: string, range: ChartRange = "1M") {
  const normalized = normalizeSymbol(symbol);
  if (isCryptoSymbol(normalized) && normalized.endsWith("-KRW")) {
    const upbit = await fetchUpbitChart(normalized, range);
    if (upbit.length) {
      return upbit;
    }
  }
  return fetchYahooChart(normalized, range);
}

async function fetchYahooHistoricalMonthlyChart(symbol: string, years: number): Promise<ChartPoint[]> {
  const providerSymbol = marketDataSymbol(symbol);
  const safeYears = Math.max(1, Math.min(20, Math.round(years)));
  try {
    const response = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(providerSymbol)}?range=${safeYears}y&interval=1mo`,
      {
        headers: { accept: "application/json", "user-agent": "myfinancialportfolio-next/1.0" },
        next: { revalidate: 86_400 }
      }
    );
    if (!response.ok) {
      return [];
    }
    const payload = (await response.json()) as {
      chart?: {
        result?: Array<{
          timestamp?: number[];
          indicators?: { quote?: Array<{ close?: Array<number | null>; volume?: Array<number | null> }> };
        }>;
      };
    };
    const result = payload.chart?.result?.[0];
    const timestamps = result?.timestamp || [];
    const quote = result?.indicators?.quote?.[0];
    const closes = quote?.close || [];
    const volumes = quote?.volume || [];
    return timestamps
      .map((timestamp, index): ChartPoint | null => {
        const close = numberOrNull(closes[index]);
        if (close === null || close <= 0) {
          return null;
        }
        return {
          time: new Date(timestamp * 1000).toISOString(),
          close,
          volume: numberOrNull(volumes[index])
        };
      })
      .filter((point): point is ChartPoint => point !== null);
  } catch {
    return [];
  }
}

function monthKey(time: string) {
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) {
    return time.slice(0, 7);
  }
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthlyReturnPoints(points: ChartPoint[]): MonthlyReturnPoint[] {
  return points
    .slice()
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
    .reduce<MonthlyReturnPoint[]>((returns, point, index, sorted) => {
      if (index === 0) {
        return returns;
      }
      const previous = sorted[index - 1]?.close;
      if (!previous || previous <= 0 || point.close <= 0) {
        return returns;
      }
      returns.push({
        time: point.time,
        month: monthKey(point.time),
        value: Math.log(point.close / previous)
      });
      return returns;
    }, []);
}

function sampleVariance(values: number[]) {
  if (values.length < 2) {
    return null;
  }
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1);
}

function covariance(valuesA: number[], valuesB: number[]) {
  if (valuesA.length !== valuesB.length || valuesA.length < 2) {
    return null;
  }
  const avgA = valuesA.reduce((sum, value) => sum + value, 0) / valuesA.length;
  const avgB = valuesB.reduce((sum, value) => sum + value, 0) / valuesB.length;
  return valuesA.reduce((sum, value, index) => sum + (value - avgA) * (valuesB[index] - avgB), 0) / (valuesA.length - 1);
}

function betaFromReturns(assetReturns: number[], benchmarkReturns: number[]) {
  const benchmarkVariance = sampleVariance(benchmarkReturns);
  const cov = covariance(assetReturns, benchmarkReturns);
  if (benchmarkVariance === null || benchmarkVariance === 0 || cov === null) {
    return null;
  }
  return cov / benchmarkVariance;
}

function alignReturns(assetReturns: MonthlyReturnPoint[], benchmarkReturns: MonthlyReturnPoint[]) {
  const benchmarkByMonth = new Map(benchmarkReturns.map((point) => [point.month, point]));
  return assetReturns
    .map((asset) => {
      const benchmark = benchmarkByMonth.get(asset.month);
      return benchmark ? { time: asset.time, month: asset.month, asset: asset.value, benchmark: benchmark.value } : null;
    })
    .filter((point): point is { time: string; month: string; asset: number; benchmark: number } => point !== null);
}

function monthlyRiskSeries(assetReturns: MonthlyReturnPoint[], benchmarkReturns: MonthlyReturnPoint[], rollingWindowMonths: number) {
  const aligned = alignReturns(assetReturns, benchmarkReturns);
  const betaWindowSize = Math.max(6, Math.min(60, Math.round(rollingWindowMonths)));
  return aligned.map((point, index) => {
    const betaWindow = aligned.slice(Math.max(0, index - betaWindowSize + 1), index + 1);
    const volatilityWindow = aligned.slice(Math.max(0, index - MONTHLY_VOLATILITY_WINDOW_MONTHS + 1), index + 1);
    const assetBetaWindow = betaWindow.map((item) => item.asset);
    const benchmarkWindow = betaWindow.map((item) => item.benchmark);
    const volatilityVariance =
      volatilityWindow.length >= 2 ? sampleVariance(volatilityWindow.map((item) => item.asset)) : null;
    return {
      time: point.time,
      monthlyVolatilityPct: volatilityVariance === null ? null : Math.sqrt(volatilityVariance) * 100,
      rollingBeta: betaWindow.length >= betaWindowSize ? betaFromReturns(assetBetaWindow, benchmarkWindow) : null
    };
  });
}

function fullPeriodBeta(assetReturns: MonthlyReturnPoint[], benchmarkReturns: MonthlyReturnPoint[]) {
  const aligned = alignReturns(assetReturns, benchmarkReturns);
  return betaFromReturns(
    aligned.map((point) => point.asset),
    aligned.map((point) => point.benchmark)
  );
}

function lastFinite(values: Array<number | null>) {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index];
    if (value !== null && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

async function benchmarkAnalytics(
  symbol: string,
  benchmarkSymbol: string,
  historyYears: number,
  rollingWindowMonths: number,
  peerSymbols: string[]
): Promise<BenchmarkAnalyticsResult> {
  const normalizedBenchmark = normalizeSymbol(benchmarkSymbol || "SPY");
  const safeYears = Math.max(1, Math.min(20, Math.round(historyYears || 20)));
  const safeWindow = Math.max(6, Math.min(60, Math.round(rollingWindowMonths || 36)));
  const [assetHistory, benchmarkHistory] = await Promise.all([
    fetchYahooHistoricalMonthlyChart(symbol, safeYears),
    fetchYahooHistoricalMonthlyChart(normalizedBenchmark, safeYears)
  ]);
  const assetReturns = monthlyReturnPoints(assetHistory);
  const benchmarkReturns = monthlyReturnPoints(benchmarkHistory);
  const monthlyRisk = monthlyRiskSeries(assetReturns, benchmarkReturns, safeWindow);
  const peerBetas = await Promise.all(
    peerSymbols.slice(0, 5).map(async (peer) => {
      const peerReturns = monthlyReturnPoints(await fetchYahooHistoricalMonthlyChart(peer, safeYears));
      const peerRisk = monthlyRiskSeries(peerReturns, benchmarkReturns, safeWindow);
      return {
        rollingBeta: lastFinite(peerRisk.map((point) => point.rollingBeta)),
        fullPeriodBeta: fullPeriodBeta(peerReturns, benchmarkReturns)
      };
    })
  );
  return {
    symbol: normalizedBenchmark,
    historyYears: safeYears,
    rollingWindowMonths: safeWindow,
    rollingBeta: lastFinite(monthlyRisk.map((point) => point.rollingBeta)),
    fullPeriodBeta: fullPeriodBeta(assetReturns, benchmarkReturns),
    industryRollingBeta: average(peerBetas.map((peer) => peer.rollingBeta)),
    industryFullPeriodBeta: average(peerBetas.map((peer) => peer.fullPeriodBeta)),
    monthlyLogReturns: assetReturns.map((point) => ({ time: point.time, value: point.value * 100 })),
    monthlyRisk
  };
}

const MACRO_COUNTRIES: MacroPoint["country"][] = ["United States", "Korea", "Europe", "Japan", "China"];

const MACRO_ANCHORS: Record<MacroPoint["country"], { rate: number[]; m2: number[] }> = {
  "United States": {
    rate: [0.08, 0.33, 4.75, 5.33, 4.9, 4.35],
    m2: [19_300, 21_600, 21_200, 20_900, 21_400, 21_900]
  },
  Korea: {
    rate: [0.5, 1.25, 3.5, 3.5, 3.0, 2.5],
    m2: [2_355, 2_645, 2_790, 2_949, 3_152, 3_308]
  },
  Europe: {
    rate: [0, 0, 2.5, 4.0, 3.15, 2.15],
    m2: [15_822, 17_010, 17_442, 17_334, 17_464, 17_545]
  },
  Japan: {
    rate: [-0.1, -0.1, -0.1, 0.1, 0.5, 0.75],
    m2: [7_516, 7_774, 7_903, 8_013, 8_161, 8_226]
  },
  China: {
    rate: [3.85, 3.7, 3.45, 3.45, 3.1, 3.0],
    m2: [30_069, 32_828, 36_690, 40_276, 43_448, 48_828]
  }
};

function buildMacroSeries(): MacroPoint[] {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 6 }, (_, index) => currentYear - 5 + index);
  return MACRO_COUNTRIES.flatMap((country) =>
    years.map((year, index) => ({
      date: `${year}-01-01`,
      country,
      policyRatePct: MACRO_ANCHORS[country].rate[index] ?? null,
      m2: MACRO_ANCHORS[country].m2[index] ?? null
    }))
  );
}

export async function buildMarketPage(market: MarketKey, range: ChartRange = "1D"): Promise<MarketPageResponse> {
  const config = MARKET_CONFIG[market];
  const universe = market === "crypto" ? await getUpbitKrwSymbols() : config.universe;
  const quoteMap = await getQuotes(Array.from(new Set([...config.indices, ...universe, config.representative])));
  const representativeQuote = quoteMap.get(config.representative) || (await getQuote(config.representative));
  const moverRows = universe.map((symbol) => quoteToMover(quoteMap.get(symbol) || { ...representativeQuote, symbol }));

  return {
    market,
    title: config.title,
    representative: {
      symbol: config.representative,
      name: config.representativeName,
      quote: representativeQuote,
      chart: await fetchChart(config.representative, range)
    },
    indices: config.indices.map((symbol) => quoteMap.get(symbol)).filter((quote): quote is Quote => Boolean(quote)),
    macro: buildMacroSeries(),
    movers: {
      tradingValue: sortTop(moverRows, "tradingValue"),
      volume: sortTop(moverRows, "volume"),
      gainers: sortTop(moverRows, "changePct"),
      losers: sortTop(
        moverRows.filter((row) => (row.changePct ?? 0) < 0),
        "changePct",
        "asc"
      )
    },
    refreshedAt: new Date().toISOString()
  };
}

async function fetchYahooSummary(symbol: string) {
  const providerSymbol = marketDataSymbol(symbol);
  try {
    const response = await fetch(
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(
        providerSymbol
      )}?formatted=false&lang=en-US&region=US&modules=assetProfile,summaryProfile,price,financialData,defaultKeyStatistics,incomeStatementHistory,incomeStatementHistoryQuarterly,balanceSheetHistory,balanceSheetHistoryQuarterly,cashflowStatementHistory,cashflowStatementHistoryQuarterly`,
      {
        headers: { accept: "application/json", "user-agent": "myfinancialportfolio-next/1.0" },
        next: { revalidate: 86400 }
      }
    );
    if (!response.ok) {
      return {};
    }
    const payload = (await response.json()) as {
      quoteSummary?: { result?: Array<Record<string, unknown>> };
    };
    return payload.quoteSummary?.result?.[0] || {};
  } catch {
    return {};
  }
}

function rawValue(item: unknown) {
  if (item && typeof item === "object" && "raw" in item) {
    return (item as { raw?: unknown }).raw;
  }
  return item;
}

type LineDefinition = {
  key: string;
  label: string;
  fields: string[];
};

const BALANCE_LINES: LineDefinition[] = [
  { key: "total_assets", label: "Total Assets", fields: ["totalAssets"] },
  { key: "current_assets", label: "Total Current Assets", fields: ["totalCurrentAssets"] },
  {
    key: "cash_short_investments",
    label: "Cash & Short-term Investments",
    fields: ["cashCashEquivalentsAndShortTermInvestments", "cashAndCashEquivalents", "cash", "shortTermInvestments"]
  },
  { key: "receivables", label: "Total Receivables", fields: ["netReceivables", "accountsReceivable"] },
  { key: "inventory", label: "Inventories", fields: ["inventory"] },
  { key: "prepaid", label: "Prepaid Expenses", fields: ["prepaidAssets", "prepaidExpense"] },
  { key: "other_current_assets", label: "Other Current Assets", fields: ["otherCurrentAssets"] },
  { key: "noncurrent_assets", label: "Total Non-current Assets", fields: ["totalNonCurrentAssets", "nonCurrentAssetsTotal"] },
  { key: "long_term_investments", label: "Long-term Investments", fields: ["longTermInvestments", "investmentInFinancialAssets", "investmentsAndAdvances"] },
  { key: "ppe", label: "Property, Plant & Equipment", fields: ["propertyPlantEquipment", "netPPE", "grossPPE"] },
  { key: "intangibles", label: "Intangible Assets", fields: ["intangibleAssets", "goodWill", "goodwill"] },
  { key: "deferred_assets", label: "Deferred Assets", fields: ["deferredLongTermAssetCharges", "deferredTaxAssets"] },
  { key: "other_noncurrent_assets", label: "Other Non-current Assets", fields: ["otherAssets", "otherNonCurrentAssets"] },
  { key: "total_liabilities", label: "Total Liabilities", fields: ["totalLiab", "totalLiabilitiesNetMinorityInterest"] },
  { key: "current_liabilities", label: "Total Current Liabilities", fields: ["totalCurrentLiabilities", "currentLiabilities"] },
  { key: "accounts_payable", label: "Accounts Payable", fields: ["accountsPayable"] },
  { key: "short_term_debt", label: "Short-term Debt", fields: ["shortLongTermDebt", "shortTermDebt"] },
  { key: "other_current_liabilities", label: "Other Current Liabilities", fields: ["otherCurrentLiab", "otherCurrentLiabilities"] },
  { key: "noncurrent_liabilities", label: "Total Non-current Liabilities", fields: ["totalNonCurrentLiabilitiesNetMinorityInterest", "nonCurrentLiabilitiesTotal"] },
  { key: "long_term_debt", label: "Long-term Debt", fields: ["longTermDebt", "longTermDebtAndCapitalLeaseObligation"] },
  { key: "other_liabilities", label: "Other Liabilities", fields: ["otherLiab", "otherNonCurrentLiabilities"] },
  { key: "total_equity", label: "Total Equity", fields: ["totalStockholderEquity", "stockholdersEquity", "totalEquityGrossMinorityInterest"] },
  { key: "common_stock", label: "Common Stock", fields: ["commonStock"] },
  { key: "capital_surplus", label: "Capital Surplus", fields: ["capitalSurplus"] },
  { key: "retained_earnings", label: "Retained Earnings", fields: ["retainedEarnings"] },
  { key: "treasury_stock", label: "Treasury Stock", fields: ["treasuryStock"] }
];

const INCOME_LINES: LineDefinition[] = [
  { key: "revenue", label: "Revenue", fields: ["totalRevenue"] },
  { key: "cost_of_revenue", label: "Less: Cost of Revenue", fields: ["costOfRevenue"] },
  { key: "gross_profit", label: "Gross Profit", fields: ["grossProfit"] },
  { key: "sga", label: "Selling, General & Administrative", fields: ["sellingGeneralAdministrative"] },
  { key: "salary", label: "Salaries", fields: ["salariesAndWages", "salaries"] },
  { key: "rent", label: "Rent", fields: ["rentExpense"] },
  { key: "depreciation", label: "Depreciation & Amortization", fields: ["depreciationAmortizationDepletionIncomeStatement", "reconciledDepreciation"] },
  { key: "advertising", label: "Advertising", fields: ["advertisingExpense"] },
  { key: "fees", label: "Fees", fields: ["professionalExpenseAndContractServicesExpense"] },
  { key: "freight", label: "Freight", fields: ["freightExpense"] },
  { key: "research", label: "Research & Development", fields: ["researchDevelopment", "researchAndDevelopment"] },
  { key: "bad_debt", label: "Bad Debt Expense", fields: ["badDebtExpense"] },
  { key: "other_sga", label: "Other SG&A", fields: ["otherOperatingExpenses", "otherGandA"] },
  { key: "operating_income", label: "Operating Income", fields: ["operatingIncome"] },
  { key: "non_operating", label: "Add/Less: Non-operating Income and Expenses", fields: ["totalOtherIncomeExpenseNet", "otherIncomeExpense"] },
  { key: "pretax_income", label: "Profit Before Tax", fields: ["incomeBeforeTax"] },
  { key: "tax", label: "Less: Income Tax Expense", fields: ["incomeTaxExpense"] },
  { key: "net_income", label: "Net Income", fields: ["netIncome"] },
  { key: "oci", label: "Add/Less: Other Comprehensive Income", fields: ["otherComprehensiveIncome"] },
  { key: "comprehensive_income", label: "Comprehensive Income", fields: ["comprehensiveIncomeNetOfTax", "comprehensiveIncome"] }
];

const CASHFLOW_LINES: LineDefinition[] = [
  { key: "operating_cashflow", label: "Operating Cashflow", fields: ["totalCashFromOperatingActivities", "operatingCashFlow"] },
  { key: "net_income", label: "Net Income", fields: ["netIncome"] },
  { key: "depreciation", label: "Depreciation", fields: ["depreciation", "depreciationAndAmortization"] },
  { key: "change_receivables", label: "Change in Receivables", fields: ["changeToAccountReceivables", "changeInReceivables"] },
  { key: "change_inventory", label: "Change in Inventory", fields: ["changeToInventory", "changeInInventory"] },
  { key: "change_payables", label: "Change in Payables", fields: ["changeToAccountPayable", "changeInPayablesAndAccruedExpense"] },
  { key: "investing_cashflow", label: "Investing Cashflow", fields: ["totalCashflowsFromInvestingActivities", "investingCashFlow"] },
  { key: "capex", label: "Capital Expenditure", fields: ["capitalExpenditures", "capitalExpenditure"] },
  { key: "financing_cashflow", label: "Financing Cashflow", fields: ["totalCashFromFinancingActivities", "financingCashFlow"] },
  { key: "dividends", label: "Dividends Paid", fields: ["dividendsPaid", "cashDividendsPaid"] },
  { key: "free_cashflow", label: "Free Cashflow", fields: ["freeCashflow", "freeCashFlow"] }
];

function statementPeriods(moduleValue: unknown, key: string) {
  return (((moduleValue as Record<string, unknown> | undefined)?.[key] || []) as Array<Record<string, unknown>>).slice(0, 4);
}

function fieldValue(row: Record<string, unknown>, fields: string[]) {
  for (const field of fields) {
    const value = numberOrNull(rawValue(row[field]));
    if (value !== null) {
      return value;
    }
  }
  return null;
}

function buildFinancialStatement(moduleValue: unknown, key: string, definitions: LineDefinition[]): FinancialStatement {
  const periods = statementPeriods(moduleValue, key);
  return {
    columns: periods.map((row) => String((row.endDate as { fmt?: string } | undefined)?.fmt || "")),
    lines: definitions.map((definition) => ({
      key: definition.key,
      label: definition.label,
      values: periods.map((row) => fieldValue(row, definition.fields))
    }))
  };
}

function hasStatementValues(statement: FinancialStatement) {
  return statement.columns.length > 0 && statement.lines.some((line) => line.values.some((value) => value !== null));
}

function bestFinancialStatement(
  primaryModule: unknown,
  fallbackModule: unknown,
  key: string,
  definitions: LineDefinition[]
): FinancialStatement {
  const primary = buildFinancialStatement(primaryModule, key, definitions);
  if (hasStatementValues(primary)) {
    return primary;
  }
  return buildFinancialStatement(fallbackModule, key, definitions);
}

const SEC_CIKS: Record<string, string> = {
  AAPL: "0000320193",
  MSFT: "0000789019",
  NVDA: "0001045810",
  GOOGL: "0001652044",
  GOOG: "0001652044",
  AMZN: "0001018724",
  META: "0001326801",
  TSLA: "0001318605",
  AVGO: "0001730168",
  AMD: "0000002488",
  CRM: "0001108524",
  ADBE: "0000796343",
  NOW: "0001373715",
  NFLX: "0001065280",
  JPM: "0000019617",
  BAC: "0000070858",
  V: "0001403161",
  MA: "0001141391",
  LLY: "0000059478",
  UNH: "0000731766",
  JNJ: "0000200406",
  XOM: "0000034088",
  CVX: "0000093410"
};

let secTickerMapPromise: Promise<Map<string, string>> | null = null;
const secSubmissionProfilePromises = new Map<string, Promise<SecSubmissionProfile | null>>();

type SecSubmissionProfile = {
  sector: string;
  industry: string;
};

function secTickerCandidates(symbol: string) {
  const normalized = marketDataSymbol(symbol).toUpperCase();
  return Array.from(new Set([normalized, normalized.replace("-", ".")]));
}

function cikString(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return String(Math.trunc(numeric)).padStart(10, "0");
}

async function fetchSecTickerMap() {
  try {
    const response = await fetch("https://www.sec.gov/files/company_tickers_exchange.json", {
      headers: {
        accept: "application/json",
        "user-agent": "myfinancialportfolio-next/1.0 contact@example.com"
      },
      next: { revalidate: 21_600 }
    });
    if (!response.ok) {
      return new Map<string, string>();
    }
    const payload = (await response.json()) as { fields?: string[]; data?: unknown[][] };
    const fields = payload.fields || [];
    const tickerIndex = fields.indexOf("ticker");
    const cikIndex = fields.indexOf("cik");
    if (tickerIndex < 0 || cikIndex < 0 || !Array.isArray(payload.data)) {
      return new Map<string, string>();
    }
    const map = new Map<string, string>();
    for (const row of payload.data) {
      const ticker = String(row[tickerIndex] || "").toUpperCase().trim();
      const cik = cikString(row[cikIndex]);
      if (ticker && cik && !map.has(ticker)) {
        map.set(ticker, cik);
      }
    }
    return map;
  } catch {
    return new Map<string, string>();
  }
}

async function resolveSecCik(symbol: string) {
  for (const candidate of secTickerCandidates(symbol)) {
    if (SEC_CIKS[candidate]) {
      return SEC_CIKS[candidate];
    }
  }
  secTickerMapPromise ||= fetchSecTickerMap();
  const tickerMap = await secTickerMapPromise;
  for (const candidate of secTickerCandidates(symbol)) {
    const cik = tickerMap.get(candidate);
    if (cik) {
      return cik;
    }
  }
  return null;
}

function secSectorFromSic(sic: number | null, description: string) {
  const text = description.toLowerCase();
  if (text.includes("real estate") || text.includes("reit")) {
    return "Real Estate";
  }
  if (text.includes("bank") || text.includes("insurance") || text.includes("investment") || text.includes("broker") || text.includes("credit")) {
    return "Financial Services";
  }
  if (text.includes("pharmaceutical") || text.includes("medical") || text.includes("health") || text.includes("biological")) {
    return "Healthcare";
  }
  if (text.includes("semiconductor") || text.includes("software") || text.includes("computer") || text.includes("data processing")) {
    return "Technology";
  }
  if (text.includes("telecommunications") || text.includes("broadcast") || text.includes("cable") || text.includes("publishing")) {
    return "Communication Services";
  }
  if (text.includes("electric") || text.includes("gas transmission") || text.includes("water supply") || text.includes("utility")) {
    return "Utilities";
  }
  if (text.includes("oil") || text.includes("gas") || text.includes("petroleum") || text.includes("coal")) {
    return "Energy";
  }
  if (sic === null) {
    return "";
  }
  if (sic >= 100 && sic <= 999) {
    return "Consumer Defensive";
  }
  if (sic >= 1000 && sic <= 1499) {
    return "Basic Materials";
  }
  if (sic >= 1500 && sic <= 1799) {
    return "Industrials";
  }
  if (sic >= 2000 && sic <= 2199) {
    return "Consumer Defensive";
  }
  if (sic >= 2200 && sic <= 2599) {
    return "Consumer Cyclical";
  }
  if (sic >= 2600 && sic <= 2899) {
    return "Basic Materials";
  }
  if (sic >= 2900 && sic <= 2999) {
    return "Energy";
  }
  if (sic >= 3000 && sic <= 3569) {
    return "Industrials";
  }
  if (sic >= 3570 && sic <= 3699) {
    return "Technology";
  }
  if (sic >= 3700 && sic <= 3799) {
    return "Industrials";
  }
  if (sic >= 3800 && sic <= 3899) {
    return "Healthcare";
  }
  if (sic >= 3900 && sic <= 3999) {
    return "Consumer Cyclical";
  }
  if (sic >= 4000 && sic <= 4799) {
    return "Industrials";
  }
  if (sic >= 4800 && sic <= 4899) {
    return "Communication Services";
  }
  if (sic >= 4900 && sic <= 4999) {
    return "Utilities";
  }
  if (sic >= 5000 && sic <= 5199) {
    return "Industrials";
  }
  if (sic >= 5200 && sic <= 5999) {
    return "Consumer Cyclical";
  }
  if (sic >= 6000 && sic <= 6499) {
    return "Financial Services";
  }
  if (sic >= 6500 && sic <= 6799) {
    return "Real Estate";
  }
  if (sic >= 7000 && sic <= 7999) {
    return text.includes("business services") || text.includes("prepackaged software") ? "Technology" : "Consumer Cyclical";
  }
  if (sic >= 8000 && sic <= 8099) {
    return "Healthcare";
  }
  if (sic >= 8100 && sic <= 8999) {
    return "Industrials";
  }
  return "";
}

function secIndustryDescription(value: unknown) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^services[-\s]*/i, "Services - ")
    .replace(/^retail[-\s]*/i, "Retail - ")
    .trim();
}

async function fetchSecSubmissionProfile(symbol: string): Promise<SecSubmissionProfile | null> {
  const cik = await resolveSecCik(symbol);
  if (!cik) {
    return null;
  }
  const cached = secSubmissionProfilePromises.get(cik);
  if (cached) {
    return cached;
  }
  const promise = (async () => {
    try {
      const response = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, {
        headers: {
          accept: "application/json",
          "user-agent": "myfinancialportfolio-next/1.0 contact@example.com"
        },
        next: { revalidate: 604800 }
      });
      if (!response.ok) {
        return null;
      }
      const payload = (await response.json()) as Record<string, unknown>;
      const industry = secIndustryDescription(payload.sicDescription);
      const sic = numberOrNull(payload.sic);
      const sector = secSectorFromSic(sic, industry);
      return sector || industry ? { sector, industry: industry || (sector ? SECTOR_DEFAULT_INDUSTRIES[sector] || sector : "") } : null;
    } catch {
      return null;
    }
  })();
  secSubmissionProfilePromises.set(cik, promise);
  return promise;
}

function canonicalFundamentalClassification(
  symbol: string,
  resolvedProfile: { sector?: string; industry?: string },
  secProfile: SecSubmissionProfile | null,
  quote: Quote | null | undefined
) {
  const normalized = normalizeSymbol(symbol);
  const useSecClassification = !isKoreaSymbol(normalized) && !isCryptoSymbol(normalized) && Boolean(secProfile?.sector || secProfile?.industry);
  const sector = (useSecClassification ? secProfile?.sector : "") || resolvedProfile.sector || quote?.sector || "";
  const industry =
    (useSecClassification ? secProfile?.industry : "") ||
    resolvedProfile.industry ||
    quote?.industry ||
    (sector ? SECTOR_DEFAULT_INDUSTRIES[sector] || "" : "");
  return { sector, industry };
}

const SEC_FACT_FIELDS: Record<string, string[]> = {
  total_assets: ["Assets"],
  current_assets: ["AssetsCurrent"],
  cash_short_investments: ["CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents", "CashAndCashEquivalentsAtCarryingValue", "ShortTermInvestments"],
  receivables: ["AccountsReceivableNetCurrent", "ReceivablesNetCurrent"],
  inventory: ["InventoryNet"],
  prepaid: ["PrepaidExpenseAndOtherAssetsCurrent", "PrepaidExpenseCurrent"],
  other_current_assets: ["OtherCurrentAssets"],
  noncurrent_assets: ["AssetsNoncurrent"],
  long_term_investments: ["LongTermInvestments", "MarketableSecuritiesNoncurrent"],
  ppe: ["PropertyPlantAndEquipmentNet"],
  intangibles: ["GoodwillAndIntangibleAssetsNet", "FiniteLivedIntangibleAssetsNet", "Goodwill"],
  deferred_assets: ["DeferredTaxAssetsNet", "DeferredTaxAssetsValuationAllowance"],
  other_noncurrent_assets: ["OtherAssetsNoncurrent"],
  total_liabilities: ["Liabilities"],
  current_liabilities: ["LiabilitiesCurrent"],
  accounts_payable: ["AccountsPayableCurrent"],
  short_term_debt: ["ShortTermBorrowings", "ShortTermDebtCurrent"],
  other_current_liabilities: ["OtherCurrentLiabilities"],
  noncurrent_liabilities: ["LiabilitiesNoncurrent"],
  long_term_debt: ["LongTermDebtNoncurrent", "LongTermDebtAndFinanceLeaseObligationsNoncurrent"],
  other_liabilities: ["OtherLiabilitiesNoncurrent"],
  total_equity: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
  common_stock: ["CommonStocksIncludingAdditionalPaidInCapital", "CommonStockValue"],
  capital_surplus: ["AdditionalPaidInCapital"],
  retained_earnings: ["RetainedEarningsAccumulatedDeficit"],
  treasury_stock: ["TreasuryStockValue"],
  revenue: ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet"],
  cost_of_revenue: ["CostOfRevenue", "CostOfGoodsAndServicesSold"],
  gross_profit: ["GrossProfit"],
  sga: ["SellingGeneralAndAdministrativeExpense"],
  salary: ["LaborAndRelatedExpense", "SalariesAndWages"],
  rent: ["OperatingLeaseCost"],
  depreciation: ["DepreciationDepletionAndAmortization", "DepreciationAndAmortization"],
  advertising: ["AdvertisingExpense"],
  fees: ["ProfessionalFees"],
  freight: ["ShippingHandlingAndTransportationCosts"],
  research: ["ResearchAndDevelopmentExpense"],
  bad_debt: ["AllowanceForDoubtfulAccountsExpense"],
  other_sga: ["OtherOperatingExpenses"],
  operating_income: ["OperatingIncomeLoss"],
  non_operating: ["NonoperatingIncomeExpense", "OtherNonoperatingIncomeExpense"],
  pretax_income: ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments"],
  tax: ["IncomeTaxExpenseBenefit"],
  net_income: ["NetIncomeLoss", "ProfitLoss"],
  oci: ["OtherComprehensiveIncomeLossNetOfTax"],
  comprehensive_income: ["ComprehensiveIncomeNetOfTax"],
  operating_cashflow: ["NetCashProvidedByUsedInOperatingActivities"],
  change_receivables: ["IncreaseDecreaseInAccountsReceivable"],
  change_inventory: ["IncreaseDecreaseInInventories"],
  change_payables: ["IncreaseDecreaseInAccountsPayable"],
  investing_cashflow: ["NetCashProvidedByUsedInInvestingActivities"],
  capex: ["PaymentsToAcquirePropertyPlantAndEquipment"],
  financing_cashflow: ["NetCashProvidedByUsedInFinancingActivities"],
  dividends: ["PaymentsOfDividends"]
};

const SEC_EPS_UNITS = ["USD/shares", "USD/share", "USD / shares", "USD / share", "USD-per-shares", "USD-per-share"];
const SEC_SHARE_UNITS = ["shares"];
const SEC_EPS_FACT_FIELDS = [
  "EarningsPerShareDiluted",
  "EarningsPerShareBasic",
  "EarningsPerShareBasicAndDiluted",
  "IncomeLossFromContinuingOperationsPerDilutedShare",
  "IncomeLossFromContinuingOperationsPerBasicShare",
  "IncomeLossFromContinuingOperationsPerBasicAndDilutedShare"
];
const SEC_COMMON_INCOME_FIELDS = [
  "NetIncomeLossAvailableToCommonStockholdersBasic",
  "NetIncomeLossAvailableToCommonStockholdersDiluted",
  "NetIncomeLossAvailableToCommonStockholdersBasicAndDiluted",
  "NetIncomeLossAttributableToParent"
];
const SEC_DILUTED_SHARE_FIELDS = [
  "WeightedAverageNumberOfDilutedSharesOutstanding",
  "WeightedAverageNumberOfSharesOutstandingDiluted",
  "WeightedAverageNumberOfShareOutstandingDiluted"
];
const SEC_BASIC_SHARE_FIELDS = [
  "WeightedAverageNumberOfSharesOutstandingBasic",
  "WeightedAverageNumberOfShareOutstandingBasic",
  "WeightedAverageNumberOfSharesOutstandingBasicAndDiluted",
  "WeightedAverageNumberOfShareOutstandingBasicAndDiluted"
];

type SecCompanyFacts = {
  facts?: {
    "us-gaap"?: Record<
      string,
      {
        units?: Record<string, Array<{ fy?: number; fp?: string; form?: string; end?: string; filed?: string; val?: number }>>;
      }
    >;
  };
};

async function fetchSecCompanyFacts(symbol: string): Promise<SecCompanyFacts | null> {
  const cik = await resolveSecCik(symbol);
  if (!cik) {
    return null;
  }
  try {
    const response = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, {
      headers: {
        accept: "application/json",
        "user-agent": "myfinancialportfolio-next/1.0 contact@example.com"
      },
      next: { revalidate: 86400 }
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as SecCompanyFacts;
  } catch {
    return null;
  }
}

function secFactRows(facts: SecCompanyFacts | null, concept: string) {
  return secFactRowsByUnits(facts, concept, ["USD"]);
}

function normalizedSecUnit(unit: string) {
  return unit.toLowerCase().replace(/\s+/g, "").replace(/-per-/g, "/").replace(/\/+/, "/");
}

function isAnnualSecForm(form: string | undefined) {
  return Boolean(form && (form.startsWith("10-K") || form.startsWith("20-F") || form.startsWith("40-F")));
}

function secFactRowsByUnits(facts: SecCompanyFacts | null, concept: string, units: string[]) {
  const unitMap = facts?.facts?.["us-gaap"]?.[concept]?.units || {};
  const acceptedUnits = new Set(units.map(normalizedSecUnit));
  const rows = Object.entries(unitMap).flatMap(([unit, unitRows]) => (acceptedUnits.has(normalizedSecUnit(unit)) ? unitRows : []));
  return rows
    .filter((row) => isAnnualSecForm(row.form) && row.fp === "FY" && Number.isFinite(row.val) && row.fy)
    .sort((a, b) => String(b.filed || b.end || "").localeCompare(String(a.filed || a.end || "")));
}

function secPeriods(facts: SecCompanyFacts | null) {
  const candidates = ["Assets", "Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "NetIncomeLoss"]
    .flatMap((concept) => secFactRows(facts, concept))
    .filter((row) => row.fy && row.end);
  const unique = new Map<number, { fy: number; end: string }>();
  for (const row of candidates) {
    if (row.fy && row.end && !unique.has(row.fy)) {
      unique.set(row.fy, { fy: row.fy, end: row.end });
    }
  }
  return Array.from(unique.values())
    .sort((a, b) => b.fy - a.fy)
    .slice(0, 4);
}

function secValue(facts: SecCompanyFacts | null, concepts: string[], fiscalYear: number) {
  return secValueByUnits(facts, concepts, fiscalYear, ["USD"]);
}

function secValueByUnits(facts: SecCompanyFacts | null, concepts: string[], fiscalYear: number, units: string[]) {
  for (const concept of concepts) {
    const row = secFactRowsByUnits(facts, concept, units).find((item) => item.fy === fiscalYear);
    if (row && Number.isFinite(row.val)) {
      return Number(row.val);
    }
  }
  return null;
}

function secShareValue(facts: SecCompanyFacts | null, fiscalYear: number) {
  return (
    positiveNumberOrNull(secValueByUnits(facts, SEC_DILUTED_SHARE_FIELDS, fiscalYear, SEC_SHARE_UNITS)) ??
    positiveNumberOrNull(secValueByUnits(facts, SEC_BASIC_SHARE_FIELDS, fiscalYear, SEC_SHARE_UNITS))
  );
}

function secEpsValue(facts: SecCompanyFacts | null, fiscalYear: number, netIncome: number | null) {
  const reportedEps = epsNumberOrNull(secValueByUnits(facts, SEC_EPS_FACT_FIELDS, fiscalYear, SEC_EPS_UNITS));
  if (reportedEps !== null) {
    return reportedEps;
  }
  const commonIncome = secValue(facts, SEC_COMMON_INCOME_FIELDS, fiscalYear) ?? netIncome;
  const shares = secShareValue(facts, fiscalYear);
  if (commonIncome === null || shares === null) {
    return null;
  }
  return commonIncome / shares;
}

function derivedSecValue(key: string, values: Record<string, number | null>) {
  function residual(total: number | null, parts: Array<number | null>) {
    if (total === null) {
      return null;
    }
    const known = parts.filter((value): value is number => value !== null);
    return known.length ? total - known.reduce((sum, value) => sum + value, 0) : null;
  }
  if (key === "noncurrent_assets" && values.total_assets !== null && values.current_assets !== null) {
    return values.total_assets - values.current_assets;
  }
  if (key === "other_current_assets") {
    return residual(values.current_assets, [
      values.cash_short_investments,
      values.receivables,
      values.inventory,
      values.prepaid
    ]);
  }
  if (key === "other_noncurrent_assets") {
    return residual(values.noncurrent_assets, [
      values.long_term_investments,
      values.ppe,
      values.intangibles,
      values.deferred_assets
    ]);
  }
  if (key === "noncurrent_liabilities" && values.total_liabilities !== null && values.current_liabilities !== null) {
    return values.total_liabilities - values.current_liabilities;
  }
  if (key === "other_current_liabilities") {
    return residual(values.current_liabilities, [values.accounts_payable, values.short_term_debt]);
  }
  if (key === "other_liabilities") {
    return residual(values.noncurrent_liabilities, [values.long_term_debt]);
  }
  if (key === "total_equity" && values.total_assets !== null && values.total_liabilities !== null) {
    return values.total_assets - values.total_liabilities;
  }
  if (key === "gross_profit" && values.revenue !== null && values.cost_of_revenue !== null) {
    return values.revenue - values.cost_of_revenue;
  }
  if (key === "non_operating" && values.pretax_income !== null && values.operating_income !== null) {
    return values.pretax_income - values.operating_income;
  }
  if (key === "pretax_income" && values.net_income !== null && values.tax !== null) {
    return values.net_income + values.tax;
  }
  if (key === "free_cashflow" && values.operating_cashflow !== null && values.capex !== null) {
    return values.operating_cashflow - Math.abs(values.capex);
  }
  return null;
}

function buildSecStatement(facts: SecCompanyFacts | null, definitions: LineDefinition[]): FinancialStatement {
  const periods = secPeriods(facts);
  const rowsByYear = periods.map((period) => {
    const values: Record<string, number | null> = {};
    for (const definition of definitions) {
      values[definition.key] = secValue(facts, SEC_FACT_FIELDS[definition.key] || [], period.fy);
    }
    for (const definition of definitions) {
      if (values[definition.key] === null) {
        values[definition.key] = derivedSecValue(definition.key, values);
      }
    }
    return values;
  });
  return {
    columns: periods.map((period) => `${period.fy}`),
    lines: definitions.map((definition) => ({
      key: definition.key,
      label: definition.label,
      values: rowsByYear.map((row) => row[definition.key] ?? null)
    }))
  };
}

async function fetchSecStatements(symbol: string) {
  if (isCryptoSymbol(symbol) || isKoreaSymbol(symbol)) {
    return null;
  }
  const facts = await fetchSecCompanyFacts(symbol);
  if (!facts) {
    return null;
  }
  return {
    income: buildSecStatement(facts, INCOME_LINES),
    balance: buildSecStatement(facts, BALANCE_LINES),
    cashflow: buildSecStatement(facts, CASHFLOW_LINES)
  };
}

type OpenDartRow = {
  bsns_year?: string;
  fs_div?: string;
  sj_div?: string;
  account_id?: string;
  account_nm?: string;
  thstrm_amount?: string;
  thstrm_add_amount?: string;
};

function openDartApiKey() {
  return process.env.DART_API_KEY || process.env.OPENDART_API_KEY || process.env.OPEN_DART_API_KEY || "";
}

function readZipXml(bytes: Uint8Array) {
  const decoder = new TextDecoder("utf-8");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocdOffset = -1;
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 66_000); index -= 1) {
    if (view.getUint32(index, true) === 0x06054b50) {
      eocdOffset = index;
      break;
    }
  }
  if (eocdOffset < 0) {
    return "";
  }
  const entryCount = view.getUint16(eocdOffset + 10, true);
  let centralOffset = view.getUint32(eocdOffset + 16, true);
  for (let index = 0; index < entryCount && centralOffset + 46 <= bytes.length; index += 1) {
    if (view.getUint32(centralOffset, true) !== 0x02014b50) {
      break;
    }
    const compressionMethod = view.getUint16(centralOffset + 10, true);
    const compressedSize = view.getUint32(centralOffset + 20, true);
    const fileNameLength = view.getUint16(centralOffset + 28, true);
    const extraLength = view.getUint16(centralOffset + 30, true);
    const commentLength = view.getUint16(centralOffset + 32, true);
    const localOffset = view.getUint32(centralOffset + 42, true);
    const fileName = decoder.decode(bytes.subarray(centralOffset + 46, centralOffset + 46 + fileNameLength));
    if (fileName.toLowerCase().endsWith(".xml") && localOffset + 30 <= bytes.length) {
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const dataEnd = dataStart + compressedSize;
      if (dataEnd <= bytes.length) {
        const compressed = bytes.subarray(dataStart, dataEnd);
        const xmlBytes = compressionMethod === 8 ? inflateRawSync(Buffer.from(compressed)) : Buffer.from(compressed);
        return decoder.decode(xmlBytes);
      }
    }
    centralOffset += 46 + fileNameLength + extraLength + commentLength;
  }
  return "";
}

function parseOpenDartCorpCodes(xml: string) {
  const rows = new Map<string, string>();
  for (const item of xml.matchAll(/<list>([\s\S]*?)<\/list>/g)) {
    const block = item[1];
    const stockCode = block.match(/<stock_code>(.*?)<\/stock_code>/)?.[1]?.trim();
    const corpCode = block.match(/<corp_code>(.*?)<\/corp_code>/)?.[1]?.trim();
    if (stockCode && corpCode && /^\d{6}$/.test(stockCode)) {
      rows.set(stockCode, corpCode);
    }
  }
  return rows;
}

async function resolveOpenDartCorpCode(symbol: string) {
  const normalized = normalizeSymbol(symbol);
  const direct = KOREA_DART_CORP_CODES[normalized];
  if (direct) {
    return direct;
  }
  const stockCode = normalized.replace(/\.(KS|KQ)$/i, "");
  if (!/^\d{6}$/.test(stockCode)) {
    return null;
  }
  if (openDartCorpCodeCache?.has(stockCode)) {
    return openDartCorpCodeCache.get(stockCode) || null;
  }
  const key = openDartApiKey();
  if (!key) {
    return null;
  }
  try {
    const url = new URL("https://opendart.fss.or.kr/api/corpCode.xml");
    url.searchParams.set("crtfc_key", key);
    const response = await fetch(url, {
      headers: { accept: "application/zip, application/octet-stream" },
      next: { revalidate: 604800 }
    });
    if (!response.ok) {
      return null;
    }
    const xml = readZipXml(new Uint8Array(await response.arrayBuffer()));
    openDartCorpCodeCache = parseOpenDartCorpCodes(xml);
    return openDartCorpCodeCache.get(stockCode) || null;
  } catch {
    return null;
  }
}

function cacheAgeMs(updatedAt: unknown) {
  const timestamp = Date.parse(String(updatedAt || ""));
  return Number.isFinite(timestamp) ? Date.now() - timestamp : Number.POSITIVE_INFINITY;
}

function isKoreaFinancialPayload(payload: unknown): payload is KoreaFinancialPayload {
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  return (
    record.source === "opendart" &&
    typeof record.symbol === "string" &&
    record.mappingVersion === KOREA_FINANCIAL_MAPPING_VERSION &&
    typeof record.mappingSignature === "string" &&
    record.statements !== null &&
    typeof record.statements === "object" &&
    record.ratioValues !== null &&
    typeof record.ratioValues === "object" &&
    Array.isArray(record.ratioHistory)
  );
}

function hasKoreaFinancialValues(payload: KoreaFinancialPayload) {
  return (
    hasStatementValues(payload.statements.income) ||
    hasStatementValues(payload.statements.balance) ||
    hasStatementValues(payload.statements.cashflow) ||
    Object.values(payload.ratioValues).some((value) => value !== null) ||
    Boolean(payload.ratioHistory?.some((row) => row.per !== null || row.roe !== null))
  );
}

async function readCachedKoreaFinancial(symbol: string, mappingSignature: string) {
  try {
    const response = await supabaseAdmin()
      .from(FINANCIAL_STATEMENT_CACHE_TABLE)
      .select("payload,updated_at")
      .eq("symbol", symbol)
      .maybeSingle();
    if (response.error || cacheAgeMs(response.data?.updated_at) > FINANCIAL_STATEMENT_CACHE_MAX_AGE_MS) {
      return null;
    }
    const payload = response.data?.payload;
    return isKoreaFinancialPayload(payload) && payload.mappingSignature === mappingSignature && hasKoreaFinancialValues(payload) ? payload : null;
  } catch {
    return null;
  }
}

async function writeCachedKoreaFinancial(symbol: string, payload: KoreaFinancialPayload) {
  try {
    await supabaseAdmin()
      .from(FINANCIAL_STATEMENT_CACHE_TABLE)
      .upsert({
        symbol,
        cache_date: new Date().toISOString().slice(0, 10),
        payload,
        updated_at: new Date().toISOString()
      }, { onConflict: "symbol" });
  } catch {
    // Cache writes should never block the symbol page.
  }
}

async function readSavedOpenDartMappings() {
  try {
    const response = await supabaseAdmin()
      .from(FINANCIAL_STATEMENT_CACHE_TABLE)
      .select("payload")
      .eq("symbol", FINANCIAL_MAPPING_CACHE_SYMBOL)
      .maybeSingle();
    if (response.error) {
      return [];
    }
    const payload = response.data?.payload;
    const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    return cleanSavedDartMappings(record.mappings);
  } catch {
    return [];
  }
}

async function writeSavedOpenDartMappings(mappings: SavedOpenDartMapping[]) {
  await supabaseAdmin()
    .from(FINANCIAL_STATEMENT_CACHE_TABLE)
    .upsert(
      {
        symbol: FINANCIAL_MAPPING_CACHE_SYMBOL,
        cache_date: new Date().toISOString().slice(0, 10),
        payload: { mappings },
        updated_at: new Date().toISOString()
      },
      { onConflict: "symbol" }
    );
}

async function clearKoreaFinancialCaches() {
  try {
    await supabaseAdmin().from(FINANCIAL_STATEMENT_CACHE_TABLE).delete().neq("symbol", FINANCIAL_MAPPING_CACHE_SYMBOL);
  } catch {
    // A saved mapping can still be applied after the weekly cache naturally refreshes.
  }
}

export async function saveOpenDartAccountMapping(input: {
  statementDiv: string;
  accountId: string;
  accountName: string;
  lineKey: string;
}) {
  const sjDiv = String(input.statementDiv || "").trim().toUpperCase();
  const accountId = String(input.accountId || "").trim();
  const accountName = String(input.accountName || "").trim();
  const lineKey = String(input.lineKey || "").trim();
  if (!sjDiv || !accountName) {
    throw new Error("OpenDART account information is incomplete.");
  }
  if (!FINANCIAL_LINE_KEYS.has(lineKey)) {
    throw new Error("Unknown financial statement line item.");
  }
  const existing = await readSavedOpenDartMappings();
  const nextMapping: SavedOpenDartMapping = {
    sjDiv,
    accountId,
    accountName,
    lineKey,
    updatedAt: new Date().toISOString()
  };
  const next = [...existing.filter((mapping) => savedDartMappingKey(mapping) !== savedDartMappingKey(nextMapping)), nextMapping];
  await writeSavedOpenDartMappings(next);
  await clearKoreaFinancialCaches();
  return { mappings: next };
}

function openDartYears() {
  const latestLikelyAnnualYear = new Date().getFullYear() - 1;
  return Array.from({ length: 4 }, (_, index) => String(latestLikelyAnnualYear - index));
}

async function fetchOpenDartRowsForYear(corpCode: string, year: string, fsDiv: "CFS" | "OFS") {
  const key = openDartApiKey();
  if (!key) {
    return [];
  }
  const url = new URL("https://opendart.fss.or.kr/api/fnlttSinglAcntAll.json");
  url.searchParams.set("crtfc_key", key);
  url.searchParams.set("corp_code", corpCode);
  url.searchParams.set("bsns_year", year);
  url.searchParams.set("reprt_code", OPENDART_ANNUAL_REPORT_CODE);
  url.searchParams.set("fs_div", fsDiv);
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      next: { revalidate: 604800 }
    });
    if (!response.ok) {
      return [];
    }
    const payload = (await response.json()) as { status?: string; list?: OpenDartRow[] };
    if (payload.status !== "000" || !Array.isArray(payload.list)) {
      return [];
    }
    return payload.list.map((row) => ({ ...row, bsns_year: year }));
  } catch {
    return [];
  }
}

async function fetchOpenDartRows(symbol: string) {
  const corpCode = await resolveOpenDartCorpCode(symbol);
  if (!corpCode) {
    return [];
  }
  const rows: OpenDartRow[] = [];
  for (const year of openDartYears()) {
    const consolidated = await fetchOpenDartRowsForYear(corpCode, year, "CFS");
    const annualRows = consolidated.length ? consolidated : await fetchOpenDartRowsForYear(corpCode, year, "OFS");
    rows.push(...annualRows);
  }
  return rows;
}

function dartNumber(value: unknown) {
  const rawText = String(value || "").trim();
  const parenthesized = /^\(.+\)$/.test(rawText);
  const text = rawText
    .replace(/,/g, "")
    .replace(/[()]/g, "")
    .trim();
  if (!text || text === "-") {
    return null;
  }
  const num = Number(text);
  return Number.isFinite(num) ? (parenthesized ? -num : num) : null;
}

function normalizeDartAccountName(value: unknown) {
  return String(value || "")
    .replace(/\s+/g, "")
    .replace(/^[0-9IVXLCDMⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ.\-]+/i, "")
    .replace(/[()[\]{}（）]/g, "");
}

type DartLineMatch = {
  sjDiv?: string | string[];
  accountIds?: string[];
  accountNames?: string[];
  aggregation?: "first" | "sum";
};

function dartSjDivMatches(actual: string, expected?: string | string[]) {
  if (!expected) {
    return true;
  }
  const expectedValues = (Array.isArray(expected) ? expected : [expected]).map((item) => item.toUpperCase());
  return expectedValues.includes(actual) || (actual === "CIS" && expectedValues.includes("IS"));
}

function dartRowMatches(row: OpenDartRow, match: DartLineMatch) {
  const sjDiv = String(row.sj_div || "").toUpperCase();
  if (!dartSjDivMatches(sjDiv, match.sjDiv)) {
    return false;
  }
  const accountId = String(row.account_id || "").toLowerCase();
  if (match.accountIds?.some((id) => accountId === id.toLowerCase() || accountId.endsWith(id.toLowerCase()))) {
    return true;
  }
  const accountName = normalizeDartAccountName(row.account_nm);
  return Boolean(match.accountNames?.some((name) => accountName === normalizeDartAccountName(name)));
}

const DART_LINE_MATCHES: Record<string, DartLineMatch> = {
  total_assets: { sjDiv: "BS", accountIds: ["ifrs-full_Assets"], accountNames: ["자산총계"] },
  current_assets: { sjDiv: "BS", accountIds: ["ifrs-full_CurrentAssets"], accountNames: ["유동자산"] },
  cash_short_investments: {
    sjDiv: "BS",
    aggregation: "sum",
    accountIds: [
      "ifrs-full_CashAndCashEquivalents",
      "ifrs-full_CashAndCashEquivalentsAtCarryingValue",
      "dart_ShortTermDepositsNotClassifiedAsCashEquivalents",
      "dart_ShortTermFinancialInstruments"
    ],
    accountNames: ["현금및현금성자산", "단기금융상품", "단기금융자산", "단기상각후원가금융자산", "단기당기손익-공정가치금융자산"]
  },
  receivables: {
    sjDiv: "BS",
    aggregation: "sum",
    accountIds: ["ifrs-full_TradeAndOtherCurrentReceivables", "ifrs-full_TradeAndOtherReceivables", "dart_ShortTermTradeReceivable"],
    accountNames: ["매출채권및기타채권", "매출채권", "미수금", "미수수익"]
  },
  inventory: { sjDiv: "BS", accountIds: ["ifrs-full_Inventories"], accountNames: ["재고자산"] },
  prepaid: { sjDiv: "BS", aggregation: "sum", accountIds: ["ifrs-full_Prepayments"], accountNames: ["선급금", "선급비용", "선급법인세"] },
  other_current_assets: { sjDiv: "BS", accountIds: ["ifrs-full_OtherCurrentAssets"], accountNames: ["기타유동자산"] },
  noncurrent_assets: { sjDiv: "BS", accountIds: ["ifrs-full_NoncurrentAssets"], accountNames: ["비유동자산"] },
  long_term_investments: {
    sjDiv: "BS",
    aggregation: "sum",
    accountIds: ["ifrs-full_OtherNoncurrentFinancialAssets", "ifrs-full_NoncurrentFinancialAssets", "ifrs-full_InvestmentsAccountedForUsingEquityMethod"],
    accountNames: ["비유동금융자산", "장기금융자산", "관계기업및공동기업투자", "관계기업투자", "종속기업투자"]
  },
  ppe: { sjDiv: "BS", accountIds: ["ifrs-full_PropertyPlantAndEquipment"], accountNames: ["유형자산"] },
  intangibles: { sjDiv: "BS", aggregation: "sum", accountIds: ["ifrs-full_IntangibleAssetsOtherThanGoodwill", "ifrs-full_IntangibleAssets", "ifrs-full_Goodwill"], accountNames: ["무형자산", "영업권"] },
  deferred_assets: { sjDiv: "BS", accountIds: ["ifrs-full_DeferredTaxAssets"], accountNames: ["이연법인세자산"] },
  other_noncurrent_assets: { sjDiv: "BS", accountIds: ["ifrs-full_OtherNoncurrentAssets"], accountNames: ["기타비유동자산"] },
  total_liabilities: { sjDiv: "BS", accountIds: ["ifrs-full_Liabilities"], accountNames: ["부채총계"] },
  current_liabilities: { sjDiv: "BS", accountIds: ["ifrs-full_CurrentLiabilities"], accountNames: ["유동부채"] },
  accounts_payable: { sjDiv: "BS", aggregation: "sum", accountIds: ["ifrs-full_TradeAndOtherCurrentPayables", "ifrs-full_TradeAndOtherPayables"], accountNames: ["매입채무및기타채무", "매입채무", "미지급금", "미지급비용"] },
  short_term_debt: { sjDiv: "BS", aggregation: "sum", accountIds: ["ifrs-full_ShorttermBorrowings", "ifrs-full_CurrentBorrowings", "ifrs-full_CurrentPortionOfLongtermBorrowings"], accountNames: ["단기차입금", "유동성장기부채", "유동성사채", "유동리스부채"] },
  other_current_liabilities: { sjDiv: "BS", accountIds: ["ifrs-full_OtherCurrentLiabilities"], accountNames: ["기타유동부채"] },
  noncurrent_liabilities: { sjDiv: "BS", accountIds: ["ifrs-full_NoncurrentLiabilities"], accountNames: ["비유동부채"] },
  long_term_debt: { sjDiv: "BS", aggregation: "sum", accountIds: ["ifrs-full_LongtermBorrowings", "ifrs-full_NoncurrentBorrowings", "ifrs-full_Debentures"], accountNames: ["장기차입금", "사채", "비유동리스부채"] },
  other_liabilities: { sjDiv: "BS", accountIds: ["ifrs-full_OtherNoncurrentLiabilities"], accountNames: ["기타비유동부채"] },
  total_equity: { sjDiv: "BS", accountIds: ["ifrs-full_Equity"], accountNames: ["자본총계"] },
  common_stock: { sjDiv: "BS", accountIds: ["ifrs-full_IssuedCapital"], accountNames: ["자본금"] },
  capital_surplus: { sjDiv: "BS", accountIds: ["ifrs-full_SharePremium"], accountNames: ["주식발행초과금", "자본잉여금"] },
  retained_earnings: { sjDiv: "BS", accountIds: ["ifrs-full_RetainedEarnings"], accountNames: ["이익잉여금", "결손금"] },
  treasury_stock: { sjDiv: "BS", accountIds: ["ifrs-full_TreasuryShares"], accountNames: ["자기주식"] },
  revenue: { sjDiv: "IS", accountIds: ["ifrs-full_Revenue"], accountNames: ["수익", "매출액", "영업수익"] },
  cost_of_revenue: { sjDiv: "IS", accountIds: ["ifrs-full_CostOfSales"], accountNames: ["매출원가"] },
  gross_profit: { sjDiv: "IS", accountIds: ["ifrs-full_GrossProfit"], accountNames: ["매출총이익"] },
  sga: { sjDiv: "IS", accountIds: ["dart_TotalSellingGeneralAdministrativeExpenses"], accountNames: ["판매비와관리비", "판매비와관리비합계"] },
  salary: { sjDiv: "IS", aggregation: "sum", accountIds: ["dart_EmployeeBenefitsExpense"], accountNames: ["급여", "종업원급여", "퇴직급여"] },
  rent: { sjDiv: "IS", aggregation: "sum", accountIds: ["ifrs-full_LeaseExpense"], accountNames: ["임차료", "사용권자산상각비"] },
  depreciation: { sjDiv: "IS", accountIds: ["ifrs-full_DepreciationAndAmortisationExpense", "dart_DepreciationAndAmortizationExpense"], accountNames: ["감가상각비", "감가상각비및무형자산상각비"] },
  advertising: { sjDiv: "IS", accountIds: ["dart_AdvertisingExpense"], accountNames: ["광고선전비", "광고비"] },
  fees: { sjDiv: "IS", aggregation: "sum", accountIds: ["dart_ServiceFees"], accountNames: ["지급수수료", "수수료비용"] },
  freight: { sjDiv: "IS", accountNames: ["운반비", "운송비"] },
  research: { sjDiv: "IS", accountIds: ["dart_ResearchAndDevelopmentExpenses"], accountNames: ["연구개발비"] },
  bad_debt: { sjDiv: "IS", accountIds: ["dart_BadDebtExpenses"], accountNames: ["대손상각비", "대손충당금환입"] },
  other_sga: { sjDiv: "IS", accountIds: ["ifrs-full_OtherExpensesByNature"], accountNames: ["기타판매비와관리비", "기타영업비용"] },
  operating_income: { sjDiv: "IS", accountIds: ["dart_OperatingIncomeLoss"], accountNames: ["영업이익"] },
  pretax_income: { sjDiv: "IS", accountIds: ["ifrs-full_ProfitLossBeforeTax"], accountNames: ["법인세비용차감전순이익"] },
  tax: { sjDiv: "IS", accountIds: ["ifrs-full_IncomeTaxExpenseContinuingOperations"], accountNames: ["법인세비용"] },
  net_income: { sjDiv: "IS", accountIds: ["ifrs-full_ProfitLoss"], accountNames: ["당기순이익"] },
  oci: { sjDiv: "CIS", accountIds: ["ifrs-full_OtherComprehensiveIncome"], accountNames: ["기타포괄손익"] },
  comprehensive_income: { sjDiv: "CIS", accountIds: ["ifrs-full_ComprehensiveIncome"], accountNames: ["총포괄손익"] },
  operating_cashflow: { sjDiv: "CF", accountIds: ["ifrs-full_CashFlowsFromUsedInOperatingActivities"], accountNames: ["영업활동현금흐름"] },
  investing_cashflow: { sjDiv: "CF", accountIds: ["ifrs-full_CashFlowsFromUsedInInvestingActivities"], accountNames: ["투자활동현금흐름"] },
  capex: { sjDiv: "CF", accountIds: ["ifrs-full_PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities"], accountNames: ["유형자산의취득"] },
  financing_cashflow: { sjDiv: "CF", accountIds: ["ifrs-full_CashFlowsFromUsedInFinancingActivities"], accountNames: ["재무활동현금흐름"] },
  dividends: { sjDiv: "CF", accountIds: ["ifrs-full_DividendsPaidClassifiedAsFinancingActivities"], accountNames: ["배당금지급"] }
};

const FINANCIAL_LINE_KEYS = new Set([...BALANCE_LINES, ...INCOME_LINES, ...CASHFLOW_LINES].map((line) => line.key));

function normalizeDartMappingText(value: unknown) {
  return normalizeDartAccountName(value).toLowerCase();
}

function cleanSavedDartMappings(value: unknown): SavedOpenDartMapping[] {
  const rows = Array.isArray(value) ? value : [];
  return rows
    .map((item): SavedOpenDartMapping | null => {
      const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const sjDiv = String(record.sjDiv || "").trim().toUpperCase();
      const accountId = String(record.accountId || "").trim();
      const accountName = String(record.accountName || "").trim();
      const lineKey = String(record.lineKey || "").trim();
      if (!sjDiv || !accountName || !lineKey || !FINANCIAL_LINE_KEYS.has(lineKey)) {
        return null;
      }
      return {
        sjDiv,
        accountId,
        accountName,
        lineKey,
        updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : undefined
      };
    })
    .filter((item): item is SavedOpenDartMapping => item !== null);
}

function savedDartMappingKey(mapping: Pick<SavedOpenDartMapping, "sjDiv" | "accountId" | "accountName">) {
  return [mapping.sjDiv.toUpperCase(), mapping.accountId.toLowerCase(), normalizeDartMappingText(mapping.accountName)].join("|");
}

function dartMappingSignature(mappings: SavedOpenDartMapping[]) {
  return mappings
    .map((mapping) => `${savedDartMappingKey(mapping)}=>${mapping.lineKey}`)
    .sort()
    .join(";");
}

function dartRowMatchesSavedMapping(row: OpenDartRow, mapping: SavedOpenDartMapping) {
  const sjDiv = String(row.sj_div || "").toUpperCase();
  const accountId = String(row.account_id || "").trim().toLowerCase();
  const accountName = normalizeDartMappingText(row.account_nm);
  return (
    sjDiv === mapping.sjDiv.toUpperCase() &&
    (!mapping.accountId || accountId === mapping.accountId.toLowerCase()) &&
    accountName === normalizeDartMappingText(mapping.accountName)
  );
}

function uniqueDartRows(rows: OpenDartRow[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = [
      row.bsns_year || "",
      row.fs_div || "",
      row.sj_div || "",
      row.account_id || "",
      row.account_nm || "",
      row.thstrm_amount || "",
      row.thstrm_add_amount || ""
    ].join("|");
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function dartValue(rows: OpenDartRow[], year: string, key: string, savedMappings: SavedOpenDartMapping[] = []) {
  const match = DART_LINE_MATCHES[key];
  const customRows = rows.filter(
    (item) => item.bsns_year === year && savedMappings.some((mapping) => mapping.lineKey === key && dartRowMatchesSavedMapping(item, mapping))
  );
  if (!match && !customRows.length) {
    return null;
  }
  const builtInRows = match ? rows.filter((item) => item.bsns_year === year && dartRowMatches(item, match)) : [];
  const matchedRows = uniqueDartRows([...customRows, ...builtInRows]);
  if (match?.aggregation === "sum" || customRows.length > 1) {
    const values = matchedRows
      .map((row) => dartNumber(row.thstrm_add_amount) ?? dartNumber(row.thstrm_amount))
      .filter((value): value is number => value !== null);
    return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
  }
  for (const row of matchedRows) {
    const value = dartNumber(row.thstrm_add_amount) ?? dartNumber(row.thstrm_amount);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

function dartYears(rows: OpenDartRow[]) {
  return Array.from(new Set(rows.map((row) => String(row.bsns_year || "")).filter(Boolean)))
    .sort((a, b) => Number(b) - Number(a))
    .slice(0, 4);
}

function dartStatementName(row: OpenDartRow) {
  const sjDiv = String(row.sj_div || "").toUpperCase();
  if (sjDiv === "BS") {
    return "Financial Position Statement";
  }
  if (sjDiv === "IS" || sjDiv === "CIS") {
    return "Income Statement";
  }
  if (sjDiv === "CF") {
    return "Cashflow Statement";
  }
  return sjDiv || "Unknown Statement";
}

function isMappedDartRow(row: OpenDartRow, savedMappings: SavedOpenDartMapping[] = []) {
  return (
    Object.values(DART_LINE_MATCHES).some((match) => dartRowMatches(row, match)) ||
    savedMappings.some((mapping) => dartRowMatchesSavedMapping(row, mapping))
  );
}

function dartUnmappedAccounts(rows: OpenDartRow[], savedMappings: SavedOpenDartMapping[] = []): FinancialStatementMappingCandidate[] {
  const grouped = new Map<string, FinancialStatementMappingCandidate>();
  for (const row of rows) {
    const accountId = String(row.account_id || "").trim();
    const accountName = String(row.account_nm || "").trim();
    const sampleValue = String(row.thstrm_add_amount || row.thstrm_amount || "").trim();
    if (!accountName || !sampleValue || sampleValue === "-" || isMappedDartRow(row, savedMappings)) {
      continue;
    }
    const key = `${row.sj_div || ""}|${accountId}|${accountName}`;
    const existing = grouped.get(key);
    if (existing) {
      const year = String(row.bsns_year || "").trim();
      if (year && !existing.years.includes(year)) {
        existing.years.push(year);
      }
      continue;
    }
    grouped.set(key, {
      statement: dartStatementName(row),
      statementDiv: String(row.sj_div || "").toUpperCase(),
      accountId,
      accountName,
      sampleValue,
      years: String(row.bsns_year || "").trim() ? [String(row.bsns_year).trim()] : []
    });
  }
  return Array.from(grouped.values())
    .map((item) => ({ ...item, years: item.years.sort((a, b) => Number(b) - Number(a)) }))
    .sort((a, b) => a.statement.localeCompare(b.statement) || a.accountName.localeCompare(b.accountName))
    .slice(0, 80);
}

function buildOpenDartStatement(rows: OpenDartRow[], definitions: LineDefinition[], savedMappings: SavedOpenDartMapping[] = []): FinancialStatement {
  const years = dartYears(rows);
  const rowsByYear = years.map((year) => {
    const values: Record<string, number | null> = {};
    for (const definition of definitions) {
      values[definition.key] = dartValue(rows, year, definition.key, savedMappings);
    }
    for (const definition of definitions) {
      if (values[definition.key] === null) {
        values[definition.key] = derivedSecValue(definition.key, values);
      }
    }
    return values;
  });
  return {
    columns: years,
    lines: definitions.map((definition) => ({
      key: definition.key,
      label: definition.label,
      values: rowsByYear.map((row) => row[definition.key] ?? null)
    }))
  };
}

function openDartRatioValuesForYear(
  rows: OpenDartRow[],
  year: string,
  marketPrice: number | null,
  savedMappings: SavedOpenDartMapping[] = []
): RatioValues {
  const years = dartYears(rows);
  if (!year) {
    return emptyRatioValues();
  }
  const revenue = dartValue(rows, year, "revenue", savedMappings);
  const operatingIncome = dartValue(rows, year, "operating_income", savedMappings);
  const netIncome = dartValue(rows, year, "net_income", savedMappings);
  const assets = dartValue(rows, year, "total_assets", savedMappings);
  const equity = dartValue(rows, year, "total_equity", savedMappings);
  const previousYear = years[years.indexOf(year) + 1];
  const previousRevenue = previousYear ? dartValue(rows, previousYear, "revenue", savedMappings) : null;
  const previousOperatingIncome = previousYear ? dartValue(rows, previousYear, "operating_income", savedMappings) : null;
  const previousNetIncome = previousYear ? dartValue(rows, previousYear, "net_income", savedMappings) : null;
  const previousAssets = previousYear ? dartValue(rows, previousYear, "total_assets", savedMappings) : null;
  const previousEquity = previousYear ? dartValue(rows, previousYear, "total_equity", savedMappings) : null;
  const epsRow = rows.find((row) =>
    row.bsns_year === year &&
    dartRowMatches(row, {
      sjDiv: "IS",
      accountIds: ["ifrs-full_BasicEarningsLossPerShare", "ifrs-full_DilutedEarningsLossPerShare"],
      accountNames: ["기본주당이익", "희석주당이익", "기본및희석주당이익"]
    })
  );
  const eps = epsNumberOrNull(dartNumber(epsRow?.thstrm_amount));
  const averageEquity = equity !== null && previousEquity !== null ? (equity + previousEquity) / 2 : equity;
  const averageAssets = assets !== null && previousAssets !== null ? (assets + previousAssets) / 2 : assets;
  const depreciation = dartValue(rows, year, "depreciation", savedMappings);
  const shortTermDebt = dartValue(rows, year, "short_term_debt", savedMappings);
  const longTermDebt = dartValue(rows, year, "long_term_debt", savedMappings);
  const totalDebt =
    shortTermDebt !== null || longTermDebt !== null
      ? (shortTermDebt || 0) + (longTermDebt || 0)
      : null;
  const cashAndShortInvestments = dartValue(rows, year, "cash_short_investments", savedMappings);
  return {
    ...emptyRatioValues(),
    eps,
    per: eps !== null && eps !== 0 && marketPrice !== null ? marketPrice / eps : null,
    netMargin: revenue !== null && revenue !== 0 && netIncome !== null ? netIncome / revenue : null,
    operatingMargin: revenue !== null && revenue !== 0 && operatingIncome !== null ? operatingIncome / revenue : null,
    roe: averageEquity !== null && averageEquity !== 0 && netIncome !== null ? netIncome / averageEquity : null,
    roa: averageAssets !== null && averageAssets !== 0 && netIncome !== null ? netIncome / averageAssets : null,
    revenueGrowth: growthRate(revenue, previousRevenue),
    operatingIncomeGrowth: growthRate(operatingIncome, previousOperatingIncome),
    earningsGrowth: growthRate(netIncome, previousNetIncome),
    ebitda: operatingIncome !== null || depreciation !== null ? (operatingIncome || 0) + (depreciation || 0) : null,
    totalDebt,
    cashAndShortInvestments,
    revenue,
    operatingIncome,
    netIncome,
    totalAssets: assets,
    averageAssets,
    totalEquity: equity,
    averageEquity
  };
}

function openDartRatioValues(rows: OpenDartRow[], marketPrice: number | null, savedMappings: SavedOpenDartMapping[] = []): RatioValues {
  return openDartRatioValuesForYear(rows, dartYears(rows)[0] || "", marketPrice, savedMappings);
}

function openDartRatioHistory(rows: OpenDartRow[], marketPrice: number | null, savedMappings: SavedOpenDartMapping[] = []): PeriodRatioValues[] {
  return dartYears(rows)
    .slice(0, 4)
    .map((year) => ({
      fiscalYear: Number(year),
      ...openDartRatioValuesForYear(rows, year, marketPrice, savedMappings)
    }));
}

async function koreaOpenDartFinancial(symbol: string, marketPrice: number | null): Promise<KoreaFinancialPayload | null> {
  const normalized = normalizeSymbol(symbol);
  if (!isKoreaSymbol(normalized)) {
    return null;
  }
  const savedMappings = await readSavedOpenDartMappings();
  const mappingSignature = dartMappingSignature(savedMappings);
  const cached = await readCachedKoreaFinancial(normalized, mappingSignature);
  if (cached) {
    return cached;
  }
  const rows = await fetchOpenDartRows(normalized);
  if (!rows.length) {
    return null;
  }
  const payload: KoreaFinancialPayload = {
    source: "opendart",
    symbol: normalized,
    mappingVersion: KOREA_FINANCIAL_MAPPING_VERSION,
    mappingSignature,
    refreshedAt: new Date().toISOString(),
    ratioValues: openDartRatioValues(rows, marketPrice, savedMappings),
    ratioHistory: openDartRatioHistory(rows, marketPrice, savedMappings),
    statements: {
      income: buildOpenDartStatement(rows, INCOME_LINES, savedMappings),
      balance: buildOpenDartStatement(rows, BALANCE_LINES, savedMappings),
      cashflow: buildOpenDartStatement(rows, CASHFLOW_LINES, savedMappings)
    },
    mappingCandidates: dartUnmappedAccounts(rows, savedMappings)
  };
  await writeCachedKoreaFinancial(normalized, payload);
  return payload;
}

function formatRatio(value: number | null, type: "number" | "percent") {
  if (value === null) {
    return "N/A";
  }
  if (type === "percent") {
    return `${(value * 100).toFixed(2)}%`;
  }
  return value.toFixed(2);
}

function emptyRatioValues(): RatioValues {
  return {
    eps: null,
    per: null,
    netMargin: null,
    operatingMargin: null,
    roe: null,
    roa: null,
    revenueGrowth: null,
    operatingIncomeGrowth: null,
    earningsGrowth: null,
    bookValuePerShare: null,
    sharesOutstanding: null,
    ebitda: null,
    totalDebt: null,
    cashAndShortInvestments: null,
    revenue: null,
    operatingIncome: null,
    netIncome: null,
    totalAssets: null,
    averageAssets: null,
    totalEquity: null,
    averageEquity: null
  };
}

function ratioValues(summary: Record<string, unknown>): RatioValues {
  const price = (summary.price || {}) as Record<string, unknown>;
  const financialData = (summary.financialData || {}) as Record<string, unknown>;
  const stats = (summary.defaultKeyStatistics || {}) as Record<string, unknown>;
  const eps = epsNumberOrNull(rawValue(stats.trailingEps));
  const marketPrice = positiveNumberOrNull(rawValue(price.regularMarketPrice));
  const per = numberOrNull(rawValue(stats.trailingPE)) ?? (eps !== null && eps !== 0 && marketPrice ? marketPrice / eps : null);
  const bookValuePerShare = numberOrNull(rawValue(stats.bookValue));
  const sharesOutstanding = positiveNumberOrNull(rawValue(stats.sharesOutstanding));
  return {
    eps,
    per,
    netMargin: numberOrNull(rawValue(financialData.profitMargins)),
    operatingMargin: numberOrNull(rawValue(financialData.operatingMargins)),
    roe: numberOrNull(rawValue(financialData.returnOnEquity)),
    roa: numberOrNull(rawValue(financialData.returnOnAssets)),
    revenueGrowth: numberOrNull(rawValue(financialData.revenueGrowth)),
    operatingIncomeGrowth: null,
    earningsGrowth: numberOrNull(rawValue(financialData.earningsGrowth)),
    bookValuePerShare,
    sharesOutstanding,
    ebitda: numberOrNull(rawValue(financialData.ebitda)),
    totalDebt: numberOrNull(rawValue(financialData.totalDebt)),
    cashAndShortInvestments: numberOrNull(rawValue(financialData.totalCash)),
    revenue: numberOrNull(rawValue(financialData.totalRevenue)),
    operatingIncome: null,
    netIncome: null,
    totalAssets: null,
    averageAssets: null,
    totalEquity: bookValuePerShare !== null && sharesOutstanding !== null ? bookValuePerShare * sharesOutstanding : null,
    averageEquity: null
  };
}

function secRatioValuesForYear(facts: SecCompanyFacts | null, fiscalYear: number, previousFiscalYear: number | null, marketPrice: number | null): RatioValues {
  if (!fiscalYear) {
    return emptyRatioValues();
  }
  const revenue = secValue(facts, SEC_FACT_FIELDS.revenue, fiscalYear);
  const previousRevenue = previousFiscalYear ? secValue(facts, SEC_FACT_FIELDS.revenue, previousFiscalYear) : null;
  const operatingIncome = secValue(facts, SEC_FACT_FIELDS.operating_income, fiscalYear);
  const previousOperatingIncome = previousFiscalYear ? secValue(facts, SEC_FACT_FIELDS.operating_income, previousFiscalYear) : null;
  const netIncome = secValue(facts, SEC_FACT_FIELDS.net_income, fiscalYear);
  const previousNetIncome = previousFiscalYear ? secValue(facts, SEC_FACT_FIELDS.net_income, previousFiscalYear) : null;
  const assets = secValue(facts, SEC_FACT_FIELDS.total_assets, fiscalYear);
  const previousAssets = previousFiscalYear ? secValue(facts, SEC_FACT_FIELDS.total_assets, previousFiscalYear) : null;
  const equity = secValue(facts, SEC_FACT_FIELDS.total_equity, fiscalYear);
  const previousEquity = previousFiscalYear ? secValue(facts, SEC_FACT_FIELDS.total_equity, previousFiscalYear) : null;
  const eps = secEpsValue(facts, fiscalYear, netIncome);
  const sharesOutstanding = secShareValue(facts, fiscalYear);
  const averageEquity = equity !== null && previousEquity !== null ? (equity + previousEquity) / 2 : equity;
  const averageAssets = assets !== null && previousAssets !== null ? (assets + previousAssets) / 2 : assets;
  const depreciation = secValue(facts, SEC_FACT_FIELDS.depreciation, fiscalYear);
  const shortTermDebt = secValue(facts, SEC_FACT_FIELDS.short_term_debt, fiscalYear);
  const longTermDebt = secValue(facts, SEC_FACT_FIELDS.long_term_debt, fiscalYear);
  const totalDebt =
    shortTermDebt !== null || longTermDebt !== null
      ? (shortTermDebt || 0) + (longTermDebt || 0)
      : null;
  const cashAndShortInvestments = secValue(facts, SEC_FACT_FIELDS.cash_short_investments, fiscalYear);
  return {
    eps,
    per: eps !== null && eps !== 0 && marketPrice !== null && marketPrice > 0 ? marketPrice / eps : null,
    netMargin: revenue !== null && revenue !== 0 && netIncome !== null ? netIncome / revenue : null,
    operatingMargin: revenue !== null && revenue !== 0 && operatingIncome !== null ? operatingIncome / revenue : null,
    roe: averageEquity !== null && averageEquity !== 0 && netIncome !== null ? netIncome / averageEquity : null,
    roa: averageAssets !== null && averageAssets !== 0 && netIncome !== null ? netIncome / averageAssets : null,
    revenueGrowth: growthRate(revenue, previousRevenue),
    operatingIncomeGrowth: growthRate(operatingIncome, previousOperatingIncome),
    earningsGrowth: growthRate(netIncome, previousNetIncome),
    bookValuePerShare: equity !== null && sharesOutstanding !== null ? equity / sharesOutstanding : null,
    sharesOutstanding,
    ebitda: operatingIncome !== null || depreciation !== null ? (operatingIncome || 0) + (depreciation || 0) : null,
    totalDebt,
    cashAndShortInvestments,
    revenue,
    operatingIncome,
    netIncome,
    totalAssets: assets,
    averageAssets,
    totalEquity: equity,
    averageEquity
  };
}

async function secRatioHistory(symbol: string, marketPrice: number | null): Promise<PeriodRatioValues[]> {
  const facts = await fetchSecCompanyFacts(symbol);
  const periods = secPeriods(facts);
  return periods.map((period, index) => ({
    fiscalYear: period.fy,
    ...secRatioValuesForYear(facts, period.fy, periods[index + 1]?.fy ?? null, marketPrice)
  }));
}

async function secRatioValues(symbol: string, marketPrice: number | null): Promise<RatioValues> {
  const history = await secRatioHistory(symbol, marketPrice);
  const latest = history[0];
  if (!latest) {
    return emptyRatioValues();
  }
  return {
    eps: latest.eps,
    per: latest.per,
    netMargin: latest.netMargin,
    operatingMargin: latest.operatingMargin,
    roe: latest.roe,
    roa: latest.roa,
    revenueGrowth: latest.revenueGrowth,
    operatingIncomeGrowth: latest.operatingIncomeGrowth,
    earningsGrowth: latest.earningsGrowth,
    bookValuePerShare: latest.bookValuePerShare,
    sharesOutstanding: latest.sharesOutstanding,
    ebitda: latest.ebitda,
    totalDebt: latest.totalDebt,
    cashAndShortInvestments: latest.cashAndShortInvestments,
    revenue: latest.revenue,
    operatingIncome: latest.operatingIncome,
    netIncome: latest.netIncome,
    totalAssets: latest.totalAssets,
    averageAssets: latest.averageAssets,
    totalEquity: latest.totalEquity,
    averageEquity: latest.averageEquity
  };
}

function mergeRatioValues(primary: RatioValues, fallback: RatioValues) {
  return {
    eps: primary.eps ?? fallback.eps,
    per: primary.per ?? fallback.per,
    netMargin: primary.netMargin ?? fallback.netMargin,
    operatingMargin: primary.operatingMargin ?? fallback.operatingMargin,
    roe: primary.roe ?? fallback.roe,
    roa: primary.roa ?? fallback.roa,
    revenueGrowth: primary.revenueGrowth ?? fallback.revenueGrowth,
    operatingIncomeGrowth: primary.operatingIncomeGrowth ?? fallback.operatingIncomeGrowth,
    earningsGrowth: primary.earningsGrowth ?? fallback.earningsGrowth,
    bookValuePerShare: primary.bookValuePerShare ?? fallback.bookValuePerShare,
    sharesOutstanding: primary.sharesOutstanding ?? fallback.sharesOutstanding,
    ebitda: primary.ebitda ?? fallback.ebitda,
    totalDebt: primary.totalDebt ?? fallback.totalDebt,
    cashAndShortInvestments: primary.cashAndShortInvestments ?? fallback.cashAndShortInvestments,
    revenue: primary.revenue ?? fallback.revenue,
    operatingIncome: primary.operatingIncome ?? fallback.operatingIncome,
    netIncome: primary.netIncome ?? fallback.netIncome,
    totalAssets: primary.totalAssets ?? fallback.totalAssets,
    averageAssets: primary.averageAssets ?? fallback.averageAssets,
    totalEquity: primary.totalEquity ?? fallback.totalEquity,
    averageEquity: primary.averageEquity ?? fallback.averageEquity
  };
}

function average(values: Array<number | null>) {
  const valid = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function periodToRatioValues(period: PeriodRatioValues | undefined): RatioValues {
  if (!period) {
    return emptyRatioValues();
  }
  return {
    eps: period.eps,
    per: period.per,
    netMargin: period.netMargin,
    operatingMargin: period.operatingMargin,
    roe: period.roe,
    roa: period.roa,
    revenueGrowth: period.revenueGrowth,
    operatingIncomeGrowth: period.operatingIncomeGrowth,
    earningsGrowth: period.earningsGrowth,
    bookValuePerShare: period.bookValuePerShare,
    sharesOutstanding: period.sharesOutstanding,
    ebitda: period.ebitda,
    totalDebt: period.totalDebt,
    cashAndShortInvestments: period.cashAndShortInvestments,
    revenue: period.revenue,
    operatingIncome: period.operatingIncome,
    netIncome: period.netIncome,
    totalAssets: period.totalAssets,
    averageAssets: period.averageAssets,
    totalEquity: period.totalEquity,
    averageEquity: period.averageEquity
  };
}

function valuationHistoryRows({
  company,
  companyHistory,
  peers,
  peerHistories
}: {
  company: RatioValues;
  companyHistory: PeriodRatioValues[];
  peers: RatioValues[];
  peerHistories: PeriodRatioValues[][];
}): ValuationHistoryPoint[] {
  const latestFiscalYear = new Date().getUTCFullYear() - 1;
  const periods = [
    { label: "Current", fiscalYear: null },
    { label: `FY ${latestFiscalYear}`, fiscalYear: latestFiscalYear },
    { label: `FY ${latestFiscalYear - 1}`, fiscalYear: latestFiscalYear - 1 },
    { label: `FY ${latestFiscalYear - 2}`, fiscalYear: latestFiscalYear - 2 }
  ];
  return periods.map((period) => {
    const companyPeriod = period.fiscalYear === null ? company : periodToRatioValues(companyHistory.find((item) => item.fiscalYear === period.fiscalYear));
    const peerPeriods =
      period.fiscalYear === null
        ? peers
        : peerHistories.map((history) => periodToRatioValues(history.find((item) => item.fiscalYear === period.fiscalYear)));
    return {
      label: period.label,
      fiscalYear: period.fiscalYear,
      companyPer: companyPeriod.per,
      industryPer: average(peerPeriods.map((peer) => peer.per)),
      companyRoe: companyPeriod.roe,
      industryRoe: average(peerPeriods.map((peer) => peer.roe))
    };
  });
}

async function financialRatios(
  symbol: string,
  summary: Record<string, unknown>,
  peerSymbols: string[],
  marketPrice: number | null,
  koreaFinancial: KoreaFinancialPayload | null = null
): Promise<{ rows: FinancialRatioRow[]; peerCount: number; valuationHistory: ValuationHistoryPoint[] }> {
  const companyHistory = isKoreaSymbol(symbol) ? koreaFinancial?.ratioHistory ?? [] : await secRatioHistory(symbol, marketPrice);
  const companyFallback = isKoreaSymbol(symbol) ? koreaFinancial?.ratioValues ?? periodToRatioValues(companyHistory[0]) : periodToRatioValues(companyHistory[0]);
  const company = mergeRatioValues(ratioValues(summary), companyFallback);
  const peers = await Promise.all(
    peerSymbols.slice(0, 5).map(async (peer) => {
      const [peerSummary, peerQuote] = await Promise.all([fetchYahooSummary(peer), getQuote(peer)]);
      const peerKoreaFinancial = isKoreaSymbol(peer) ? await koreaOpenDartFinancial(peer, peerQuote.price) : null;
      const peerHistory = isKoreaSymbol(peer) ? peerKoreaFinancial?.ratioHistory ?? [] : await secRatioHistory(peer, peerQuote.price);
      const peerFallback = isKoreaSymbol(peer) ? peerKoreaFinancial?.ratioValues ?? periodToRatioValues(peerHistory[0]) : periodToRatioValues(peerHistory[0]);
      return {
        current: mergeRatioValues(ratioValues(peerSummary), peerFallback),
        history: peerHistory
      };
    })
  );
  const peerCurrent = peers.map((peer) => peer.current);
  const peerHistories = peers.map((peer) => peer.history);
  const peerCount = peerCurrent.filter((peer) => peer.eps !== null || peer.per !== null || peer.netMargin !== null || peer.operatingMargin !== null || peer.roe !== null).length;
  return {
    peerCount,
    valuationHistory: valuationHistoryRows({ company, companyHistory, peers: peerCurrent, peerHistories }),
    rows: [
      {
        metric: "EPS",
        company: formatRatio(company.eps, "number"),
        industryAverage: formatRatio(average(peerCurrent.map((peer) => peer.eps)), "number")
      },
      {
        metric: "PER",
        company: formatRatio(company.per, "number"),
        industryAverage: formatRatio(average(peerCurrent.map((peer) => peer.per)), "number")
      },
      {
        metric: "Net Profit Margin",
        company: formatRatio(company.netMargin, "percent"),
        industryAverage: formatRatio(average(peerCurrent.map((peer) => peer.netMargin)), "percent")
      },
      {
        metric: "Operating Margin",
        company: formatRatio(company.operatingMargin, "percent"),
        industryAverage: formatRatio(average(peerCurrent.map((peer) => peer.operatingMargin)), "percent")
      },
      {
        metric: "ROE",
        company: formatRatio(company.roe, "percent"),
        industryAverage: formatRatio(average(peerCurrent.map((peer) => peer.roe)), "percent")
      }
    ]
  };
}

function formatBeta(value: number | null) {
  return value === null ? "N/A" : value.toFixed(4);
}

function expectedMonthlyReturnFromBeta(beta: number | null) {
  return beta === null ? null : 0.35 + beta * 0.55;
}

function formatExpectedReturn(value: number | null) {
  return value === null ? "N/A" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function benchmarkComparisonRows(ratioRows: FinancialRatioRow[], analytics: BenchmarkAnalyticsResult): FinancialRatioRow[] {
  return [
    {
      metric: `Rolling Beta (${analytics.rollingWindowMonths}M)`,
      company: formatBeta(analytics.rollingBeta),
      industryAverage: formatBeta(analytics.industryRollingBeta)
    },
    {
      metric: `Expected Monthly Return (${analytics.rollingWindowMonths}M Beta)`,
      company: formatExpectedReturn(expectedMonthlyReturnFromBeta(analytics.rollingBeta)),
      industryAverage: formatExpectedReturn(expectedMonthlyReturnFromBeta(analytics.industryRollingBeta))
    },
    {
      metric: `Full Period Beta (${analytics.historyYears}Y)`,
      company: formatBeta(analytics.fullPeriodBeta),
      industryAverage: formatBeta(analytics.industryFullPeriodBeta)
    },
    {
      metric: `Expected Monthly Return (${analytics.historyYears}Y Beta)`,
      company: formatExpectedReturn(expectedMonthlyReturnFromBeta(analytics.fullPeriodBeta)),
      industryAverage: formatExpectedReturn(expectedMonthlyReturnFromBeta(analytics.industryFullPeriodBeta))
    }
  ];
}

export async function buildFinancialFundamentalFromSources(
  symbol: string,
  market: Exclude<StrategyMarket, "crypto">,
  quote: Quote | null = null
): Promise<FinancialFundamentalSnapshot | null> {
  const normalized = normalizeSymbol(symbol);
  if (!normalized || isCryptoSymbol(normalized)) {
    return null;
  }
  const summary = await fetchYahooSummary(normalized);
  const profile = {
    ...((summary.assetProfile || {}) as Record<string, unknown>),
    ...((summary.summaryProfile || {}) as Record<string, unknown>)
  };
  const priceModule = (summary.price || {}) as Record<string, unknown>;
  const resolvedProfile = fallbackProfile(normalized, profile, priceModule);
  const summaryPrice = positiveNumberOrNull(rawValue(priceModule.regularMarketPrice));
  const quotePrice = positiveNumberOrNull(quote?.price);
  const marketPrice = quotePrice ?? summaryPrice;
  const marketCap = positiveNumberOrNull(rawValue(priceModule.marketCap));
  let source = "yahoo_summary";
  let fiscalYear: number | null = null;
  let company = ratioValues(summary);
  let netIncome: number | null = null;
  let averageEquity: number | null = null;
  let secProfile: SecSubmissionProfile | null = null;

  if (isKoreaSymbol(normalized)) {
    const koreaFinancial = await koreaOpenDartFinancial(normalized, marketPrice);
    if (koreaFinancial) {
      source = "opendart_monthly_cache";
      const latest = koreaFinancial.ratioHistory?.[0];
      fiscalYear = latest?.fiscalYear ?? null;
      company = mergeRatioValues(koreaFinancial.ratioValues ?? periodToRatioValues(latest), company);
    }
  } else {
    const [facts, submissionProfile] = await Promise.all([fetchSecCompanyFacts(normalized), fetchSecSubmissionProfile(normalized)]);
    secProfile = submissionProfile;
    const periods = secPeriods(facts);
    const latest = periods[0];
    if (latest) {
      source = "sec_company_facts";
      fiscalYear = latest.fy;
      const previousFiscalYear = periods[1]?.fy ?? null;
      const secCompany = secRatioValuesForYear(facts, latest.fy, previousFiscalYear, marketPrice);
      company = mergeRatioValues(secCompany, company);
      netIncome = secValue(facts, SEC_FACT_FIELDS.net_income, latest.fy);
      const equity = secValue(facts, SEC_FACT_FIELDS.total_equity, latest.fy);
      const previousEquity = previousFiscalYear ? secValue(facts, SEC_FACT_FIELDS.total_equity, previousFiscalYear) : null;
      averageEquity = equity !== null && previousEquity !== null ? (equity + previousEquity) / 2 : equity;
    }
  }

  const eps = company.eps ?? (company.per !== null && company.per !== 0 && marketPrice !== null ? marketPrice / company.per : null);
  const sharesOutstanding = company.sharesOutstanding;
  const refreshedMarketCap = marketCap ?? (marketPrice !== null && sharesOutstanding !== null ? marketPrice * sharesOutstanding : null);
  const { sector, industry } = canonicalFundamentalClassification(normalized, resolvedProfile, secProfile, quote);
  return {
    symbol: normalized,
    market,
    name: resolvedProfile.name || quote?.name || normalized,
    sector,
    industry,
    currency: quote?.currency || String(priceModule.currency || (isKoreaSymbol(normalized) ? "KRW" : "USD")).toUpperCase(),
    fiscalYear,
    eps,
    roePct: company.roe === null || company.roe === undefined ? null : company.roe * 100,
    roaPct: company.roa === null || company.roa === undefined ? null : company.roa * 100,
    netMarginPct: company.netMargin === null || company.netMargin === undefined ? null : company.netMargin * 100,
    operatingMarginPct: company.operatingMargin === null || company.operatingMargin === undefined ? null : company.operatingMargin * 100,
    revenueGrowthPct: company.revenueGrowth === null || company.revenueGrowth === undefined ? null : company.revenueGrowth * 100,
    operatingIncomeGrowthPct:
      company.operatingIncomeGrowth === null || company.operatingIncomeGrowth === undefined ? null : company.operatingIncomeGrowth * 100,
    earningsGrowthPct: company.earningsGrowth === null || company.earningsGrowth === undefined ? null : company.earningsGrowth * 100,
    revenue: company.revenue,
    operatingIncome: company.operatingIncome,
    netIncome: company.netIncome ?? netIncome,
    totalAssets: company.totalAssets,
    averageAssets: company.averageAssets,
    totalEquity: company.totalEquity,
    averageEquity: company.averageEquity ?? averageEquity,
    marketCap: refreshedMarketCap,
    sharesOutstanding,
    bookValuePerShare: company.bookValuePerShare,
    ebitda: company.ebitda,
    totalDebt: company.totalDebt,
    cashAndShortInvestments: company.cashAndShortInvestments,
    priceAtRefresh: marketPrice,
    source,
    refreshedAt: new Date().toISOString()
  };
}

export async function buildFinancialFundamentalProfileFromSources(
  symbol: string,
  market: Exclude<StrategyMarket, "crypto">,
  quote: Quote | null = null
) {
  const normalized = normalizeSymbol(symbol);
  if (!normalized || isCryptoSymbol(normalized)) {
    return null;
  }
  const summary = await fetchYahooSummary(normalized);
  const profile = {
    ...((summary.assetProfile || {}) as Record<string, unknown>),
    ...((summary.summaryProfile || {}) as Record<string, unknown>)
  };
  const priceModule = (summary.price || {}) as Record<string, unknown>;
  const resolvedProfile = fallbackProfile(normalized, profile, priceModule);
  const secProfile = isKoreaSymbol(normalized) ? null : await fetchSecSubmissionProfile(normalized);
  const { sector, industry } = canonicalFundamentalClassification(normalized, resolvedProfile, secProfile, quote);
  return {
    symbol: normalized,
    market,
    name: resolvedProfile.name || quote?.name || normalized,
    sector,
    industry,
    currency: quote?.currency || String(priceModule.currency || (isKoreaSymbol(normalized) ? "KRW" : "USD")).toUpperCase()
  };
}

function financialStatementNotes(symbol: string, koreaFinancial: KoreaFinancialPayload | null, secStatements: { income: FinancialStatement; balance: FinancialStatement; cashflow: FinancialStatement } | null) {
  if (isKoreaSymbol(symbol)) {
    if (koreaFinancial && hasKoreaFinancialValues(koreaFinancial)) {
    return {
      dataSource: "OpenDART weekly cache",
      dataNotes: koreaFinancial.mappingCandidates.length
        ? [
            "OpenDART annual financial statements are loaded and cached for up to one week.",
            "Some OpenDART accounts are not mapped to the current page line items yet. Review the mapping-required rows below."
          ]
        : ["OpenDART annual financial statements are loaded and cached for up to one week."]
    };
    }
    if (!openDartApiKey()) {
      return {
        dataSource: "OpenDART unavailable",
        dataNotes: [
          "OpenDART financial statements are unavailable because DART_API_KEY, OPENDART_API_KEY, or OPEN_DART_API_KEY is not configured in this environment."
        ]
      };
    }
    return {
      dataSource: "OpenDART unavailable",
      dataNotes: [
        "OpenDART did not return usable annual financial statement rows for this symbol. This means the issue is before account-line matching, because no fiscal-year columns were available."
      ]
    };
  }
  if (secStatements && (hasStatementValues(secStatements.income) || hasStatementValues(secStatements.balance) || hasStatementValues(secStatements.cashflow))) {
    return {
      dataSource: "SEC company facts",
      dataNotes: ["SEC company facts are used as the fallback source when Yahoo financial statement modules are incomplete."]
    };
  }
  return {
    dataSource: "Yahoo Finance",
    dataNotes: ["Yahoo quoteSummary modules are used first for financial statement data."]
  };
}

export async function buildSymbolDetail(
  symbol: string,
  range: ChartRange = "1M",
  options: { benchmark?: string; historyYears?: number; rollingWindow?: number } = {}
): Promise<SymbolDetailResponse> {
  const normalized = normalizeSymbol(symbol);
  const [quote, chart, summary] = await Promise.all([getQuote(normalized), fetchChart(normalized, range), fetchYahooSummary(normalized)]);
  const profile = {
    ...((summary.assetProfile || {}) as Record<string, unknown>),
    ...((summary.summaryProfile || {}) as Record<string, unknown>)
  };
  const priceModule = (summary.price || {}) as Record<string, unknown>;
  const financialData = (summary.financialData || {}) as Record<string, unknown>;
  const resolvedProfile = fallbackProfile(normalized, profile, priceModule);
  const sector = resolvedProfile.sector || (isCryptoSymbol(normalized) ? "crypto" : "");
  const peerMap = isKoreaSymbol(normalized) ? KOREA_SECTOR_PEERS : SECTOR_PEERS;
  const peerSymbols =
    peerMap[sector] ||
    (isCryptoSymbol(normalized) ? SECTOR_PEERS.crypto : isKoreaSymbol(normalized) ? MARKET_CONFIG.korea.universe : MARKET_CONFIG.us.universe);
  const comparablePeers = peerSymbols.filter((peer) => peer !== normalized);
  const yahooStatements = {
    income: bestFinancialStatement(summary.incomeStatementHistory, summary.incomeStatementHistoryQuarterly, "incomeStatementHistory", INCOME_LINES),
    balance: bestFinancialStatement(summary.balanceSheetHistory, summary.balanceSheetHistoryQuarterly, "balanceSheetStatements", BALANCE_LINES),
    cashflow: bestFinancialStatement(summary.cashflowStatementHistory, summary.cashflowStatementHistoryQuarterly, "cashflowStatements", CASHFLOW_LINES)
  };
  const koreaFinancial = isKoreaSymbol(normalized) ? await koreaOpenDartFinancial(normalized, quote.price) : null;
  const needsSecStatements =
    !hasStatementValues(yahooStatements.income) || !hasStatementValues(yahooStatements.balance) || !hasStatementValues(yahooStatements.cashflow);
  const benchmarkSymbol = normalizeSymbol(options.benchmark || "SPY");
  const historyYears = Math.max(1, Math.min(20, Math.round(options.historyYears || 20)));
  const rollingWindow = Math.max(6, Math.min(60, Math.round(options.rollingWindow || 36)));
  const [peers, ratios, secStatements, benchmarkData] = await Promise.all([
    getQuotes(comparablePeers),
    financialRatios(normalized, summary, comparablePeers, quote.price, koreaFinancial),
    needsSecStatements ? fetchSecStatements(normalized) : Promise.resolve(null),
    benchmarkAnalytics(normalized, benchmarkSymbol, historyYears, rollingWindow, comparablePeers)
  ]);
  const statementMeta = financialStatementNotes(normalized, koreaFinancial, secStatements);
  const enrichedPeers = Array.from(peers.values())
    .slice(0, 8)
    .map((peer) => {
      const peerProfile = fallbackProfile(peer.symbol, {}, { shortName: peer.symbol });
      return { ...peer, name: peerProfile.name, sector: peerProfile.sector, industry: peerProfile.industry };
    });
  const closes = chart.map((point) => point.close);
  const avg = closes.length ? closes.reduce((sum, value) => sum + value, 0) / closes.length : null;
  const variance =
    avg === null || closes.length < 2
      ? null
      : closes.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (closes.length - 1);

  return {
    symbol: normalized,
    quote,
    chart,
    profile: resolvedProfile,
    metrics: {
      avgReturnPct:
        closes.length >= 2 && closes[0] !== 0 ? ((closes[closes.length - 1] / closes[0] - 1) * 100) : null,
      volatilityPct: variance === null || avg === null || avg === 0 ? null : (Math.sqrt(variance) / avg) * 100,
      high: closes.length ? Math.max(...closes) : null,
      low: closes.length ? Math.min(...closes) : null,
      volume: numberOrNull(financialData.totalRevenue) ?? chart.at(-1)?.volume ?? null
    },
    peers: enrichedPeers,
    benchmark: {
      ...benchmarkData,
      comparisons: benchmarkComparisonRows(ratios.rows, benchmarkData),
      valuationHistory: ratios.valuationHistory
    },
    statements: {
      income: hasStatementValues(yahooStatements.income) ? yahooStatements.income : secStatements?.income ?? koreaFinancial?.statements.income ?? yahooStatements.income,
      balance: hasStatementValues(yahooStatements.balance) ? yahooStatements.balance : secStatements?.balance ?? koreaFinancial?.statements.balance ?? yahooStatements.balance,
      cashflow: hasStatementValues(yahooStatements.cashflow) ? yahooStatements.cashflow : secStatements?.cashflow ?? koreaFinancial?.statements.cashflow ?? yahooStatements.cashflow,
      ratios: ratios.rows,
      ratioPeerCount: ratios.peerCount,
      ratioIndustry: String(resolvedProfile.industry || sector || "industry"),
      dataSource: statementMeta.dataSource,
      dataNotes: statementMeta.dataNotes,
      mappingCandidates: koreaFinancial?.mappingCandidates ?? []
    },
    refreshedAt: new Date().toISOString()
  };
}

export function marketKeys() {
  return Object.keys(MARKET_CONFIG) as MarketKey[];
}

export function strategyUniverseSymbols(market: MarketKey) {
  return [...MARKET_CONFIG[market].universe];
}
