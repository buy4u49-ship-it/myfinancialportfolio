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
  "BGB",
  "XMR",
  "SHIB",
  "UNI",
  "PEPE",
  "AAVE",
  "ONDO",
  "NEAR",
  "ICP",
  "ETC",
  "APT",
  "ATOM",
  "VET",
  "KAS",
  "FET",
  "OP",
  "WLD",
  "RENDER",
  "POL",
  "FIL",
  "ALGO",
  "ARB"
]);

export const POPULAR_SYMBOLS = [
  "BTC-KRW",
  "ETH-KRW",
  "SOL-KRW",
  "OP-KRW",
  "WLD-KRW",
  "RENDER-KRW",
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

export const KOREA_STOCK_NAMES: Record<string, string> = {
  "005930.KS": "삼성전자",
  "000660.KS": "SK하이닉스",
  "373220.KS": "LG에너지솔루션",
  "207940.KS": "삼성바이오로직스",
  "005380.KS": "현대차",
  "000270.KS": "기아",
  "068270.KS": "셀트리온",
  "035420.KS": "NAVER",
  "105560.KS": "KB금융",
  "012450.KS": "한화에어로스페이스",
  "035720.KS": "카카오",
  "066570.KS": "LG전자",
  "012330.KS": "현대모비스",
  "055550.KS": "신한지주",
  "032830.KS": "삼성생명"
};

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
