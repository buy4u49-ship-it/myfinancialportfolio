import { buildFinancialFundamentalFromSources, buildFinancialFundamentalProfileFromSources, epsUnavailableReasonForSecurity } from "./marketData";
import { getCachedMarketQuotes } from "./prices";
import { normalizeSymbol } from "./symbols";
import { getStrategyUniverse } from "./strategyMetricCache";
import { supabaseAdmin } from "./supabaseAdmin";
import type { FinancialFundamentalSnapshot, StrategyMarket } from "./types";

const FINANCIAL_FUNDAMENTALS_CACHE_TABLE = "financial_fundamentals_cache";
export const FINANCIAL_FUNDAMENTALS_CACHE_MAX_AGE_MS = 31 * 24 * 60 * 60 * 1000;
const STRATEGY_QUOTE_MAX_AGE_MS = 15 * 60 * 1000;

const REFRESH_ITEM_TIMEOUT_MS = 7_000;
const REFRESH_REQUEST_TIME_BUDGET_MS = 45_000;

type RefreshOptions = {
  markets?: StrategyMarket[];
  limit?: number;
  force?: boolean;
  deadlineMs?: number;
};

type RefreshResult = {
  markets: StrategyMarket[];
  universeCount: number;
  cachedCount: number;
  staleCount: number;
  refreshedCount: number;
  errors: Array<{ symbol: string; market: StrategyMarket; message: string }>;
  refreshedAt: string;
  timeBudgetReached?: boolean;
};

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_resolve, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function uniqueSorted(symbols: string[]) {
  return Array.from(new Set(symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean))).sort();
}

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message || "");
  }
  return String(error || "");
}

function isMissingFundamentalsTable(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code || "") : "";
  const message = errorMessage(error).toLowerCase();
  return code === "42P01" || code === "PGRST205" || message.includes("does not exist") || message.includes("could not find the table") || message.includes("schema cache");
}

function isMissingMarketCapColumn(error: unknown) {
  const message = errorMessage(error).toLowerCase();
  return message.includes("market_cap") && (message.includes("column") || message.includes("schema cache"));
}

function isMissingFinancialColumn(error: unknown) {
  const message = errorMessage(error).toLowerCase();
  return (message.includes("column") || message.includes("schema cache")) && message.includes("financial_fundamentals_cache");
}

function isStockMarket(market: StrategyMarket): market is Exclude<StrategyMarket, "crypto"> {
  return market === "us" || market === "korea";
}

function isMissingClassification(snapshot: FinancialFundamentalSnapshot | undefined) {
  if (!snapshot) {
    return true;
  }
  const sector = snapshot.sector.trim();
  const industry = snapshot.industry.trim();
  return !sector || !industry || sector === "Unclassified" || industry === "Unclassified";
}

function epsUnavailableReason(snapshot: FinancialFundamentalSnapshot | undefined, symbol: string) {
  return (
    snapshot?.epsUnavailableReason ||
    (snapshot?.source === "fundamental_not_applicable" ? "not_applicable" : "") ||
    epsUnavailableReasonForSecurity({
      symbol,
      name: snapshot?.name,
      sector: snapshot?.sector,
      industry: snapshot?.industry
    }) ||
    ""
  );
}

function isFresh(refreshedAt: string | undefined) {
  const refreshed = refreshedAt ? Date.parse(refreshedAt) : 0;
  return Number.isFinite(refreshed) && Date.now() - refreshed <= FINANCIAL_FUNDAMENTALS_CACHE_MAX_AGE_MS;
}

function canRepairClassificationOnly(item: {
  snapshot?: FinancialFundamentalSnapshot;
  officialSource: boolean;
  missingEps: boolean;
  missingClassification: boolean;
  missingDerivedMetrics?: boolean;
}) {
  return Boolean(
    item.snapshot &&
      item.missingClassification &&
      !item.missingDerivedMetrics &&
      isFresh(item.snapshot.refreshedAt) &&
      (!item.missingEps || item.officialSource)
  );
}

function missingStatementDerivedMetrics(snapshot: FinancialFundamentalSnapshot | undefined) {
  if (!snapshot || snapshot.source === "fundamental_not_applicable" || snapshot.fundamentalType === "non_operating_security") {
    return false;
  }
  const statementMetrics = [
    snapshot.roaPct,
    snapshot.netMarginPct,
    snapshot.operatingMarginPct,
    snapshot.revenueGrowthPct,
    snapshot.operatingIncomeGrowthPct,
    snapshot.earningsGrowthPct,
    snapshot.revenue,
    snapshot.operatingIncome,
    snapshot.totalAssets,
    snapshot.totalEquity
  ];
  return statementMetrics.every((value) => value === null || value === undefined) || snapshot.revenueGrowthPct === null || snapshot.revenueGrowthPct === undefined;
}

function rowToSnapshot(row: Record<string, unknown>): FinancialFundamentalSnapshot | null {
  const market = String(row.market || "") as StrategyMarket;
  const symbol = normalizeSymbol(String(row.symbol || ""));
  if (!symbol || !isStockMarket(market)) {
    return null;
  }
  const numberOrNull = (value: unknown) => {
    if (value === null || value === undefined || value === "") {
      return null;
    }
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  };
  const epsOrNull = (value: unknown) => {
    const eps = numberOrNull(value);
    return eps === 0 ? null : eps;
  };
  return {
    symbol,
    market,
    name: String(row.name || symbol),
    sector: String(row.sector || ""),
    industry: String(row.industry || ""),
    currency: String(row.currency || ""),
    fiscalYear: numberOrNull(row.fiscal_year),
    eps: epsOrNull(row.eps),
    roePct: numberOrNull(row.roe_pct),
    roaPct: numberOrNull(row.roa_pct),
    netMarginPct: numberOrNull(row.net_margin_pct),
    operatingMarginPct: numberOrNull(row.operating_margin_pct),
    revenueGrowthPct: numberOrNull(row.revenue_growth_pct),
    operatingIncomeGrowthPct: numberOrNull(row.operating_income_growth_pct),
    earningsGrowthPct: numberOrNull(row.earnings_growth_pct),
    revenue: numberOrNull(row.revenue),
    operatingIncome: numberOrNull(row.operating_income),
    netIncome: numberOrNull(row.net_income),
    totalAssets: numberOrNull(row.total_assets),
    averageAssets: numberOrNull(row.average_assets),
    totalEquity: numberOrNull(row.total_equity),
    averageEquity: numberOrNull(row.average_equity),
    marketCap: numberOrNull(row.market_cap),
    sharesOutstanding: numberOrNull(row.shares_outstanding),
    bookValuePerShare: numberOrNull(row.book_value_per_share),
    ebitda: numberOrNull(row.ebitda),
    totalDebt: numberOrNull(row.total_debt),
    cashAndShortInvestments: numberOrNull(row.cash_and_short_investments),
    fundamentalType: row.fundamental_type === null || row.fundamental_type === undefined ? null : String(row.fundamental_type),
    epsUnavailableReason:
      row.eps_unavailable_reason === null || row.eps_unavailable_reason === undefined ? null : String(row.eps_unavailable_reason),
    priceAtRefresh: numberOrNull(row.price_at_refresh),
    source: String(row.source || "financial_fundamentals_cache"),
    refreshedAt: String(row.refreshed_at || "")
  };
}

function snapshotToRow(snapshot: FinancialFundamentalSnapshot) {
  return {
    symbol: snapshot.symbol,
    market: snapshot.market,
    name: snapshot.name,
    sector: snapshot.sector,
    industry: snapshot.industry,
    currency: snapshot.currency,
    fiscal_year: snapshot.fiscalYear,
    eps: snapshot.eps,
    roe_pct: snapshot.roePct,
    roa_pct: snapshot.roaPct,
    net_margin_pct: snapshot.netMarginPct,
    operating_margin_pct: snapshot.operatingMarginPct,
    revenue_growth_pct: snapshot.revenueGrowthPct,
    operating_income_growth_pct: snapshot.operatingIncomeGrowthPct,
    earnings_growth_pct: snapshot.earningsGrowthPct,
    revenue: snapshot.revenue,
    operating_income: snapshot.operatingIncome,
    net_income: snapshot.netIncome,
    total_assets: snapshot.totalAssets,
    average_assets: snapshot.averageAssets,
    total_equity: snapshot.totalEquity,
    average_equity: snapshot.averageEquity,
    market_cap: snapshot.marketCap,
    shares_outstanding: snapshot.sharesOutstanding,
    book_value_per_share: snapshot.bookValuePerShare,
    ebitda: snapshot.ebitda,
    total_debt: snapshot.totalDebt,
    cash_and_short_investments: snapshot.cashAndShortInvestments,
    fundamental_type: snapshot.fundamentalType,
    eps_unavailable_reason: snapshot.epsUnavailableReason,
    price_at_refresh: snapshot.priceAtRefresh,
    source: snapshot.source,
    refreshed_at: snapshot.refreshedAt,
    updated_at: new Date().toISOString()
  };
}

export async function readFinancialFundamentalsCache(symbols: string[], markets?: StrategyMarket[]) {
  const uniqueSymbols = uniqueSorted(symbols);
  const stockMarkets = markets?.filter(isStockMarket);
  if (!uniqueSymbols.length || (markets && !stockMarkets?.length)) {
    return new Map<string, FinancialFundamentalSnapshot>();
  }

  const rows: Record<string, unknown>[] = [];
  for (const symbolChunk of chunk(uniqueSymbols, 250)) {
    let query = supabaseAdmin()
      .from(FINANCIAL_FUNDAMENTALS_CACHE_TABLE)
      .select("*")
      .in("symbol", symbolChunk);
    if (stockMarkets?.length) {
      query = query.in("market", stockMarkets);
    }
    const response = await query;
    let data = response.data as Record<string, unknown>[] | null;
    let error = response.error;
    if (error && isMissingMarketCapColumn(error)) {
      let fallbackQuery = supabaseAdmin()
        .from(FINANCIAL_FUNDAMENTALS_CACHE_TABLE)
        .select(
          "symbol,market,name,sector,industry,currency,fiscal_year,eps,roe_pct,net_income,average_equity,price_at_refresh,source,refreshed_at"
        )
        .in("symbol", symbolChunk);
      if (stockMarkets?.length) {
        fallbackQuery = fallbackQuery.in("market", stockMarkets);
      }
      const fallback = await fallbackQuery;
      data = fallback.data as Record<string, unknown>[] | null;
      error = fallback.error;
    }
    if (error) {
      if (isMissingFundamentalsTable(error)) {
        return new Map<string, FinancialFundamentalSnapshot>();
      }
      throw new Error(errorMessage(error) || "Financial fundamentals cache read failed.");
    }
    rows.push(...((data || []) as Record<string, unknown>[]));
  }

  const snapshots = new Map<string, FinancialFundamentalSnapshot>();
  rows.forEach((row) => {
    const snapshot = rowToSnapshot(row);
    if (snapshot) {
      snapshots.set(`${snapshot.market}:${snapshot.symbol}`, snapshot);
    }
  });
  return snapshots;
}

function baseFinancialRow(row: ReturnType<typeof snapshotToRow>) {
  return {
    symbol: row.symbol,
    market: row.market,
    name: row.name,
    sector: row.sector,
    industry: row.industry,
    currency: row.currency,
    fiscal_year: row.fiscal_year,
    eps: row.eps,
    roe_pct: row.roe_pct,
    net_income: row.net_income,
    average_equity: row.average_equity,
    price_at_refresh: row.price_at_refresh,
    source: row.source,
    refreshed_at: row.refreshed_at,
    updated_at: row.updated_at
  };
}

export async function writeFinancialFundamentalsCache(snapshots: FinancialFundamentalSnapshot[]) {
  if (!snapshots.length) {
    return;
  }
  for (const rowChunk of chunk(snapshots.map(snapshotToRow), 100)) {
    const { error } = await supabaseAdmin()
      .from(FINANCIAL_FUNDAMENTALS_CACHE_TABLE)
      .upsert(rowChunk, { onConflict: "symbol,market" });
    if (error && (isMissingMarketCapColumn(error) || isMissingFinancialColumn(error))) {
      const fallbackRows = rowChunk.map(baseFinancialRow);
      const fallback = await supabaseAdmin()
        .from(FINANCIAL_FUNDAMENTALS_CACHE_TABLE)
        .upsert(fallbackRows, { onConflict: "symbol,market" });
      if (!fallback.error) {
        continue;
      }
      throw new Error(errorMessage(fallback.error) || "Financial fundamentals cache write failed.");
    }
    if (error) {
      throw new Error(errorMessage(error) || "Financial fundamentals cache write failed.");
    }
  }
}

export async function refreshFinancialFundamentalsCache(options: RefreshOptions = {}): Promise<RefreshResult> {
  const startedAt = Date.now();
  const timeBudgetMs = Math.max(5_000, Math.min(55_000, Math.round(options.deadlineMs || REFRESH_REQUEST_TIME_BUDGET_MS)));
  const markets = (options.markets?.length ? options.markets : (["us", "korea"] as StrategyMarket[])).filter(isStockMarket);
  const limit = Math.max(1, Math.min(300, Math.round(options.limit || 50)));
  const universeByMarket = await Promise.all(markets.map(async (market) => ({ market, symbols: await getStrategyUniverse(market) })));
  const allSymbols = universeByMarket.flatMap((item) => item.symbols);
  const cache = await readFinancialFundamentalsCache(allSymbols, markets);
  const quoteCache = await getCachedMarketQuotes(allSymbols, { maxAgeMs: STRATEGY_QUOTE_MAX_AGE_MS });
  const candidates = universeByMarket
    .flatMap(({ market, symbols }) =>
      symbols.map((symbol) => {
        const snapshot = cache.get(`${market}:${symbol}`);
        const officialSource = snapshot?.source === "sec_company_facts" || snapshot?.source === "opendart_monthly_cache";
        const epsNotApplicable = Boolean(epsUnavailableReason(snapshot, symbol));
        const missingEps = (snapshot?.eps === null || snapshot?.eps === 0) && !epsNotApplicable;
        const missingClassification = isMissingClassification(snapshot);
        const missingDerivedMetrics = missingStatementDerivedMetrics(snapshot);
        return {
          market,
          symbol,
          snapshot,
          officialSource,
          epsNotApplicable,
          missingEps,
          missingClassification,
          missingDerivedMetrics,
          refreshedAtMs: snapshot?.refreshedAt ? Date.parse(snapshot.refreshedAt) : 0
        };
      })
    )
    .filter(
      (item) =>
        options.force ||
        !item.snapshot ||
        item.missingClassification ||
        item.missingDerivedMetrics ||
        !isFresh(item.snapshot.refreshedAt) ||
        (item.missingEps && !item.officialSource)
    )
    .sort((a, b) => {
      const priority = (item: {
        snapshot?: FinancialFundamentalSnapshot;
        officialSource: boolean;
        missingEps: boolean;
        missingClassification: boolean;
        missingDerivedMetrics: boolean;
      }) => {
        if (!item.snapshot) {
          return 0;
        }
        if (item.missingClassification) {
          return 1;
        }
        if (item.missingEps && !item.officialSource) {
          return 2;
        }
        if (item.missingEps) {
          return 3;
        }
        if (item.missingDerivedMetrics) {
          return 4;
        }
        if (!item.officialSource) {
          return 5;
        }
        return 6;
      };
      return priority(a) - priority(b) || a.refreshedAtMs - b.refreshedAtMs;
    })
    .slice(0, limit);

  const snapshots: FinancialFundamentalSnapshot[] = [];
  const errors: RefreshResult["errors"] = [];
  let processedCount = 0;
  let timeBudgetReached = false;
  for (const candidateChunk of chunk(candidates, 2)) {
    const remainingMs = timeBudgetMs - (Date.now() - startedAt);
    if (remainingMs < 1_500) {
      timeBudgetReached = true;
      break;
    }
    const itemTimeoutMs = Math.max(1_000, Math.min(REFRESH_ITEM_TIMEOUT_MS, remainingMs - 500));
    const settled = await Promise.allSettled(
      candidateChunk.map((candidate) =>
        withTimeout(
          canRepairClassificationOnly(candidate)
            ? buildFinancialFundamentalProfileFromSources(candidate.symbol, candidate.market, quoteCache.get(candidate.symbol) || null).then((profile) => {
                if (!profile || !profile.sector || !profile.industry || !candidate.snapshot) {
                  return null;
                }
                return {
                  ...candidate.snapshot,
                  name: profile.name || candidate.snapshot.name,
                  sector: profile.sector,
                  industry: profile.industry,
                  currency: profile.currency || candidate.snapshot.currency,
                  fundamentalType: profile.fundamentalType || candidate.snapshot.fundamentalType,
                  epsUnavailableReason: profile.epsUnavailableReason || candidate.snapshot.epsUnavailableReason
                };
              })
            : buildFinancialFundamentalFromSources(candidate.symbol, candidate.market, quoteCache.get(candidate.symbol) || null),
          itemTimeoutMs,
          `Financial fundamentals refresh timed out for ${candidate.symbol}.`
        )
      )
    );
    processedCount += candidateChunk.length;
    settled.forEach((result, index) => {
      const candidate = candidateChunk[index];
      if (result.status === "fulfilled") {
        if (result.value) {
          snapshots.push(result.value);
        }
      } else {
        errors.push({
          symbol: candidate.symbol,
          market: candidate.market,
          message: result.reason instanceof Error ? result.reason.message : "Financial fundamentals refresh failed."
        });
      }
    });
  }
  if (processedCount < candidates.length && Date.now() - startedAt >= timeBudgetMs - 1_500) {
    timeBudgetReached = true;
  }
  await writeFinancialFundamentalsCache(snapshots);

  const refreshedKeys = new Set(snapshots.map((snapshot) => `${snapshot.market}:${snapshot.symbol}`));
  const cachedCount = cache.size + snapshots.filter((snapshot) => !cache.has(`${snapshot.market}:${snapshot.symbol}`)).length;
  const staleCount = universeByMarket.reduce((sum, { market, symbols }) => {
    return (
      sum +
      symbols.filter((symbol) => {
        const key = `${market}:${symbol}`;
        if (refreshedKeys.has(key)) {
          return false;
        }
        const snapshot = cache.get(key);
        return snapshot ? !isFresh(snapshot.refreshedAt) : false;
      }).length
    );
  }, 0);

  return {
    markets,
    universeCount: universeByMarket.reduce((sum, item) => sum + item.symbols.length, 0),
    cachedCount,
    staleCount,
    refreshedCount: snapshots.length,
    errors,
    refreshedAt: new Date().toISOString(),
    timeBudgetReached
  };
}

export function financialFundamentalFresh(snapshot: FinancialFundamentalSnapshot) {
  return isFresh(snapshot.refreshedAt);
}

export const STRATEGY_QUOTE_CACHE_MAX_AGE_MS = STRATEGY_QUOTE_MAX_AGE_MS;
