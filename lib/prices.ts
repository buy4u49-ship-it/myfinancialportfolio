import { cryptoBaseSymbol, isCryptoSymbol, marketDataSymbol, normalizeSymbol } from "./symbols";
import { supabaseAdmin } from "./supabaseAdmin";
import type { Quote } from "./types";

const MARKET_QUOTE_TABLE = "market_quote_cache";
const MARKET_QUOTE_CACHE_MAX_AGE_MS = 90_000;

function numberOrNull(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function pctChange(current: number | null, previous: number | null) {
  if (current === null || previous === null || previous === 0) {
    return null;
  }
  return (current / previous - 1) * 100;
}

function quoteAgeMs(updatedAt: string) {
  const timestamp = Date.parse(updatedAt);
  return Number.isFinite(timestamp) ? Date.now() - timestamp : Number.POSITIVE_INFINITY;
}

function emptyQuote(symbol: string, currency = ""): Quote {
  return {
    symbol,
    price: null,
    previousClose: null,
    changePct: null,
    currency,
    exchange: "",
    source: "unavailable",
    updatedAt: new Date().toISOString()
  };
}

function payloadNumber(payload: unknown, ...keys: string[]) {
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  for (const key of keys) {
    const value = numberOrNull(record[key]);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

export async function getCachedMarketQuotes(symbols: string[]) {
  const normalizedSymbols = Array.from(new Set(symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean)));
  if (!normalizedSymbols.length) {
    return new Map<string, Quote>();
  }

  let data:
    | Array<{
        symbol?: unknown;
        price?: unknown;
        previous_close?: unknown;
        change_pct?: unknown;
        currency?: unknown;
        exchange?: unknown;
        source?: unknown;
        payload?: unknown;
        updated_at?: unknown;
      }>
    | null = null;
  try {
    const response = await supabaseAdmin()
      .from(MARKET_QUOTE_TABLE)
      .select("symbol,provider_symbol,price,previous_close,change_pct,currency,exchange,source,payload,updated_at")
      .in("symbol", normalizedSymbols);
    if (response.error) {
      return new Map<string, Quote>();
    }
    data = response.data;
  } catch {
    return new Map<string, Quote>();
  }

  const quotes = new Map<string, Quote>();
  for (const row of data) {
    const symbol = String(row.symbol || "").toUpperCase();
    const updatedAt = String(row.updated_at || "");
    if (!symbol || quoteAgeMs(updatedAt) > MARKET_QUOTE_CACHE_MAX_AGE_MS) {
      continue;
    }
    const price = numberOrNull(row.price);
    const previousClose = numberOrNull(row.previous_close);
    const volume = payloadNumber(row.payload, "acc_trade_volume_24h", "acc_trade_volume");
    const tradingValue =
      payloadNumber(row.payload, "acc_trade_price_24h", "acc_trade_price") ?? (volume !== null && price !== null ? volume * price : null);
    quotes.set(symbol, {
      symbol,
      price,
      previousClose,
      changePct: numberOrNull(row.change_pct) ?? pctChange(price, previousClose),
      volume,
      tradingValue,
      currency: String(row.currency || "").toUpperCase(),
      exchange: String(row.exchange || "Upbit"),
      source: String(row.source || "market_quote_cache"),
      updatedAt: updatedAt || new Date().toISOString()
    });
  }
  return quotes;
}

async function fetchUpbitKrwQuote(symbol: string): Promise<Quote> {
  const base = cryptoBaseSymbol(symbol);
  const response = await fetch(`https://api.upbit.com/v1/ticker?markets=KRW-${encodeURIComponent(base)}`, {
    headers: { accept: "application/json" },
    cache: "no-store"
  });
  if (!response.ok) {
    return emptyQuote(`${base}-KRW`, "KRW");
  }
  const data = (await response.json()) as Array<Record<string, unknown>>;
  const ticker = data[0];
  if (!ticker) {
    return emptyQuote(`${base}-KRW`, "KRW");
  }
  const price = numberOrNull(ticker.trade_price);
  const previousClose = numberOrNull(ticker.prev_closing_price);
  const signedChangeRate = numberOrNull(ticker.signed_change_rate);
  const volume = numberOrNull(ticker.acc_trade_volume_24h ?? ticker.acc_trade_volume);
  const tradingValue = numberOrNull(ticker.acc_trade_price_24h ?? ticker.acc_trade_price) ?? (volume !== null && price !== null ? volume * price : null);
  return {
    symbol: `${base}-KRW`,
    price,
    previousClose,
    changePct: signedChangeRate !== null ? signedChangeRate * 100 : pctChange(price, previousClose),
    volume,
    tradingValue,
    currency: "KRW",
    exchange: "Upbit REST",
    source: "upbit_rest",
    updatedAt: new Date().toISOString()
  };
}

async function fetchUpbitKrwQuotes(symbols: string[]) {
  const normalized = Array.from(new Set(symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean)));
  const markets = normalized.map((symbol) => `KRW-${cryptoBaseSymbol(symbol)}`);
  if (!markets.length) {
    return new Map<string, Quote>();
  }
  const response = await fetch(`https://api.upbit.com/v1/ticker?markets=${encodeURIComponent(markets.join(","))}`, {
    headers: { accept: "application/json" },
    cache: "no-store"
  });
  if (!response.ok) {
    return new Map<string, Quote>();
  }
  const data = (await response.json()) as Array<Record<string, unknown>>;
  const quotes = new Map<string, Quote>();
  for (const ticker of data) {
    const market = String(ticker.market || "").toUpperCase();
    if (!market.startsWith("KRW-")) {
      continue;
    }
    const base = market.split("-", 2)[1];
    const symbol = `${base}-KRW`;
    const price = numberOrNull(ticker.trade_price);
    const previousClose = numberOrNull(ticker.prev_closing_price);
    const signedChangeRate = numberOrNull(ticker.signed_change_rate);
    const volume = numberOrNull(ticker.acc_trade_volume_24h ?? ticker.acc_trade_volume);
    const tradingValue = numberOrNull(ticker.acc_trade_price_24h ?? ticker.acc_trade_price) ?? (volume !== null && price !== null ? volume * price : null);
    quotes.set(symbol, {
      symbol,
      price,
      previousClose,
      changePct: signedChangeRate !== null ? signedChangeRate * 100 : pctChange(price, previousClose),
      volume,
      tradingValue,
      currency: "KRW",
      exchange: "Upbit REST",
      source: "upbit_rest_batch",
      updatedAt: new Date().toISOString()
    });
  }
  return quotes;
}

async function fetchYahooQuote(symbol: string): Promise<Quote> {
  const providerSymbol = marketDataSymbol(symbol);
  const response = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(providerSymbol)}?range=1d&interval=1m`,
    {
      headers: { accept: "application/json", "user-agent": "myfinancialportfolio-next/1.0" },
      next: { revalidate: 10 }
    }
  );
  if (!response.ok) {
    return emptyQuote(symbol);
  }
  const data = (await response.json()) as {
    chart?: {
      result?: Array<{
        meta?: Record<string, unknown>;
      }>;
    };
  };
  const meta = data.chart?.result?.[0]?.meta || {};
  const price = numberOrNull(meta.regularMarketPrice ?? meta.previousClose);
  const previousClose = numberOrNull(meta.chartPreviousClose ?? meta.previousClose);
  const volume = numberOrNull(meta.regularMarketVolume);
  return {
    symbol: normalizeSymbol(symbol),
    price,
    previousClose,
    changePct: pctChange(price, previousClose),
    volume,
    tradingValue: volume !== null && price !== null ? volume * price : null,
    currency: String(meta.currency || "").toUpperCase(),
    exchange: String(meta.exchangeName || meta.fullExchangeName || "Yahoo"),
    source: "yahoo_chart",
    updatedAt: new Date().toISOString()
  };
}

export async function getQuote(symbol: string): Promise<Quote> {
  const normalized = normalizeSymbol(symbol);
  if (!normalized) {
    return emptyQuote(symbol);
  }

  if (isCryptoSymbol(normalized) && normalized.endsWith("-KRW")) {
    const cached = await getCachedMarketQuotes([normalized]);
    return cached.get(normalized) || fetchUpbitKrwQuote(normalized);
  }

  return fetchYahooQuote(normalized);
}

export async function getQuotes(symbols: string[]) {
  const normalizedSymbols = Array.from(new Set(symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean)));
  const krwCryptoSymbols = normalizedSymbols.filter((symbol) => isCryptoSymbol(symbol) && symbol.endsWith("-KRW"));
  const cached = await getCachedMarketQuotes(krwCryptoSymbols);
  const restKrwQuotes = await fetchUpbitKrwQuotes(krwCryptoSymbols.filter((symbol) => !cached.has(symbol)));

  const entries = await Promise.all(
    normalizedSymbols.map(async (symbol) => {
      if (cached.has(symbol)) {
        return [symbol, cached.get(symbol)!] as const;
      }
      if (restKrwQuotes.has(symbol)) {
        return [symbol, restKrwQuotes.get(symbol)!] as const;
      }
      return [symbol, await getQuote(symbol)] as const;
    })
  );

  return new Map(entries);
}
