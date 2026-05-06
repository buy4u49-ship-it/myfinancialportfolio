import { buildFinancialFundamentalFromSources } from "./marketData";
import { getCachedMarketQuotes } from "./prices";
import { normalizeSymbol } from "./symbols";
import { getStrategyUniverse } from "./strategyMetricCache";
import { supabaseAdmin } from "./supabaseAdmin";
import type { FinancialFundamentalSnapshot, StrategyMarket } from "./types";

const FINANCIAL_FUNDAMENTALS_CACHE_TABLE = "financial_fundamentals_cache";
export const FINANCIAL_FUNDAMENTALS_CACHE_MAX_AGE_MS = 31 * 24 * 60 * 60 * 1000;
const STRATEGY_QUOTE_MAX_AGE_MS = 15 * 60 * 1000;

type RefreshOptions = {
  markets?: StrategyMarket[];
  limit?: number;
  force?: boolean;
};

type RefreshResult = {
  markets: StrategyMarket[];
  universeCount: number;
  cachedCount: number;
  staleCount: number;
  refreshedCount: number;
  errors: Array<{ symbol: string; market: StrategyMarket; message: string }>;
  refreshedAt: string;
};

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

function isStockMarket(market: StrategyMarket): market is Exclude<StrategyMarket, "crypto"> {
  return market === "us" || market === "korea";
}

function isFresh(refreshedAt: string | undefined) {
  const refreshed = refreshedAt ? Date.parse(refreshedAt) : 0;
  return Number.isFinite(refreshed) && Date.now() - refreshed <= FINANCIAL_FUNDAMENTALS_CACHE_MAX_AGE_MS;
}

function rowToSnapshot(row: Record<string, unknown>): FinancialFundamentalSnapshot | null {
  const market = String(row.market || "") as StrategyMarket;
  const symbol = normalizeSymbol(String(row.symbol || ""));
  if (!symbol || !isStockMarket(market)) {
    return null;
  }
  const numberOrNull = (value: unknown) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  };
  return {
    symbol,
    market,
    name: String(row.name || symbol),
    sector: String(row.sector || ""),
    industry: String(row.industry || ""),
    currency: String(row.currency || ""),
    fiscalYear: numberOrNull(row.fiscal_year),
    eps: numberOrNull(row.eps),
    roePct: numberOrNull(row.roe_pct),
    netIncome: numberOrNull(row.net_income),
    averageEquity: numberOrNull(row.average_equity),
    marketCap: numberOrNull(row.market_cap),
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
    net_income: snapshot.netIncome,
    average_equity: snapshot.averageEquity,
    market_cap: snapshot.marketCap,
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
      .select(
        "symbol,market,name,sector,industry,currency,fiscal_year,eps,roe_pct,net_income,average_equity,market_cap,price_at_refresh,source,refreshed_at"
      )
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

export async function writeFinancialFundamentalsCache(snapshots: FinancialFundamentalSnapshot[]) {
  if (!snapshots.length) {
    return;
  }
  for (const rowChunk of chunk(snapshots.map(snapshotToRow), 100)) {
    const { error } = await supabaseAdmin()
      .from(FINANCIAL_FUNDAMENTALS_CACHE_TABLE)
      .upsert(rowChunk, { onConflict: "symbol,market" });
    if (error && isMissingMarketCapColumn(error)) {
      const fallbackRows = rowChunk.map(({ market_cap: _marketCap, ...row }) => row);
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
        return {
          market,
          symbol,
          snapshot,
          refreshedAtMs: snapshot?.refreshedAt ? Date.parse(snapshot.refreshedAt) : 0
        };
      })
    )
    .filter((item) => options.force || !item.snapshot || !isFresh(item.snapshot.refreshedAt))
    .sort((a, b) => a.refreshedAtMs - b.refreshedAtMs)
    .slice(0, limit);

  const snapshots: FinancialFundamentalSnapshot[] = [];
  const errors: RefreshResult["errors"] = [];
  for (const candidateChunk of chunk(candidates, 5)) {
    const settled = await Promise.allSettled(
      candidateChunk.map((candidate) =>
        buildFinancialFundamentalFromSources(candidate.symbol, candidate.market, quoteCache.get(candidate.symbol) || null)
      )
    );
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
    refreshedAt: new Date().toISOString()
  };
}

export function financialFundamentalFresh(snapshot: FinancialFundamentalSnapshot) {
  return isFresh(snapshot.refreshedAt);
}

export const STRATEGY_QUOTE_CACHE_MAX_AGE_MS = STRATEGY_QUOTE_MAX_AGE_MS;
