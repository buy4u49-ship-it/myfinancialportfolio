import { fetchChart } from "./marketData";
import { getQuote } from "./prices";
import { normalizeSymbol } from "./symbols";
import { supabaseAdmin } from "./supabaseAdmin";
import { getUpbitKrwSymbols } from "./upbitMarkets";
import type { ChartPoint, StrategyMarket, StrategyMetricKey, StrategyMetricSnapshot } from "./types";

const STRATEGY_METRIC_CACHE_TABLE = "strategy_metric_cache";
const FINANCIAL_FUNDAMENTALS_CACHE_TABLE = "financial_fundamentals_cache";
export const STRATEGY_METRIC_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const UNIVERSE_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const CACHED_UNIVERSE_PAGE_SIZE = 1_000;
type StrategyTechnicalDailyPoint = NonNullable<StrategyMetricSnapshot["technical"]>["daily"][number];

type UniverseCacheEntry = {
  symbols: string[];
  updatedAt: number;
};

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

const universeCache: Partial<Record<StrategyMarket, UniverseCacheEntry>> = {};
const UNIVERSE_FETCH_TIMEOUT_MS = 8_000;

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

function timeoutSignal(ms: number) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(timeoutId) };
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

function cachedSnapshot(row: Record<string, unknown>): StrategyMetricSnapshot | null {
  const market = normalizeMarket(row.market);
  const symbol = normalizeSymbol(String(row.symbol || ""));
  if (!market || !symbol) {
    return null;
  }
  const numberOrNull = (value: unknown) => {
    if (value === null || value === undefined || value === "") {
      return null;
    }
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  };
  const rawMetrics = row.metrics && typeof row.metrics === "object" ? (row.metrics as Partial<Record<StrategyMetricKey, unknown>>) : {};
  const metrics = Object.entries(rawMetrics).reduce<Partial<Record<StrategyMetricKey, number | null>>>((next, [key, value]) => {
    next[key as StrategyMetricKey] = numberOrNull(value);
    return next;
  }, {});
  const price = numberOrNull(row.price);
  const changePct = numberOrNull(row.change_pct ?? row.changePct);
  const rawTechnical = row.technical_payload && typeof row.technical_payload === "object" ? (row.technical_payload as Record<string, unknown>) : {};
  const rawDaily = Array.isArray(rawTechnical.daily) ? rawTechnical.daily : [];
  const daily = rawDaily
    .map((point): StrategyTechnicalDailyPoint | null => {
      const record = point && typeof point === "object" ? (point as Record<string, unknown>) : {};
      const close = numberOrNull(record.close);
      const volume = numberOrNull(record.volume);
      if (!String(record.time || "") || close === null) {
        return null;
      }
      return {
        time: String(record.time),
        close,
        volume
      };
    })
    .filter((point): point is StrategyTechnicalDailyPoint => point !== null);
  return {
    symbol,
    market,
    name: String(row.name || symbol),
    sector: String(row.sector || ""),
    industry: String(row.industry || ""),
    price,
    changePct,
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
  const timeout = timeoutSignal(UNIVERSE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { accept: "text/plain", "user-agent": "myfinancialportfolio-next/1.0" },
      next: { revalidate: 21_600 },
      signal: timeout.signal
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
  } catch {
    return [];
  } finally {
    timeout.cancel();
  }
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
  const timeout = timeoutSignal(UNIVERSE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { accept: "text/html", "user-agent": "myfinancialportfolio-next/1.0" },
      next: { revalidate: 21_600 },
      signal: timeout.signal
    });
    if (!response.ok) {
      return [];
    }
    const text = decodeKrxBuffer(await response.arrayBuffer());
    const symbols = Array.from(text.matchAll(/<td[^>]*>\s*(\d{6})\s*<\/td>/gi)).map((match) => `${match[1]}${suffix}`);
    return uniqueSorted(symbols);
  } catch {
    return [];
  } finally {
    timeout.cancel();
  }
}

async function fetchKoreaUniverse() {
  const [kospi, kosdaq] = await Promise.allSettled([fetchKrxMarket("stockMkt", ".KS"), fetchKrxMarket("kosdaqMkt", ".KQ")]);
  const symbols = [
    ...(kospi.status === "fulfilled" ? kospi.value : []),
    ...(kosdaq.status === "fulfilled" ? kosdaq.value : [])
  ];
  return uniqueSorted(symbols.length ? symbols : FALLBACK_KOREA_UNIVERSE);
}

async function readCachedUniverseTable(table: string, market: StrategyMarket) {
  const symbols: string[] = [];
  for (let from = 0; ; from += CACHED_UNIVERSE_PAGE_SIZE) {
    const { data, error } = await supabaseAdmin()
      .from(table)
      .select("symbol")
      .eq("market", market)
      .range(from, from + CACHED_UNIVERSE_PAGE_SIZE - 1);
    if (error || !data?.length) {
      break;
    }
    symbols.push(...data.map((row) => String((row as { symbol?: unknown }).symbol || "")));
    if (data.length < CACHED_UNIVERSE_PAGE_SIZE) {
      break;
    }
  }
  return symbols;
}

async function fetchCachedUniverse(market: StrategyMarket) {
  const tables = market === "crypto" ? [STRATEGY_METRIC_CACHE_TABLE] : [FINANCIAL_FUNDAMENTALS_CACHE_TABLE, STRATEGY_METRIC_CACHE_TABLE];
  const settled = await Promise.allSettled(tables.map((table) => readCachedUniverseTable(table, market)));
  return uniqueSorted(
    settled.flatMap((result) => {
      if (result.status !== "fulfilled") {
        return [];
      }
      return result.value;
    })
  );
}

function cachedUniverseMinimum(market: StrategyMarket) {
  if (market === "crypto") {
    return 10;
  }
  if (market === "korea") {
    return 50;
  }
  return 100;
}

export async function getStrategyUniverse(market: StrategyMarket) {
  const cached = universeCache[market];
  if (cached && Date.now() - cached.updatedAt <= UNIVERSE_CACHE_MAX_AGE_MS) {
    return cached.symbols;
  }
  const cachedSymbols = await fetchCachedUniverse(market);
  if (cachedSymbols.length >= cachedUniverseMinimum(market)) {
    universeCache[market] = { symbols: cachedSymbols, updatedAt: Date.now() };
    return cachedSymbols;
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

function finiteNumber(value: number | null | undefined) {
  return value !== null && value !== undefined && Number.isFinite(value) ? value : null;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function percentChange(first: number | null, last: number | null) {
  if (first === null || last === null || first === 0) {
    return null;
  }
  return (last / first - 1) * 100;
}

function chartReturnPct(chart: ChartPoint[]) {
  const closes = chart.map((point) => finiteNumber(point.close)).filter((value): value is number => value !== null && value > 0);
  return percentChange(closes.at(0) ?? null, closes.at(-1) ?? null);
}

function chartVolatilityPct(chart: ChartPoint[]) {
  const closes = chart.map((point) => finiteNumber(point.close)).filter((value): value is number => value !== null && value > 0);
  const returns: number[] = [];
  for (let index = 1; index < closes.length; index += 1) {
    returns.push(closes[index] / closes[index - 1] - 1);
  }
  const mean = average(returns);
  if (mean === null || returns.length < 2) {
    return null;
  }
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * 100;
}

function chartReturnsByTime(chart: ChartPoint[]) {
  const points = chart.filter((point) => finiteNumber(point.close) !== null && point.close > 0);
  const returns = new Map<string, number>();
  for (let index = 1; index < points.length; index += 1) {
    const previous = finiteNumber(points[index - 1].close);
    const current = finiteNumber(points[index].close);
    if (previous !== null && current !== null && previous > 0) {
      returns.set(points[index].time, current / previous - 1);
    }
  }
  return returns;
}

function betaFromCharts(assetChart: ChartPoint[], benchmarkChart: ChartPoint[]) {
  const assetReturns = chartReturnsByTime(assetChart);
  const benchmarkReturns = chartReturnsByTime(benchmarkChart);
  const pairs = Array.from(assetReturns.entries())
    .map(([time, asset]) => ({ asset, benchmark: benchmarkReturns.get(time) }))
    .filter((point): point is { asset: number; benchmark: number } => point.benchmark !== undefined);
  if (pairs.length < 20) {
    return null;
  }
  const assetMean = average(pairs.map((point) => point.asset));
  const benchmarkMean = average(pairs.map((point) => point.benchmark));
  if (assetMean === null || benchmarkMean === null) {
    return null;
  }
  const covariance = pairs.reduce((sum, point) => sum + (point.asset - assetMean) * (point.benchmark - benchmarkMean), 0);
  const variance = pairs.reduce((sum, point) => sum + (point.benchmark - benchmarkMean) ** 2, 0);
  return variance === 0 ? null : covariance / variance;
}

export async function buildStrategyMetricSnapshot(symbol: string, market: StrategyMarket): Promise<StrategyMetricSnapshot> {
  const normalized = normalizeSymbol(symbol);
  const [quote, technicalChart, benchmarkChart] = await Promise.all([
    getQuote(normalized),
    fetchChart(normalized, "1Y").catch(() => []),
    fetchChart(defaultBenchmark(market), "1Y").catch(() => [])
  ]);
  const daily = technicalChart
    .filter((point) => Number.isFinite(point.close))
    .map((point) => ({
      time: point.time,
      close: point.close,
      volume: point.volume
    }));
  const recentChart = technicalChart.length > 24 ? technicalChart.slice(-24) : technicalChart;
  const returnPct = chartReturnPct(recentChart);
  const volatilityPct = chartVolatilityPct(recentChart);
  const beta = betaFromCharts(technicalChart, benchmarkChart);
  return {
    symbol: normalized,
    market,
    name: quote.name || normalized,
    sector: quote.sector || "",
    industry: quote.industry || quote.sector || "",
    price: quote.price,
    changePct: quote.changePct,
    metrics: {
      price: quote.price,
      changePct: quote.changePct,
      oneMonthReturnPct: returnPct,
      oneMonthVolatilityPct: volatilityPct,
      standardDeviationPct: volatilityPct,
      rollingBeta: beta,
      fullPeriodBeta: beta,
      industryRollingBeta: null,
      industryFullPeriodBeta: null
    },
    technical: daily.length ? { daily } : undefined,
    source: "quote_chart_cache",
    refreshedAt: new Date().toISOString()
  };
}

export async function refreshStrategyMetricCache(options: RefreshOptions = {}): Promise<RefreshResult> {
  const startedAt = Date.now();
  const timeBudgetMs = Math.max(5_000, Math.min(55_000, Math.round(options.deadlineMs || REFRESH_REQUEST_TIME_BUDGET_MS)));
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
          buildStrategyMetricSnapshot(candidate.symbol, candidate.market),
          itemTimeoutMs,
          `Metric refresh timed out for ${candidate.symbol}.`
        )
      )
    );
    processedCount += candidateChunk.length;
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
  if (processedCount < candidates.length && Date.now() - startedAt >= timeBudgetMs - 1_500) {
    timeBudgetReached = true;
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
    refreshedAt,
    timeBudgetReached
  };
}

export function strategyMetricSnapshotFresh(snapshot: StrategyMetricSnapshot) {
  return isCacheFresh(snapshot.refreshedAt);
}
