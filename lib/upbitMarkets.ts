import { cryptoBaseSymbol, isKrwCryptoPairSymbol, STATIC_CRYPTO_BASES } from "./symbols";

const UPBIT_MARKET_LIST_MAX_AGE_MS = 60 * 60 * 1000;

let upbitKrwSymbolsCache: { symbols: string[]; updatedAt: number } | null = null;

function staticKrwSymbols() {
  return STATIC_CRYPTO_BASES.map((base) => `${base}-KRW`);
}

function normalizeUpbitMarket(market: unknown) {
  const text = String(market || "").trim().toUpperCase();
  if (!text.startsWith("KRW-")) {
    return "";
  }
  const base = text.split("-", 2)[1];
  return base ? `${base}-KRW` : "";
}

export async function getUpbitKrwSymbols() {
  if (upbitKrwSymbolsCache && Date.now() - upbitKrwSymbolsCache.updatedAt < UPBIT_MARKET_LIST_MAX_AGE_MS) {
    return upbitKrwSymbolsCache.symbols;
  }

  try {
    const response = await fetch("https://api.upbit.com/v1/market/all?isDetails=false", {
      headers: { accept: "application/json" },
      next: { revalidate: 3600 }
    });
    if (!response.ok) {
      return upbitKrwSymbolsCache?.symbols || staticKrwSymbols();
    }
    const rows = (await response.json()) as Array<Record<string, unknown>>;
    const symbols = Array.from(new Set(rows.map((row) => normalizeUpbitMarket(row.market)).filter(Boolean))).sort();
    if (!symbols.length) {
      return upbitKrwSymbolsCache?.symbols || staticKrwSymbols();
    }
    upbitKrwSymbolsCache = { symbols, updatedAt: Date.now() };
    return symbols;
  } catch {
    return upbitKrwSymbolsCache?.symbols || staticKrwSymbols();
  }
}

export async function isUpbitKrwSymbol(symbol: string) {
  const normalized = `${cryptoBaseSymbol(symbol)}-KRW`;
  if (!isKrwCryptoPairSymbol(normalized)) {
    return false;
  }
  const symbols = await getUpbitKrwSymbols();
  return symbols.includes(normalized);
}

export async function filterUpbitKrwSymbols(symbols: string[]) {
  const upbitSymbols = new Set(await getUpbitKrwSymbols());
  return symbols.filter((symbol) => upbitSymbols.has(`${cryptoBaseSymbol(symbol)}-KRW`));
}
