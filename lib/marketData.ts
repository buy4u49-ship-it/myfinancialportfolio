import { cryptoBaseSymbol, isCryptoSymbol, marketDataSymbol, normalizeSymbol } from "./symbols";
import { getQuote, getQuotes } from "./prices";
import type { ChartPoint, FinancialRatioRow, FinancialStatement, MacroPoint, MarketMoverRow, MarketPageResponse, Quote, SymbolDetailResponse } from "./types";

type MarketKey = "crypto" | "us" | "korea";
export type ChartRange = "1D" | "1W" | "1M" | "1Y" | "YTD";

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
  Technology: ["AAPL", "MSFT", "NVDA", "AVGO", "GOOGL", "META"],
  "Consumer Cyclical": ["AMZN", "TSLA", "HD", "MCD"],
  "Financial Services": ["JPM", "BAC", "V", "MA"],
  Healthcare: ["LLY", "UNH", "JNJ", "PFE"],
  crypto: ["BTC-KRW", "ETH-KRW", "SOL-KRW", "XRP-KRW", "LINK-KRW"]
};

function numberOrNull(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
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
      const close = numberOrNull(closes[index]);
      if (close === null) {
        return null;
      }
      return {
        time: new Date(timestamp * 1000).toISOString(),
        open: numberOrNull(opens[index]),
        high: numberOrNull(highs[index]),
        low: numberOrNull(lows[index]),
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
      const close = numberOrNull(row.trade_price);
      const time = String(row.candle_date_time_kst || row.candle_date_time_utc || "");
      if (!time || close === null) {
        return null;
      }
      return {
        time,
        open: numberOrNull(row.opening_price),
        high: numberOrNull(row.high_price),
        low: numberOrNull(row.low_price),
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

const MACRO_COUNTRIES: MacroPoint["country"][] = ["United States", "Korea", "Europe", "Japan", "China"];

const MACRO_ANCHORS: Record<MacroPoint["country"], { rate: number[]; m2: number[] }> = {
  "United States": {
    rate: [0.08, 0.33, 4.75, 5.33, 4.9, 4.35],
    m2: [19_300, 21_600, 21_200, 20_900, 21_400, 21_900]
  },
  Korea: {
    rate: [0.5, 1.25, 3.5, 3.5, 3.0, 2.5],
    m2: [3_250_000, 3_650_000, 3_850_000, 4_070_000, 4_350_000, 4_565_000]
  },
  Europe: {
    rate: [0, 0, 2.5, 4.0, 3.15, 2.15],
    m2: [14_650_000, 15_750_000, 16_150_000, 16_050_000, 16_170_000, 16_245_000]
  },
  Japan: {
    rate: [-0.1, -0.1, -0.1, 0.1, 0.5, 0.75],
    m2: [1_165_000, 1_205_000, 1_225_000, 1_242_000, 1_265_000, 1_275_000]
  },
  China: {
    rate: [3.85, 3.7, 3.45, 3.45, 3.1, 3.0],
    m2: [218_000, 238_000, 266_000, 292_000, 315_000, 354_000]
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
  const quoteMap = await getQuotes(Array.from(new Set([...config.indices, ...config.universe, config.representative])));
  const representativeQuote = quoteMap.get(config.representative) || (await getQuote(config.representative));
  const moverRows = config.universe.map((symbol) => quoteToMover(quoteMap.get(symbol) || { ...representativeQuote, symbol }));

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
      )}?modules=summaryProfile,price,financialData,defaultKeyStatistics,incomeStatementHistory,balanceSheetHistory,cashflowStatementHistory`,
      {
        headers: { accept: "application/json", "user-agent": "myfinancialportfolio-next/1.0" },
        next: { revalidate: 3600 }
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

function formatRatio(value: number | null, type: "number" | "percent") {
  if (value === null) {
    return "N/A";
  }
  if (type === "percent") {
    return `${(value * 100).toFixed(2)}%`;
  }
  return value.toFixed(2);
}

function ratioValues(summary: Record<string, unknown>) {
  const price = (summary.price || {}) as Record<string, unknown>;
  const financialData = (summary.financialData || {}) as Record<string, unknown>;
  const stats = (summary.defaultKeyStatistics || {}) as Record<string, unknown>;
  const eps = numberOrNull(rawValue(stats.trailingEps));
  const marketPrice = numberOrNull(rawValue(price.regularMarketPrice));
  const per = numberOrNull(rawValue(stats.trailingPE)) ?? (eps && marketPrice ? marketPrice / eps : null);
  return {
    eps,
    per,
    netMargin: numberOrNull(rawValue(financialData.profitMargins)),
    operatingMargin: numberOrNull(rawValue(financialData.operatingMargins)),
    roe: numberOrNull(rawValue(financialData.returnOnEquity))
  };
}

function average(values: Array<number | null>) {
  const valid = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

async function financialRatios(summary: Record<string, unknown>, peerSymbols: string[]): Promise<{ rows: FinancialRatioRow[]; peerCount: number }> {
  const company = ratioValues(summary);
  const peerSummaries = await Promise.all(peerSymbols.slice(0, 5).map((peer) => fetchYahooSummary(peer)));
  const peers = peerSummaries.map(ratioValues);
  const peerCount = peers.filter((peer) => peer.eps !== null || peer.per !== null || peer.netMargin !== null || peer.operatingMargin !== null || peer.roe !== null).length;
  return {
    peerCount,
    rows: [
      {
        metric: "EPS",
        company: formatRatio(company.eps, "number"),
        industryAverage: formatRatio(average(peers.map((peer) => peer.eps)), "number")
      },
      {
        metric: "PER",
        company: formatRatio(company.per, "number"),
        industryAverage: formatRatio(average(peers.map((peer) => peer.per)), "number")
      },
      {
        metric: "Net Profit Margin",
        company: formatRatio(company.netMargin, "percent"),
        industryAverage: formatRatio(average(peers.map((peer) => peer.netMargin)), "percent")
      },
      {
        metric: "Operating Margin",
        company: formatRatio(company.operatingMargin, "percent"),
        industryAverage: formatRatio(average(peers.map((peer) => peer.operatingMargin)), "percent")
      },
      {
        metric: "ROE",
        company: formatRatio(company.roe, "percent"),
        industryAverage: formatRatio(average(peers.map((peer) => peer.roe)), "percent")
      }
    ]
  };
}

export async function buildSymbolDetail(symbol: string, range: ChartRange = "1M"): Promise<SymbolDetailResponse> {
  const normalized = normalizeSymbol(symbol);
  const [quote, chart, summary] = await Promise.all([getQuote(normalized), fetchChart(normalized, range), fetchYahooSummary(normalized)]);
  const profile = (summary.summaryProfile || {}) as Record<string, unknown>;
  const priceModule = (summary.price || {}) as Record<string, unknown>;
  const financialData = (summary.financialData || {}) as Record<string, unknown>;
  const sector = String(profile.sector || (isCryptoSymbol(normalized) ? "crypto" : ""));
  const peerSymbols = SECTOR_PEERS[sector] || SECTOR_PEERS.crypto;
  const comparablePeers = peerSymbols.filter((peer) => peer !== normalized);
  const [peers, ratios] = await Promise.all([
    getQuotes(comparablePeers),
    financialRatios(summary, comparablePeers)
  ]);
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
    profile: {
      name: String(rawValue(priceModule.longName) || rawValue(priceModule.shortName) || normalized),
      sector,
      industry: String(profile.industry || ""),
      country: String(profile.country || ""),
      website: String(profile.website || ""),
      summary: String(profile.longBusinessSummary || "")
    },
    metrics: {
      avgReturnPct:
        closes.length >= 2 && closes[0] !== 0 ? ((closes[closes.length - 1] / closes[0] - 1) * 100) : null,
      volatilityPct: variance === null || avg === null || avg === 0 ? null : (Math.sqrt(variance) / avg) * 100,
      high: closes.length ? Math.max(...closes) : null,
      low: closes.length ? Math.min(...closes) : null,
      volume: numberOrNull(financialData.totalRevenue) ?? chart.at(-1)?.volume ?? null
    },
    peers: Array.from(peers.values()).slice(0, 6),
    statements: {
      income: buildFinancialStatement(summary.incomeStatementHistory, "incomeStatementHistory", INCOME_LINES),
      balance: buildFinancialStatement(summary.balanceSheetHistory, "balanceSheetStatements", BALANCE_LINES),
      cashflow: buildFinancialStatement(summary.cashflowStatementHistory, "cashflowStatements", CASHFLOW_LINES),
      ratios: ratios.rows,
      ratioPeerCount: ratios.peerCount,
      ratioIndustry: String(profile.industry || sector || "industry")
    },
    refreshedAt: new Date().toISOString()
  };
}

export function marketKeys() {
  return Object.keys(MARKET_CONFIG) as MarketKey[];
}
