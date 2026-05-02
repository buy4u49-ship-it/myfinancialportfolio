const CRYPTO_BASES = new Set([
  "BTC",
  "ETH",
  "XRP",
  "BNB",
  "SOL",
  "DOGE",
  "TRX",
  "ADA",
  "XLM",
  "SUI",
  "HBAR",
  "LINK",
  "AVAX",
  "BCH",
  "LTC",
  "DOT",
  "SHIB",
  "UNI",
  "PEPE",
  "AAVE",
  "ONDO",
  "NEAR",
  "ETC",
  "APT",
  "POL",
  "FIL",
  "ALGO",
  "ARB"
]);

export const POPULAR_SYMBOLS = [
  "BTC-KRW",
  "ETH-KRW",
  "SOL-KRW",
  "XRP-KRW",
  "AAPL",
  "MSFT",
  "NVDA",
  "TSLA",
  "SPY",
  "QQQ",
  "005930.KS",
  "000660.KS"
];

export function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

export function cryptoBaseSymbol(symbol: string) {
  return symbol.trim().toUpperCase().split("-", 1)[0];
}

export function cryptoQuoteSymbol(symbol: string) {
  const parts = symbol.trim().toUpperCase().split("-");
  return parts.length > 1 ? parts[1] : "";
}

export function isCryptoSymbol(symbol: string) {
  const normalized = symbol.trim().toUpperCase();
  const base = cryptoBaseSymbol(normalized);
  return CRYPTO_BASES.has(base) && (!normalized.includes("-") || ["KRW", "USD"].includes(cryptoQuoteSymbol(normalized)));
}

export function isKoreaSymbol(symbol: string) {
  const normalized = symbol.trim().toUpperCase();
  return normalized.endsWith(".KS") || normalized.endsWith(".KQ") || normalized === "^KS11" || normalized === "^KQ11";
}

export function inferCurrency(symbol: string) {
  const normalized = symbol.trim().toUpperCase();
  if (isCryptoSymbol(normalized)) {
    return cryptoQuoteSymbol(normalized) || "KRW";
  }
  return isKoreaSymbol(normalized) ? "KRW" : "USD";
}

export function normalizeSymbol(symbol: string, currency?: string) {
  const cleaned = symbol.trim().toUpperCase().replace("/", "-");
  if (!cleaned) {
    return "";
  }
  if (isCryptoSymbol(cleaned)) {
    const quote = (currency || cryptoQuoteSymbol(cleaned) || "KRW").toUpperCase();
    return `${cryptoBaseSymbol(cleaned)}-${quote === "USD" ? "USD" : "KRW"}`;
  }
  return cleaned;
}

export function marketDataSymbol(symbol: string) {
  const normalized = normalizeSymbol(symbol);
  if (isCryptoSymbol(normalized)) {
    return `${cryptoBaseSymbol(normalized)}-USD`;
  }
  return normalized;
}
