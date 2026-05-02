import { cryptoBaseSymbol, isCryptoSymbol, marketDataSymbol, normalizeSymbol } from "./symbols";
import { getQuote, getQuotes } from "./prices";
import type { ChartPoint, FinancialRatioRow, FinancialStatement, MarketMoverRow, MarketPageResponse, Quote, SymbolDetailResponse } from "./types";

type MarketKey = "crypto" | "us" | "korea";

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
      "ADA-KRW",
      "LINK-KRW",
      "AVAX-KRW",
      "ONDO-KRW",
      "AAVE-KRW",
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
  const payload = quote as Quote & { volume?: number | null; tradingValue?: number | null };
  return {
    symbol: quote.symbol,
    price: quote.price,
    changePct: quote.changePct,
    volume: payload.volume ?? null,
    tradingValue: payload.tradingValue ?? ((payload.volume && quote.price) ? payload.volume * quote.price : null),
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

async function fetchYahooChart(symbol: string, range = "1mo", interval = "1d"): Promise<ChartPoint[]> {
  const providerSymbol = marketDataSymbol(symbol);
  const response = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(providerSymbol)}?range=${range}&interval=${interval}`,
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
  const closes = quote?.close || [];
  const volumes = quote?.volume || [];
  return timestamps
    .map((timestamp, index) => ({
      time: new Date(timestamp * 1000).toISOString(),
      close: numberOrNull(closes[index]),
      volume: numberOrNull(volumes[index])
    }))
    .filter((point): point is ChartPoint => point.close !== null);
}

async function fetchUpbitChart(symbol: string): Promise<ChartPoint[]> {
  const base = cryptoBaseSymbol(symbol);
  const response = await fetch(`https://api.upbit.com/v1/candles/days?market=KRW-${encodeURIComponent(base)}&count=30`, {
    headers: { accept: "application/json" },
    cache: "no-store"
  });
  if (!response.ok) {
    return [];
  }
  const rows = (await response.json()) as Array<Record<string, unknown>>;
  return rows
    .map((row) => ({
      time: String(row.candle_date_time_utc || ""),
      close: numberOrNull(row.trade_price),
      volume: numberOrNull(row.candle_acc_trade_volume)
    }))
    .filter((point): point is ChartPoint => Boolean(point.time) && point.close !== null)
    .reverse();
}

export async function fetchChart(symbol: string) {
  const normalized = normalizeSymbol(symbol);
  if (isCryptoSymbol(normalized) && normalized.endsWith("-KRW")) {
    const upbit = await fetchUpbitChart(normalized);
    if (upbit.length) {
      return upbit;
    }
  }
  return fetchYahooChart(normalized, "1mo", "1d");
}

export async function buildMarketPage(market: MarketKey): Promise<MarketPageResponse> {
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
      chart: await fetchChart(config.representative)
    },
    indices: config.indices.map((symbol) => quoteMap.get(symbol)).filter((quote): quote is Quote => Boolean(quote)),
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

export async function buildSymbolDetail(symbol: string): Promise<SymbolDetailResponse> {
  const normalized = normalizeSymbol(symbol);
  const [quote, chart, summary] = await Promise.all([getQuote(normalized), fetchChart(normalized), fetchYahooSummary(normalized)]);
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
