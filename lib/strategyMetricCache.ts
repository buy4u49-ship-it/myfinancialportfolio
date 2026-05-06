import { buildSymbolDetail, fetchChart } from "./marketData";
import { normalizeSymbol } from "./symbols";
import { supabaseAdmin } from "./supabaseAdmin";
import { getUpbitKrwSymbols } from "./upbitMarkets";
import type { StrategyMarket, StrategyMetricKey, StrategyMetricSnapshot, SymbolDetailResponse } from "./types";

const STRATEGY_METRIC_CACHE_TABLE = "strategy_metric_cache";
export const STRATEGY_METRIC_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const UNIVERSE_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
type StrategyTechnicalDailyPoint = NonNullable<StrategyMetricSnapshot["technical"]>["daily"][number];

type UniverseCacheEntry = {
  symbols: string[];
  updatedAt: number;
};

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

const universeCache: Partial<Record<StrategyMarket, UniverseCacheEntry>> = {};

const FALLBACK_US_UNIVERSE = [
  "AAPL",
  "MSFT",
  "NVDA",
  "GOOGL",
  "GOOG",
  "AMZN",
  "META",
  "TSLA",
  "AVGO",
  "LLY",
  "JPM",
  "V",
  "UNH",
  "XOM",
  "MA",
  "WMT",
  "COST",
  "PG",
  "HD",
  "ORCL",
  "NFLX",
  "JNJ",
  "BAC",
  "ABBV",
  "KO",
  "PLTR",
  "GE",
  "PM",
  "CSCO",
  "AMD",
  "CRM",
  "IBM",
  "ABT",
  "MCD",
  "LIN",
  "DIS",
  "AXP",
  "GS",
  "T",
  "RTX",
  "MRK",
  "PEP",
  "NOW",
  "INTU",
  "ISRG",
  "UBER",
  "BKNG",
  "QCOM",
  "TXN",
  "AMGN",
  "VZ",
  "CAT",
  "SPGI",
  "PGR",
  "BLK",
  "SCHW",
  "TMO",
  "SYK",
  "HON",
  "AMAT",
  "NEE",
  "LOW",
  "ADBE",
  "TJX",
  "GILD",
  "PFE",
  "PANW",
  "DHR",
  "BSX",
  "UNP",
  "C",
  "DE",
  "ETN",
  "MU",
  "LRCX",
  "ADI",
  "VRTX",
  "KKR",
  "MMC",
  "CB",
  "COP",
  "MDT",
  "NKE",
  "SBUX",
  "BA",
  "PYPL",
  "SHOP",
  "MELI",
  "PDD",
  "BABA"
];

const FALLBACK_KOREA_UNIVERSE = [
  "005930.KS",
  "000660.KS",
  "373220.KS",
  "207940.KS",
  "005380.KS",
  "000270.KS",
  "068270.KS",
  "035420.KS",
  "105560.KS",
  "012450.KS",
  "035720.KS",
  "066570.KS",
  "012330.KS",
  "055550.KS",
  "032830.KS",
  "086790.KS",
  "316140.KS",
  "003670.KS",
  "051910.KS",
  "006400.KS",
  "028260.KS",
  "009540.KS",
  "034020.KS",
  "096770.KS",
  "003550.KS",
  "015760.KS",
  "033780.KS",
  "017670.KS",
  "018260.KS",
  "010130.KS",
  "011200.KS",
  "251270.KS",
  "259960.KS",
  "352820.KS",
  "247540.KQ",
  "086520.KQ",
  "091990.KQ",
  "196170.KQ",
  "263750.KQ",
  "035900.KQ",
  "112040.KQ",
  "293490.KQ",
  "067310.KQ"
];

function uniqueSorted(symbols: string[]) {
  return Array.from(new Set(symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean))).sort();
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function isCacheFresh(refreshedAt: string | undefined) {
  const refreshed = refreshedAt ? Date.parse(refreshedAt) : 0;
  return Number.isFinite(refreshed) && Date.now() - refreshed <= STRATEGY_METRIC_CACHE_MAX_AGE_MS;
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

function isMissingStrategyMetricCacheTable(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code || "") : "";
  const message = errorMessage(error).toLowerCase();
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    message.includes("does not exist") ||
    message.includes("could not find the table") ||
    message.includes("schema cache")
  );
}

function isMissingTechnicalPayloadColumn(error: unknown) {
  const message = errorMessage(error).toLowerCase();
  return message.includes("technical_payload") && (message.includes("column") || message.includes("schema cache"));
}

function normalizeMarket(input: unknown): StrategyMarket | null {
  const market = String(input || "").trim().toLowerCase();
  return market === "us" || market === "korea" || market === "crypto" ? market : null;
}

function defaultBenchmark(market: StrategyMarket) {
  if (market === "korea") {
    return "^KS11";
  }
  if (market === "crypto") {
    return "BTC-KRW";
  }
  return "SPY";
}

function currentValuation(detail: SymbolDetailResponse) {
  return detail.benchmark.valuationHistory.find((point) => point.label === "Current") || detail.benchmark.valuationHistory[0];
}

function detailMetrics(detail: SymbolDetailResponse): Partial<Record<StrategyMetricKey, number | null>> {
  const valuation = currentValuation(detail);
  return {
    price: detail.quote.price,
    changePct: detail.quote.changePct,
    oneMonthReturnPct: detail.metrics.avgReturnPct,
    oneMonthVolatilityPct: detail.metrics.volatilityPct,
    standardDeviationPct: detail.metrics.volatilityPct,
    companyPer: valuation?.companyPer ?? null,
    industryPer: valuation?.industryPer ?? null,
    companyRoe: valuation?.companyRoe === null || valuation?.companyRoe === undefined ? null : valuation.companyRoe * 100,
    industryRoe: valuation?.industryRoe === null || valuation?.industryRoe === undefined ? null : valuation.industryRoe * 100,
    rollingBeta: detail.benchmark.rollingBeta,
    industryRollingBeta: detail.benchmark.industryRollingBeta,
    fullPeriodBeta: detail.benchmark.fullPeriodBeta,
    industryFullPeriodBeta: detail.benchmark.industryFullPeriodBeta
  };
}

function cachedSnapshot(row: Record<string, unknown>): StrategyMetricSnapshot | null {
  const market = normalizeMarket(row.market);
  const symbol = normalizeSymbol(String(row.symbol || ""));
  if (!market || !symbol) {
    return null;
  }
  const rawMetrics = row.metrics && typeof row.metrics === "object" ? (row.metrics as Partial<Record<StrategyMetricKey, unknown>>) : {};
  const metrics = Object.entries(rawMetrics).reduce<Partial<Record<StrategyMetricKey, number | null>>>((next, [key, value]) => {
    const num = Number(value);
    next[key as StrategyMetricKey] = value === null || value === undefined || !Number.isFinite(num) ? null : num;
    return next;
  }, {});
  const price = Number(row.price);
  const changePct = Number(row.change_pct ?? row.changePct);
  const rawTechnical = row.technical_payload && typeof row.technical_payload === "object" ? (row.technical_payload as Record<string, unknown>) : {};
  const rawDaily = Array.isArray(rawTechnical.daily) ? rawTechnical.daily : [];
  const daily = rawDaily
    .map((point): StrategyTechnicalDailyPoint | null => {
      const record = point && typeof point === "object" ? (point as Record<string, unknown>) : {};
      const close = Number(record.close);
      const volume = Number(record.volume);
      if (!String(record.time || "") || !Number.isFinite(close)) {
        return null;
      }
      return {
        time: String(record.time),
        close,
        volume: Number.isFinite(volume) ? volume : null
      };
    })
    .filter((point): point is StrategyTechnicalDailyPoint => point !== null);
  return {
    symbol,
    market,
    name: String(row.name || symbol),
    sector: String(row.sector || ""),
    industry: String(row.industry || ""),
    price: Number.isFinite(price) ? price : null,
    changePct: Number.isFinite(changePct) ? changePct : null,
    metrics,
    technical: daily.length ? { daily } : undefined,
    source: String(row.source || "strategy_metric_cache"),
    refreshedAt: String(row.refreshed_at || row.refreshedAt || "")
  };
}

function cacheRow(snapshot: StrategyMetricSnapshot) {
  return {
    symbol: snapshot.symbol,
    market: snapshot.market,
    name: snapshot.name,
    sector: snapshot.sector,
    industry: snapshot.industry,
    price: snapshot.price,
    change_pct: snapshot.changePct,
    metrics: snapshot.metrics,
    technical_payload: snapshot.technical || null,
    source: snapshot.source,
    refreshed_at: snapshot.refreshedAt,
    updated_at: new Date().toISOString()
  };
}

function usCommonStockSymbol(symbol: string) {
  return /^[A-Z][A-Z0-9-]{0,5}$/.test(symbol) && !symbol.includes("WS") && !symbol.endsWith("W") && !symbol.endsWith("U") && !symbol.endsWith("R");
}

function usSecurityNameAllowed(name: string) {
  const lower = name.toLowerCase();
  return ![
    "warrant",
    "right",
    "unit",
    "preferred",
    "depositary",
    "note",
    "etf",
    "etn",
    "fund",
    "trust"
  ].some((word) => lower.includes(word));
}

async function fetchNasdaqDirectory(url: string, symbolColumn: string) {
  const response = await fetch(url, {
    headers: { accept: "text/plain", "user-agent": "myfinancialportfolio-next/1.0" },
    next: { revalidate: 21_600 }
  });
  if (!response.ok) {
    return [];
  }
  const text = await response.text();
  const lines = text.split(/\r?\n/).filter((line) => line.includes("|"));
  const header = lines.shift()?.split("|") || [];
  const symbolIndex = header.indexOf(symbolColumn);
  const nameIndex = header.indexOf("Security Name");
  const testIndex = header.indexOf("Test Issue");
  const etfIndex = header.indexOf("ETF");
  if (symbolIndex < 0) {
    return [];
  }
  return lines
    .map((line) => {
      const columns = line.split("|");
      return {
        symbol: String(columns[symbolIndex] || "").trim().replace(".", "-").toUpperCase(),
        name: String(columns[nameIndex] || ""),
        testIssue: String(columns[testIndex] || "N"),
        etf: String(columns[etfIndex] || "N")
      };
    })
    .filter((row) => row.testIssue !== "Y" && row.etf !== "Y" && usCommonStockSymbol(row.symbol) && usSecurityNameAllowed(row.name))
    .map((row) => row.symbol);
}

async function fetchUsUniverse() {
  const [nasdaqListed, otherListed] = await Promise.allSettled([
    fetchNasdaqDirectory("https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt", "Symbol"),
    fetchNasdaqDirectory("https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt", "ACT Symbol")
  ]);
  const symbols = [
    ...(nasdaqListed.status === "fulfilled" ? nasdaqListed.value : []),
    ...(otherListed.status === "fulfilled" ? otherListed.value : [])
  ];
  return uniqueSorted(symbols.length ? symbols : FALLBACK_US_UNIVERSE);
}

function decodeKrxBuffer(buffer: ArrayBuffer) {
  try {
    return new TextDecoder("euc-kr").decode(buffer);
  } catch {
    return new TextDecoder("utf-8").decode(buffer);
  }
}

async function fetchKrxMarket(marketType: "stockMkt" | "kosdaqMkt", suffix: ".KS" | ".KQ") {
  const url = `https://kind.krx.co.kr/corpgeneral/corpList.do?method=download&marketType=${marketType}&searchType=13`;
  const response = await fetch(url, {
    headers: { accept: "text/html", "user-agent": "myfinancialportfolio-next/1.0" },
    next: { revalidate: 21_600 }
  });
  if (!response.ok) {
    return [];
  }
  const text = decodeKrxBuffer(await response.arrayBuffer());
  const symbols = Array.from(text.matchAll(/<td[^>]*>\s*(\d{6})\s*<\/td>/gi)).map((match) => `${match[1]}${suffix}`);
  return uniqueSorted(symbols);
}

async function fetchKoreaUniverse() {
  const [kospi, kosdaq] = await Promise.allSettled([fetchKrxMarket("stockMkt", ".KS"), fetchKrxMarket("kosdaqMkt", ".KQ")]);
  const symbols = [
    ...(kospi.status === "fulfilled" ? kospi.value : []),
    ...(kosdaq.status === "fulfilled" ? kosdaq.value : [])
  ];
  return uniqueSorted(symbols.length ? symbols : FALLBACK_KOREA_UNIVERSE);
}

export async function getStrategyUniverse(market: StrategyMarket) {
  const cached = universeCache[market];
  if (cached && Date.now() - cached.updatedAt <= UNIVERSE_CACHE_MAX_AGE_MS) {
    return cached.symbols;
  }
  let symbols: string[];
  if (market === "crypto") {
    symbols = uniqueSorted(await getUpbitKrwSymbols());
  } else if (market === "korea") {
    symbols = await fetchKoreaUniverse();
  } else {
    symbols = await fetchUsUniverse();
  }
  universeCache[market] = { symbols, updatedAt: Date.now() };
  return symbols;
}

export async function readStrategyMetricCache(symbols: string[], markets?: StrategyMarket[]) {
  const uniqueSymbols = uniqueSorted(symbols);
  const rows: Record<string, unknown>[] = [];
  if (!uniqueSymbols.length) {
    return new Map<string, StrategyMetricSnapshot>();
  }

  for (const symbolChunk of chunk(uniqueSymbols, 250)) {
    let query = supabaseAdmin()
      .from(STRATEGY_METRIC_CACHE_TABLE)
      .select("symbol,market,name,sector,industry,price,change_pct,metrics,technical_payload,source,refreshed_at")
      .in("symbol", symbolChunk);
    if (markets?.length) {
      query = query.in("market", markets);
    }
    const response = await query;
    let data = response.data as Record<string, unknown>[] | null;
    let error = response.error;
    if (error && isMissingTechnicalPayloadColumn(error)) {
      let fallbackQuery = supabaseAdmin()
        .from(STRATEGY_METRIC_CACHE_TABLE)
        .select("symbol,market,name,sector,industry,price,change_pct,metrics,source,refreshed_at")
        .in("symbol", symbolChunk);
      if (markets?.length) {
        fallbackQuery = fallbackQuery.in("market", markets);
      }
      const fallback = await fallbackQuery;
      data = fallback.data as Record<string, unknown>[] | null;
      error = fallback.error;
    }
    if (error) {
      if (isMissingStrategyMetricCacheTable(error)) {
        return new Map<string, StrategyMetricSnapshot>();
      }
      throw new Error(errorMessage(error) || "Strategy metric cache read failed.");
    }
    rows.push(...((data || []) as Record<string, unknown>[]));
  }

  const map = new Map<string, StrategyMetricSnapshot>();
  rows.forEach((row) => {
    const snapshot = cachedSnapshot(row);
    if (snapshot) {
      map.set(`${snapshot.market}:${snapshot.symbol}`, snapshot);
    }
  });
  return map;
}

export async function writeStrategyMetricCache(snapshots: StrategyMetricSnapshot[]) {
  if (!snapshots.length) {
    return;
  }
  const rows = snapshots.map(cacheRow);
  for (const rowChunk of chunk(rows, 100)) {
    const { error } = await supabaseAdmin()
      .from(STRATEGY_METRIC_CACHE_TABLE)
      .upsert(rowChunk, { onConflict: "symbol,market" });
    if (error && isMissingTechnicalPayloadColumn(error)) {
      const fallbackRows = rowChunk.map(({ technical_payload: _technicalPayload, ...row }) => row);
      const fallback = await supabaseAdmin()
        .from(STRATEGY_METRIC_CACHE_TABLE)
        .upsert(fallbackRows, { onConflict: "symbol,market" });
      if (!fallback.error) {
        continue;
      }
      throw new Error(errorMessage(fallback.error) || "Strategy metric cache write failed.");
    }
    if (error) {
      throw new Error(errorMessage(error) || "Strategy metric cache write failed.");
    }
  }
}

export async function buildStrategyMetricSnapshot(symbol: string, market: StrategyMarket): Promise<StrategyMetricSnapshot> {
  const normalized = normalizeSymbol(symbol);
  const [detail, technicalChart] = await Promise.all([
    buildSymbolDetail(normalized, "1M", {
      benchmark: defaultBenchmark(market),
      historyYears: 20,
      rollingWindow: 36
    }),
    fetchChart(normalized, "1Y").catch(() => [])
  ]);
  const daily = technicalChart
    .filter((point) => Number.isFinite(point.close))
    .map((point) => ({
      time: point.time,
      close: point.close,
      volume: point.volume
    }));
  return {
    symbol: detail.symbol,
    market,
    name: detail.profile.name || detail.quote.name || detail.symbol,
    sector: detail.profile.sector || detail.quote.sector || "",
    industry: detail.profile.industry || detail.quote.industry || "",
    price: detail.quote.price,
    changePct: detail.quote.changePct,
    metrics: detailMetrics(detail),
    technical: daily.length ? { daily } : undefined,
    source: "symbol_detail",
    refreshedAt: new Date().toISOString()
  };
}

export async function refreshStrategyMetricCache(options: RefreshOptions = {}): Promise<RefreshResult> {
  const markets = options.markets?.length ? options.markets : (["us", "korea", "crypto"] as StrategyMarket[]);
  const limit = Math.max(1, Math.min(200, Math.round(options.limit || 25)));
  const universeByMarket = await Promise.all(markets.map(async (market) => ({ market, symbols: await getStrategyUniverse(market) })));
  const allSymbols = universeByMarket.flatMap((item) => item.symbols);
  const cache = await readStrategyMetricCache(allSymbols, markets);
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
    .filter((item) => options.force || !item.snapshot || !isCacheFresh(item.snapshot.refreshedAt))
    .sort((a, b) => a.refreshedAtMs - b.refreshedAtMs)
    .slice(0, limit);

  const snapshots: StrategyMetricSnapshot[] = [];
  const errors: RefreshResult["errors"] = [];
  for (const candidateChunk of chunk(candidates, 4)) {
    const settled = await Promise.allSettled(candidateChunk.map((candidate) => buildStrategyMetricSnapshot(candidate.symbol, candidate.market)));
    settled.forEach((result, index) => {
      const candidate = candidateChunk[index];
      if (result.status === "fulfilled") {
        snapshots.push(result.value);
      } else {
        errors.push({
          symbol: candidate.symbol,
          market: candidate.market,
          message: result.reason instanceof Error ? result.reason.message : "Metric refresh failed."
        });
      }
    });
  }
  await writeStrategyMetricCache(snapshots);

  const refreshedAt = new Date().toISOString();
  const refreshedKeys = new Set(snapshots.map((snapshot) => `${snapshot.market}:${snapshot.symbol}`));
  const cachedCount =
    cache.size +
    snapshots.filter((snapshot) => !cache.has(`${snapshot.market}:${snapshot.symbol}`)).length;
  const staleCount = universeByMarket.reduce((sum, { market, symbols }) => {
    return (
      sum +
      symbols.filter((symbol) => {
        const key = `${market}:${symbol}`;
        if (refreshedKeys.has(key)) {
          return false;
        }
        const snapshot = cache.get(key);
        return snapshot ? !isCacheFresh(snapshot.refreshedAt) : false;
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
    refreshedAt
  };
}

export function strategyMetricSnapshotFresh(snapshot: StrategyMetricSnapshot) {
  return isCacheFresh(snapshot.refreshedAt);
}
