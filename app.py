from __future__ import annotations

import hashlib
import json
import math
import os
import re
import secrets
import html as html_lib
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import altair as alt
import pandas as pd
import streamlit as st
import streamlit.components.v1 as components

from market_tracker import MetricConfig, monthly_metrics


def ignore_dead_local_proxy() -> None:
    for key in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
        if os.environ.get(key) == "http://127.0.0.1:9":
            os.environ.pop(key, None)


ignore_dead_local_proxy()

import yfinance as yf


MARKET_UNIVERSE = sorted(
    set(
        [
            "AAA",
            "AAL",
            "AAPL",
            "AAS",
            "ABBV",
            "ABNB",
            "ABT",
            "ACN",
            "ADBE",
            "ADI",
            "ADM",
            "ADP",
            "ADSK",
            "AEP",
            "AIG",
            "ALB",
            "AMAT",
            "AMD",
            "AMGN",
            "AMP",
            "AMT",
            "AMZN",
            "ANET",
            "APD",
            "APH",
            "ASML",
            "AVGO",
            "AXP",
            "BA",
            "BAC",
            "BK",
            "BKNG",
            "BLK",
            "BMY",
            "BRK-B",
            "BSX",
            "BX",
            "C",
            "CAT",
            "CB",
            "CCI",
            "CHTR",
            "CL",
            "CMCSA",
            "COF",
            "COIN",
            "COP",
            "COST",
            "CRM",
            "CRWD",
            "CSCO",
            "CVS",
            "CVX",
            "D",
            "DE",
            "DHR",
            "DIS",
            "DUK",
            "ELV",
            "EMR",
            "EOG",
            "EQIX",
            "ETN",
            "F",
            "FCX",
            "FDX",
            "GE",
            "GILD",
            "GM",
            "GOOG",
            "GOOGL",
            "GS",
            "HD",
            "HON",
            "IBM",
            "INTC",
            "INTU",
            "ISRG",
            "JNJ",
            "JPM",
            "KO",
            "LIN",
            "LLY",
            "LMT",
            "LOW",
            "MA",
            "MCD",
            "MELI",
            "META",
            "MMM",
            "MO",
            "MRK",
            "MS",
            "MSFT",
            "MU",
            "NFLX",
            "NKE",
            "NOW",
            "NVDA",
            "ORCL",
            "PEP",
            "PFE",
            "PG",
            "PLD",
            "PM",
            "PYPL",
            "QCOM",
            "QQQ",
            "RTX",
            "SHOP",
            "SLB",
            "SNOW",
            "SO",
            "SPOT",
            "SPY",
            "SRE",
            "T",
            "TMO",
            "TMUS",
            "TSLA",
            "TXN",
            "UBER",
            "UNH",
            "UNP",
            "UPS",
            "USB",
            "V",
            "VZ",
            "WFC",
            "WMT",
            "XOM",
            "BTC-USD",
            "ETH-USD",
            "SOL-USD",
            "XRP-USD",
            "BNB-USD",
            "ADA-USD",
            "DOGE-USD",
        ]
    )
)

US_UNIVERSE = sorted([symbol for symbol in MARKET_UNIVERSE if not symbol.endswith("-USD")])
CRYPTO_UNIVERSE = [
    "BTC-KRW",
    "ETH-KRW",
    "XRP-KRW",
    "BNB-KRW",
    "SOL-KRW",
    "DOGE-KRW",
    "TRX-KRW",
    "ADA-KRW",
    "LINK-KRW",
    "AVAX-KRW",
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
]
KOREA_UNIVERSE = [
    "005930.KS",
    "000660.KS",
    "373220.KS",
    "207940.KS",
    "005380.KS",
    "000270.KS",
    "068270.KS",
    "035420.KS",
    "035720.KS",
    "051910.KS",
    "006400.KS",
    "105560.KS",
    "055550.KS",
    "012330.KS",
    "028260.KS",
    "066570.KS",
    "032830.KS",
    "015760.KS",
    "096770.KS",
    "003550.KS",
]

INDEX_GROUPS = {
    "crypto": ["BTC-KRW", "ETH-KRW", "SOL-KRW", "BNB-KRW"],
    "us": ["^GSPC", "^IXIC", "^DJI", "^RUT", "^VIX"],
    "korea": ["^KS11", "^KQ11", "005930.KS", "000660.KS"],
}

PAGE_CONFIG = {
    "Coin Main": {
        "market": "crypto",
        "title": "Coin Main",
        "representative": "BTC-KRW",
        "representative_name": "Bitcoin (BTC-KRW)",
        "benchmark": "BTC-USD",
        "universe": CRYPTO_UNIVERSE,
    },
    "US Stock Main": {
        "market": "us",
        "title": "US Stock Main",
        "representative": "^GSPC",
        "representative_name": "S&P 500 Index (^GSPC)",
        "benchmark": "SPY",
        "universe": US_UNIVERSE,
    },
    "Korea Stock Main": {
        "market": "korea",
        "title": "Korea Stock Main",
        "representative": "^KS11",
        "representative_name": "KOSPI Composite Index (^KS11)",
        "benchmark": "^KS11",
        "universe": KOREA_UNIVERSE,
    },
}

PAGE_OPTIONS = ["Coin Main", "US Stock Main", "Korea Stock Main", "Symbol Detail", "My Page"]

APP_DATA_DIR = Path(os.environ.get("PORTFOLIO_USER_DATA_DIR", "user_data"))
USER_STORE_PATH = APP_DATA_DIR / "users.json"
FINANCIAL_CACHE_PATH = APP_DATA_DIR / "financial_cache.json"
SUPABASE_USER_TABLE = "app_user_records"
SUPABASE_MARKET_QUOTE_TABLE = "market_quote_cache"
SUPABASE_FINANCIAL_CACHE_TABLE = "financial_statement_cache"
MARKET_QUOTE_CACHE_MAX_AGE_SECONDS = 60
PASSWORD_HASH_ITERATIONS = 200_000
REMEMBER_COOKIE_NAME = "portfolio_remember_token"
REMEMBER_QUERY_PARAM = "remember_login"
REMEMBER_LOGIN_DAYS = 30

SYMBOL_LABELS = {
    "BTC-KRW": "Bitcoin",
    "ETH-KRW": "Ethereum",
    "SOL-KRW": "Solana",
    "BNB-KRW": "BNB",
    "BTC-USD": "Bitcoin",
    "ETH-USD": "Ethereum",
    "SOL-USD": "Solana",
    "BNB-USD": "BNB",
    "^GSPC": "S&P 500 Index",
    "SPY": "SPDR S&P 500 ETF",
    "VOO": "Vanguard S&P 500 ETF",
    "QQQ": "Invesco QQQ ETF",
    "^IXIC": "Nasdaq Composite",
    "^DJI": "Dow Jones Industrial Average",
    "^RUT": "Russell 2000",
    "^VIX": "CBOE Volatility Index",
    "^KS11": "KOSPI Composite Index",
    "^KQ11": "KOSDAQ Composite Index",
    "005930.KS": "Samsung Electronics",
    "000660.KS": "SK Hynix",
}

PROFILE_FALLBACKS = {
    "AAPL": {
        "name": "Apple Inc.",
        "sector": "Technology",
        "industry": "Consumer Electronics",
        "country": "United States",
        "website": "https://www.apple.com",
        "summary": "Apple designs consumer electronics, software, and services including iPhone, Mac, iPad, wearables, and digital platforms.",
    },
    "AVGO": {
        "name": "Broadcom Inc.",
        "sector": "Technology",
        "industry": "Semiconductors",
        "country": "United States",
        "website": "https://www.broadcom.com",
        "summary": "Broadcom designs semiconductor and infrastructure software products for networking, broadband, wireless, storage, and enterprise markets.",
    },
    "CRWV": {
        "name": "CoreWeave, Inc.",
        "sector": "Technology",
        "industry": "Cloud Infrastructure",
        "country": "United States",
        "website": "https://www.coreweave.com",
        "summary": "CoreWeave provides cloud infrastructure focused on accelerated computing workloads, including artificial intelligence and high-performance computing.",
    },
    "MSFT": {
        "name": "Microsoft Corporation",
        "sector": "Technology",
        "industry": "Software - Infrastructure",
        "country": "United States",
        "website": "https://www.microsoft.com",
        "summary": "Microsoft develops software, cloud services, devices, gaming platforms, and productivity applications.",
    },
    "NVDA": {
        "name": "NVIDIA Corporation",
        "sector": "Technology",
        "industry": "Semiconductors",
        "country": "United States",
        "website": "https://www.nvidia.com",
        "summary": (
            "NVIDIA designs graphics processors, accelerated computing platforms, networking products, "
            "and software used in gaming, data centers, artificial intelligence, visualization, automotive, "
            "and embedded computing markets."
        ),
    },
    "SPY": {
        "name": "SPDR S&P 500 ETF Trust",
        "sector": "ETF",
        "industry": "Exchange Traded Fund",
        "country": "United States",
        "website": "https://www.ssga.com",
        "summary": "SPY is an exchange-traded fund designed to track the S&P 500 Index.",
    },
    "VOO": {
        "name": "Vanguard S&P 500 ETF",
        "sector": "ETF",
        "industry": "Exchange Traded Fund",
        "country": "United States",
        "website": "https://investor.vanguard.com",
        "summary": "VOO is an exchange-traded fund designed to track the S&P 500 Index.",
    },
    "QQQ": {
        "name": "Invesco QQQ Trust",
        "sector": "ETF",
        "industry": "Exchange Traded Fund",
        "country": "United States",
        "website": "https://www.invesco.com",
        "summary": "QQQ is an exchange-traded fund designed to track the Nasdaq-100 Index.",
    },
}

SECTOR_WATCHLISTS = {
    "Technology": ["MSFT", "NVDA", "AAPL", "AVGO", "AMD", "CRM", "ADBE", "NOW"],
    "Communication Services": ["GOOGL", "META", "NFLX", "DIS", "TMUS", "SPOT"],
    "Consumer Cyclical": ["AMZN", "TSLA", "HD", "NKE", "MCD", "BKNG"],
    "Consumer Defensive": ["COST", "WMT", "PG", "KO", "PEP", "PM"],
    "Financial Services": ["JPM", "V", "MA", "BAC", "MS", "GS"],
    "Healthcare": ["LLY", "UNH", "JNJ", "MRK", "ABBV", "TMO"],
    "Industrials": ["GE", "CAT", "HON", "RTX", "UPS", "BA"],
    "Energy": ["XOM", "CVX", "COP", "SLB", "EOG", "MPC"],
    "Basic Materials": ["LIN", "APD", "SHW", "FCX", "NEM", "NUE"],
    "Real Estate": ["PLD", "AMT", "EQIX", "WELL", "SPG", "O"],
    "Utilities": ["NEE", "SO", "DUK", "AEP", "SRE", "D"],
}

KOREA_SECTOR_WATCHLISTS = {
    "Technology": ["005930.KS", "000660.KS", "035420.KS", "035720.KS", "066570.KS"],
    "Healthcare": ["207940.KS", "068270.KS"],
    "Consumer Cyclical": ["005380.KS", "000270.KS", "012330.KS"],
    "Financial Services": ["105560.KS", "055550.KS", "032830.KS"],
    "Basic Materials": ["373220.KS", "051910.KS", "006400.KS", "096770.KS"],
    "Industrials": ["028260.KS", "003550.KS"],
    "Utilities": ["015760.KS"],
}

SECTOR_DEFAULT_INDUSTRIES = {
    "Technology": "Technology Hardware, Software, and Semiconductors",
    "Communication Services": "Media, Internet, and Telecommunications",
    "Consumer Cyclical": "Consumer Discretionary",
    "Consumer Defensive": "Consumer Staples",
    "Financial Services": "Financial Services",
    "Healthcare": "Healthcare",
    "Industrials": "Industrials",
    "Energy": "Energy",
    "Basic Materials": "Basic Materials",
    "Real Estate": "Real Estate",
    "Utilities": "Utilities",
}

CRYPTO_BASE_SYMBOLS = {
    "BTC",
    "ETH",
    "SOL",
    "XRP",
    "BNB",
    "ADA",
    "DOGE",
    "AVAX",
    "TRX",
    "LINK",
    "DOT",
    "LTC",
    "BCH",
    "UNI",
    "XLM",
    "ATOM",
    "ETC",
    "FIL",
    "APT",
    "ARB",
    "OP",
    "AAVE",
    "ALGO",
    "BGB",
    "FET",
    "HBAR",
    "ICP",
    "KAS",
    "NEAR",
    "ONDO",
    "PEPE",
    "POL",
    "RENDER",
    "VET",
    "WLD",
    "XMR",
}
CRYPTO_QUOTE_SYMBOLS = {"USD", "USDT", "USDC", "KRW", "EUR", "JPY", "BTC", "ETH"}
STABLECOIN_BASE_SYMBOLS = {
    "USDT",
    "USDC",
    "DAI",
    "FDUSD",
    "TUSD",
    "USDP",
    "USDD",
    "GUSD",
    "PYUSD",
    "BUSD",
}


def parse_symbols(text: str) -> list[str]:
    raw_tokens = [
        item.strip().upper().replace("/", "-")
        for item in text.replace(",", " ").replace(";", " ").split()
        if item.strip()
    ]
    symbols: list[str] = []
    index = 0
    while index < len(raw_tokens):
        token = raw_tokens[index]
        if "-" in token:
            base, quote, *_ = token.split("-") + [""]
            if base in CRYPTO_BASE_SYMBOLS and quote in CRYPTO_QUOTE_SYMBOLS:
                symbols.append(f"{base}-{quote}")
            else:
                symbols.append(token)
            index += 1
            continue

        next_token = raw_tokens[index + 1] if index + 1 < len(raw_tokens) else ""
        if token in CRYPTO_BASE_SYMBOLS and next_token in CRYPTO_QUOTE_SYMBOLS:
            symbols.append(f"{token}-{next_token}")
            index += 2
            continue
        if token in CRYPTO_BASE_SYMBOLS:
            symbols.append(f"{token}-KRW")
            index += 1
            continue
        if token in CRYPTO_QUOTE_SYMBOLS:
            index += 1
            continue

        symbols.append(token)
        index += 1

    return list(dict.fromkeys(symbols))


def normalize_symbol(text: str) -> str:
    symbols = parse_symbols(text)
    return symbols[0] if symbols else ""


def crypto_quote_symbol(symbol: str) -> str:
    symbol = symbol.upper().strip()
    if "-" not in symbol:
        return ""
    base, quote = symbol.split("-", 1)
    return quote if base in CRYPTO_BASE_SYMBOLS and quote in CRYPTO_QUOTE_SYMBOLS else ""


def crypto_pair_symbol(symbol: str, quote_currency: str = "KRW") -> str:
    return f"{crypto_base_symbol(symbol)}-{quote_currency.upper()}"


def market_data_symbol(symbol: str) -> str:
    if is_crypto_symbol(symbol):
        return crypto_pair_symbol(symbol, "USD")
    return symbol.upper().strip()


def display_ticker(symbol: str, currency: str | None = None) -> str:
    symbol = symbol.upper().strip()
    if is_crypto_symbol(symbol):
        quote = (currency or crypto_quote_symbol(symbol) or "KRW").upper()
        if quote == "KRW":
            return crypto_pair_symbol(symbol, "KRW")
        if quote == "USD":
            return crypto_pair_symbol(symbol, "USD")
    return symbol


def display_symbol(symbol: str, currency: str | None = None) -> str:
    ticker = display_ticker(symbol, currency)
    label = SYMBOL_LABELS.get(ticker) or SYMBOL_LABELS.get(market_data_symbol(ticker))
    return f"{label} ({ticker})" if label else ticker


def is_crypto_symbol(symbol: str) -> bool:
    symbol = symbol.upper().strip()
    return symbol in CRYPTO_UNIVERSE or bool(crypto_quote_symbol(symbol))


def is_stablecoin_symbol(symbol: str) -> bool:
    return crypto_base_symbol(symbol) in STABLECOIN_BASE_SYMBOLS


def is_korea_symbol(symbol: str) -> bool:
    return symbol.endswith(".KS") or symbol.endswith(".KQ") or symbol in {"^KS11", "^KQ11"}


def crypto_base_symbol(symbol: str) -> str:
    symbol = symbol.upper().strip()
    if "-" in symbol:
        return symbol.split("-", 1)[0]
    return symbol


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def parse_utc_datetime(value: object) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except Exception:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def default_user_record(username: str) -> dict[str, object]:
    return {
        "username": username,
        "created_at": utc_now_iso(),
        "profile": {
            "display_name": username,
            "email": "",
        },
        "portfolio": [],
        "alerts": [],
        "remember_tokens": [],
    }


def read_config_value(*names: str) -> str:
    for name in names:
        value = os.environ.get(name, "")
        if value:
            return value.strip()
        try:
            value = st.secrets.get(name, "")
        except Exception:
            value = ""
        if value:
            return str(value).strip()

    try:
        supabase_secrets = st.secrets.get("supabase", {})
    except Exception:
        supabase_secrets = {}
    if hasattr(supabase_secrets, "get"):
        for name in names:
            for key in {name, name.lower(), name.replace("SUPABASE_", "").lower()}:
                value = supabase_secrets.get(key, "")
                if value:
                    return str(value).strip()
    return ""


def supabase_config() -> tuple[str, str]:
    url = read_config_value("SUPABASE_URL").rstrip("/")
    key = read_config_value("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_KEY")
    return url, key


def supabase_is_configured() -> bool:
    url, key = supabase_config()
    return bool(url and key)


def supabase_warn_once(message: str) -> None:
    if st.session_state.get("supabase_warning_shown"):
        return
    st.session_state.supabase_warning_shown = True
    st.warning(message)


def supabase_rest_request(method: str, path: str, payload: object | None = None) -> object:
    url, key = supabase_config()
    if not url or not key:
        raise RuntimeError("Supabase credentials are not configured.")

    data = None
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
    }
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if method in {"POST", "PATCH"}:
        headers["Prefer"] = "resolution=merge-duplicates,return=minimal"

    request = urllib.request.Request(
        f"{url}/rest/v1/{path}",
        data=data,
        headers=headers,
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Supabase request failed ({exc.code}): {detail}") from exc
    if not body:
        return None
    return json.loads(body)


def load_supabase_user_store() -> dict[str, object]:
    rows = supabase_rest_request("GET", f"{SUPABASE_USER_TABLE}?select=username,record")
    users: dict[str, object] = {}
    if isinstance(rows, list):
        for row in rows:
            if not isinstance(row, dict):
                continue
            username = normalize_username(str(row.get("username") or ""))
            record = row.get("record")
            if username and isinstance(record, dict):
                record.setdefault("username", username)
                users[username] = record
    return {"users": users}


def upsert_supabase_user_record(username: str, record: dict[str, object]) -> None:
    username = normalize_username(username)
    record["username"] = username
    supabase_rest_request(
        "POST",
        SUPABASE_USER_TABLE,
        {
            "username": username,
            "record": record,
        },
    )


def load_user_store() -> dict[str, object]:
    if supabase_is_configured():
        try:
            return load_supabase_user_store()
        except Exception as exc:
            supabase_warn_once(f"Supabase connection failed. Using local storage for this session. ({exc})")
    if not USER_STORE_PATH.exists():
        return {"users": {}}
    try:
        return json.loads(USER_STORE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {"users": {}}


def save_user_store(store: dict[str, object]) -> None:
    if supabase_is_configured():
        try:
            users = store.get("users", {})
            if isinstance(users, dict):
                for username, record in users.items():
                    if isinstance(record, dict):
                        upsert_supabase_user_record(str(username), record)
                return
        except Exception as exc:
            supabase_warn_once(f"Supabase save failed. Falling back to local storage. ({exc})")
    APP_DATA_DIR.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(store, ensure_ascii=False, indent=2)
    temp_path = USER_STORE_PATH.with_suffix(".tmp")
    try:
        temp_path.write_text(payload, encoding="utf-8")
        temp_path.replace(USER_STORE_PATH)
    except PermissionError:
        USER_STORE_PATH.write_text(payload, encoding="utf-8")
        try:
            temp_path.unlink(missing_ok=True)
        except Exception:
            pass


def normalize_username(username: str) -> str:
    return username.strip().lower()


def hash_password(password: str, salt: str | None = None) -> tuple[str, str]:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        bytes.fromhex(salt),
        PASSWORD_HASH_ITERATIONS,
    ).hex()
    return salt, digest


def verify_password(password: str, salt: str, digest: str) -> bool:
    _, candidate = hash_password(password, salt)
    return secrets.compare_digest(candidate, digest)


def remember_token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_cookie_controller():
    try:
        from streamlit_cookies_controller import CookieController
    except Exception:
        return None
    try:
        return CookieController(key="portfolio_auth_cookies")
    except Exception:
        return None


def get_cookie(name: str) -> str:
    try:
        value = st.context.cookies.get(name)
    except Exception:
        value = ""
    return str(value or "")


def get_remember_cookie(cookie_controller=None) -> str:
    if cookie_controller is not None:
        try:
            value = cookie_controller.get(REMEMBER_COOKIE_NAME)
        except Exception:
            value = ""
        if value:
            return str(value)
    return get_cookie(REMEMBER_COOKIE_NAME)


def get_query_param(name: str) -> str:
    try:
        value = st.query_params.get(name, "")
    except Exception:
        value = ""
    if isinstance(value, list):
        value = value[0] if value else ""
    return str(value or "")


def queue_remember_cookie(value: str) -> None:
    st.session_state.pending_remember_cookie = value


def queue_clear_remember_cookie() -> None:
    st.session_state.clear_remember_cookie = True


def emit_auth_cookie_scripts(cookie_controller=None) -> None:
    if st.session_state.pop("clear_remember_cookie", False):
        try:
            if REMEMBER_QUERY_PARAM in st.query_params:
                del st.query_params[REMEMBER_QUERY_PARAM]
        except Exception:
            pass
        if cookie_controller is not None:
            try:
                cookie_controller.remove(REMEMBER_COOKIE_NAME)
            except Exception:
                pass
        components.html(
            f"""
            <script>
            document.cookie = "{REMEMBER_COOKIE_NAME}=; Max-Age=0; path=/; SameSite=Lax";
            </script>
            """,
            height=0,
        )
    remember_cookie = st.session_state.pop("pending_remember_cookie", "")
    if remember_cookie:
        try:
            if REMEMBER_QUERY_PARAM in st.query_params:
                del st.query_params[REMEMBER_QUERY_PARAM]
        except Exception:
            pass
        encoded_value = urllib.parse.quote(remember_cookie, safe="")
        max_age_seconds = REMEMBER_LOGIN_DAYS * 24 * 60 * 60
        if cookie_controller is not None:
            try:
                cookie_controller.set(
                    REMEMBER_COOKIE_NAME,
                    remember_cookie,
                    max_age=max_age_seconds,
                    expires=datetime.now(timezone.utc) + timedelta(days=REMEMBER_LOGIN_DAYS),
                    path="/",
                    same_site="lax",
                )
            except Exception:
                pass
        components.html(
            f"""
            <script>
            document.cookie = "{REMEMBER_COOKIE_NAME}={encoded_value}; Max-Age={max_age_seconds}; path=/; SameSite=Lax";
            </script>
            """,
            height=0,
        )


def create_remember_login_token(username: str) -> str:
    record = get_user_record(username) or default_user_record(username)
    tokens = record.setdefault("remember_tokens", [])
    if not isinstance(tokens, list):
        tokens = []
        record["remember_tokens"] = tokens
    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(days=REMEMBER_LOGIN_DAYS)
    tokens.append(
        {
            "token_hash": remember_token_hash(token),
            "created_at": utc_now_iso(),
            "expires_at": expires_at.isoformat(timespec="seconds"),
            "last_used_at": "",
        }
    )
    save_user_record(username, record)
    return f"{username}:{token}"


def restore_remembered_login(cookie_controller=None) -> None:
    if current_username():
        return
    raw_cookie = urllib.parse.unquote(get_remember_cookie(cookie_controller)) or get_query_param(REMEMBER_QUERY_PARAM)
    if ":" not in raw_cookie:
        return
    username, token = raw_cookie.split(":", 1)
    username = normalize_username(username)
    record = get_user_record(username)
    if not record:
        queue_clear_remember_cookie()
        return

    token_hash = remember_token_hash(token)
    tokens = record.get("remember_tokens", [])
    if not isinstance(tokens, list):
        queue_clear_remember_cookie()
        return

    now = datetime.now(timezone.utc)
    restored = False
    retained_tokens = []
    for item in tokens:
        if not isinstance(item, dict):
            continue
        expires_at = parse_utc_datetime(item.get("expires_at"))
        if expires_at and expires_at < now:
            continue
        if secrets.compare_digest(str(item.get("token_hash") or ""), token_hash):
            item["last_used_at"] = utc_now_iso()
            restored = True
        retained_tokens.append(item)

    if len(retained_tokens) != len(tokens) or restored:
        record["remember_tokens"] = retained_tokens
        save_user_record(username, record)
    if restored:
        st.session_state.auth_user = username
    else:
        queue_clear_remember_cookie()


def revoke_current_remember_token(username: str, cookie_controller=None) -> None:
    raw_cookie = urllib.parse.unquote(get_remember_cookie(cookie_controller)) or get_query_param(REMEMBER_QUERY_PARAM)
    if ":" not in raw_cookie:
        return
    cookie_username, token = raw_cookie.split(":", 1)
    if normalize_username(cookie_username) != username:
        return
    record = get_user_record(username)
    if not record:
        return
    tokens = record.get("remember_tokens", [])
    if not isinstance(tokens, list):
        return
    token_hash = remember_token_hash(token)
    record["remember_tokens"] = [
        item
        for item in tokens
        if not isinstance(item, dict) or not secrets.compare_digest(str(item.get("token_hash") or ""), token_hash)
    ]
    save_user_record(username, record)


def current_username() -> str:
    return str(st.session_state.get("auth_user") or "")


def is_logged_in() -> bool:
    return bool(current_username())


def save_user_record(username: str, record: dict[str, object]) -> None:
    if supabase_is_configured():
        try:
            upsert_supabase_user_record(username, record)
            return
        except Exception as exc:
            supabase_warn_once(f"Supabase save failed. Falling back to local storage. ({exc})")
    store = load_user_store()
    users = store.setdefault("users", {})
    if isinstance(users, dict):
        users[username] = record
    save_user_store(store)


def get_user_record(username: str | None = None) -> dict[str, object] | None:
    username = username or current_username()
    if not username:
        return None
    users = load_user_store().get("users", {})
    if not isinstance(users, dict):
        return None
    record = users.get(username)
    return record if isinstance(record, dict) else None


def create_account(username: str, password: str, display_name: str, email: str) -> tuple[bool, str]:
    username = normalize_username(username)
    if len(username) < 3 or not username.replace("_", "").replace("-", "").isalnum():
        return False, "Use at least 3 letters, numbers, underscores, or hyphens for the username."
    if len(password) < 8:
        return False, "Use at least 8 characters for the password."

    store = load_user_store()
    users = store.setdefault("users", {})
    if not isinstance(users, dict):
        users = {}
        store["users"] = users
    if username in users:
        return False, "That username already exists."

    salt, digest = hash_password(password)
    record = default_user_record(username)
    record["password_salt"] = salt
    record["password_hash"] = digest
    record["profile"] = {
        "display_name": display_name.strip() or username,
        "email": email.strip(),
    }
    users[username] = record
    save_user_store(store)
    return True, "Account created."


def authenticate(username: str, password: str) -> tuple[bool, str]:
    username = normalize_username(username)
    record = get_user_record(username)
    if not record:
        return False, "No account exists for that username."
    salt = str(record.get("password_salt") or "")
    digest = str(record.get("password_hash") or "")
    if not salt or not digest or not verify_password(password, salt, digest):
        return False, "Password does not match."
    st.session_state.auth_user = username
    return True, "Signed in."


def logout(cookie_controller=None) -> None:
    username = current_username()
    if username:
        revoke_current_remember_token(username, cookie_controller)
    st.session_state.pop("auth_user", None)
    queue_clear_remember_cookie()


@st.cache_data(ttl=3600)
def search_symbols(query: str, limit: int = 30) -> list[str]:
    normalized_query = query.strip().upper().replace("/", "-")
    if not normalized_query:
        return MARKET_UNIVERSE[:limit]

    searchable_universe = sorted(
        set(MARKET_UNIVERSE + CRYPTO_UNIVERSE + KOREA_UNIVERSE + ["^GSPC", "^IXIC", "^DJI", "^KS11", "^KQ11"])
    )
    local_matches = [symbol for symbol in searchable_universe if normalized_query in symbol]
    remote_matches: list[str] = []
    try:
        search = yf.Search(normalized_query, max_results=limit, news_count=0, lists_count=0, raise_errors=False)
        quotes = getattr(search, "quotes", []) or []
        for quote in quotes:
            symbol = quote.get("symbol", "").upper()
            quote_type = quote.get("quoteType", "")
            if symbol and quote_type not in {"OPTION", "FUTURE"}:
                remote_matches.append(symbol)
    except Exception:
        pass

    normalized_exact = normalize_symbol(normalized_query)
    matches = sorted(set(local_matches + remote_matches + ([normalized_exact] if normalized_exact else [])))
    contains_matches = [symbol for symbol in matches if normalized_query in symbol]
    matches = contains_matches or matches

    exact_matches = sorted([symbol for symbol in matches if symbol == normalized_query or symbol == normalized_exact])
    remaining = [symbol for symbol in matches if symbol not in exact_matches]
    if remaining:
        snapshot = get_market_snapshot(tuple(remaining[:40]))
        value_lookup = {
            row["symbol"]: safe_number(row["trading_value"]) or 0
            for _, row in snapshot.iterrows()
        }
        remaining = sorted(remaining, key=lambda symbol: (-value_lookup.get(symbol, 0), symbol))

    return (exact_matches + remaining)[:limit]


def safe_number(value):
    if value is None:
        return None
    try:
        value = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(value):
        return None
    return value


def pct_change(current, previous):
    current = safe_number(current)
    previous = safe_number(previous)
    if current is None or previous in (None, 0):
        return None
    return (current / previous - 1) * 100


def quote_age_seconds(timestamp_value: object) -> float | None:
    timestamp = parse_utc_datetime(timestamp_value)
    if timestamp is None:
        return None
    return (datetime.now(timezone.utc) - timestamp).total_seconds()


@st.cache_data(ttl=3)
def get_cached_market_quote(symbol: str, currency: str = "KRW") -> dict[str, object] | None:
    if not supabase_is_configured():
        return None
    symbol_filter = urllib.parse.quote(symbol.upper(), safe="")
    currency_filter = urllib.parse.quote(currency.upper(), safe="")
    path = (
        f"{SUPABASE_MARKET_QUOTE_TABLE}"
        "?select=symbol,provider_symbol,price,previous_close,change_pct,currency,exchange,source,payload,updated_at"
        f"&symbol=eq.{symbol_filter}&currency=eq.{currency_filter}&limit=1"
    )
    try:
        rows = supabase_rest_request("GET", path)
    except Exception:
        return None
    if not isinstance(rows, list) or not rows:
        return None
    row = rows[0]
    if not isinstance(row, dict):
        return None
    price = safe_number(row.get("price"))
    if price is None:
        return None
    age = quote_age_seconds(row.get("updated_at"))
    if age is None or age > MARKET_QUOTE_CACHE_MAX_AGE_SECONDS:
        return None
    previous_close = safe_number(row.get("previous_close"))
    change_pct_value = safe_number(row.get("change_pct"))
    payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
    return {
        "symbol": symbol.upper(),
        "price": price,
        "previous_close": previous_close,
        "change_pct": change_pct_value if change_pct_value is not None else pct_change(price, previous_close),
        "currency": str(row.get("currency") or currency).upper(),
        "exchange": str(row.get("exchange") or "Upbit"),
        "timestamp_utc": str(row.get("updated_at") or utc_now_iso()),
        "source": str(row.get("source") or "market_quote_cache"),
        "volume": safe_number(payload.get("acc_trade_volume_24h") or payload.get("acc_trade_volume")),
        "trading_value": safe_number(payload.get("acc_trade_price_24h") or payload.get("acc_trade_price")),
    }


@st.cache_data(ttl=30)
def get_quote(symbol: str) -> dict[str, object]:
    symbol = symbol.upper().strip()
    if is_crypto_symbol(symbol) and crypto_quote_symbol(symbol) == "KRW":
        return get_crypto_krw_quote(symbol)

    provider_symbol = market_data_symbol(symbol)
    ticker = yf.Ticker(provider_symbol)
    price = None
    previous_close = None
    currency = ""
    exchange = ""

    try:
        fast = ticker.fast_info
        price = safe_number(fast.get("last_price") or fast.get("regular_market_price"))
        previous_close = safe_number(fast.get("previous_close"))
        currency = fast.get("currency") or ""
        exchange = fast.get("exchange") or ""
    except Exception:
        pass

    if price is None or previous_close is None or not currency or not exchange:
        try:
            info = ticker.info or {}
            price = price if price is not None else safe_number(info.get("currentPrice") or info.get("regularMarketPrice"))
            previous_close = previous_close if previous_close is not None else safe_number(info.get("previousClose") or info.get("regularMarketPreviousClose"))
            currency = currency or info.get("currency") or ""
            exchange = exchange or info.get("exchange") or info.get("fullExchangeName") or ""
        except Exception:
            pass

    if provider_symbol.endswith("-USD"):
        try:
            daily = ticker.history(period="3d", interval="1d", auto_adjust=True, actions=False)
            if not daily.empty and len(daily["Close"].dropna()) >= 2:
                previous_close = safe_number(daily["Close"].dropna().iloc[-2])
        except Exception:
            pass

    if price is None:
        try:
            hist = ticker.history(period="2d", interval="1m", auto_adjust=True, actions=False)
            if not hist.empty:
                price = safe_number(hist["Close"].dropna().iloc[-1])
                daily = hist["Close"].resample("1D").last().dropna()
                if len(daily) >= 2:
                    previous_close = safe_number(daily.iloc[-2])
        except Exception:
            pass

    return {
        "symbol": symbol,
        "price": price,
        "previous_close": previous_close,
        "change_pct": pct_change(price, previous_close),
        "currency": currency or crypto_quote_symbol(symbol),
        "exchange": exchange,
        "timestamp_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


def fetch_json(url: str) -> object:
    request = urllib.request.Request(url, headers={"accept": "application/json", "User-Agent": "portfolio-tracker/1.0"})
    with urllib.request.urlopen(request, timeout=5) as response:
        return json.loads(response.read().decode("utf-8"))


@st.cache_data(ttl=5)
def get_upbit_krw_quote(base_symbol: str) -> dict[str, object]:
    market = f"KRW-{base_symbol.upper()}"
    query = urllib.parse.urlencode({"markets": market})
    data = fetch_json(f"https://api.upbit.com/v1/ticker?{query}")
    if not isinstance(data, list) or not data:
        raise ValueError(f"No Upbit KRW quote for {base_symbol}")
    ticker = data[0]
    price = safe_number(ticker.get("trade_price"))
    previous_close = safe_number(ticker.get("prev_closing_price"))
    signed_change_rate = safe_number(ticker.get("signed_change_rate"))
    return {
        "symbol": f"{base_symbol.upper()}-KRW",
        "price": price,
        "previous_close": previous_close,
        "change_pct": signed_change_rate * 100 if signed_change_rate is not None else pct_change(price, previous_close),
        "currency": "KRW",
        "exchange": "Upbit REST",
        "timestamp_utc": utc_now_iso(),
        "volume": safe_number(ticker.get("acc_trade_volume_24h") or ticker.get("acc_trade_volume")),
        "trading_value": safe_number(ticker.get("acc_trade_price_24h") or ticker.get("acc_trade_price")),
    }


@st.cache_data(ttl=20)
def get_bithumb_krw_quote(base_symbol: str) -> dict[str, object]:
    market = f"KRW-{base_symbol.upper()}"
    query = urllib.parse.urlencode({"markets": market})
    data = fetch_json(f"https://api.bithumb.com/v1/ticker?{query}")
    if not isinstance(data, list) or not data:
        raise ValueError(f"No Bithumb KRW quote for {base_symbol}")
    ticker = data[0]
    price = safe_number(ticker.get("trade_price"))
    previous_close = safe_number(ticker.get("prev_closing_price"))
    signed_change_rate = safe_number(ticker.get("signed_change_rate"))
    return {
        "symbol": f"{base_symbol.upper()}-KRW",
        "price": price,
        "previous_close": previous_close,
        "change_pct": signed_change_rate * 100 if signed_change_rate is not None else pct_change(price, previous_close),
        "currency": "KRW",
        "exchange": "Bithumb",
        "timestamp_utc": utc_now_iso(),
    }


def get_crypto_krw_quote(symbol: str) -> dict[str, object]:
    base_symbol = crypto_base_symbol(symbol)
    app_symbol = crypto_pair_symbol(symbol, "KRW")
    for cache_symbol in (app_symbol, crypto_pair_symbol(symbol, "USD")):
        cached_quote = get_cached_market_quote(cache_symbol, "KRW")
        if cached_quote:
            cached_quote["symbol"] = app_symbol
            return cached_quote
    try:
        quote = get_upbit_krw_quote(base_symbol)
        if safe_number(quote.get("price")) is not None:
            quote["symbol"] = app_symbol
            return quote
    except Exception:
        pass
    return {
        "symbol": app_symbol,
        "price": None,
        "previous_close": None,
        "change_pct": None,
        "currency": "KRW",
        "exchange": "Upbit quote unavailable",
        "timestamp_utc": utc_now_iso(),
    }


def get_portfolio_quote(symbol: str, cost_currency: str) -> dict[str, object]:
    cost_currency = cost_currency.upper()
    if is_crypto_symbol(symbol):
        if cost_currency == "KRW":
            return get_crypto_krw_quote(symbol)
        if cost_currency == "USD":
            return get_quote(crypto_pair_symbol(symbol, "USD"))
    return get_quote(symbol)


def convert_currency_value(value, from_currency: str, to_currency: str) -> float | None:
    value = safe_number(value)
    if value is None:
        return None
    from_currency = (from_currency or "").upper()
    to_currency = (to_currency or "").upper()
    if not to_currency or from_currency == to_currency:
        return value
    if not from_currency:
        return value
    from_to_usd = get_fx_to_usd(from_currency)
    to_to_usd = get_fx_to_usd(to_currency)
    if not from_to_usd or not to_to_usd:
        return None
    return value * from_to_usd / to_to_usd


def default_portfolio_summary_currency(portfolio: list[dict[str, object]]) -> str:
    currencies = {
        str(position.get("cost_currency") or position.get("currency") or "USD").upper()
        for position in portfolio
        if isinstance(position, dict)
    }
    return "KRW" if "KRW" in currencies else "USD"


def portfolio_position_snapshots(portfolio: list[dict[str, object]], summary_currency: str) -> list[dict[str, object]]:
    snapshots = []
    summary_currency = summary_currency.upper()
    for position in portfolio:
        if not isinstance(position, dict):
            continue
        symbol = str(position.get("symbol") or "").upper()
        if not symbol:
            continue
        quantity = safe_number(position.get("quantity")) or 0
        avg_cost = safe_number(position.get("avg_cost")) or 0
        cost_currency = str(position.get("cost_currency") or position.get("currency") or "USD").upper()
        if cost_currency not in {"USD", "KRW"}:
            cost_currency = "USD"
        quote = get_portfolio_quote(symbol, cost_currency)
        price = convert_currency_value(quote.get("price"), str(quote.get("currency") or cost_currency), cost_currency)
        market_value = price * quantity if price is not None else None
        cost_basis = avg_cost * quantity
        gain_loss = market_value - cost_basis if market_value is not None else None
        gain_loss_pct = pct_change(market_value, cost_basis) if market_value is not None and cost_basis else None
        market_value_summary = convert_currency_value(market_value, cost_currency, summary_currency)
        cost_basis_summary = convert_currency_value(cost_basis, cost_currency, summary_currency)
        gain_loss_summary = convert_currency_value(gain_loss, cost_currency, summary_currency)
        snapshots.append(
            {
                "symbol": symbol,
                "quantity": quantity,
                "avg_cost": avg_cost,
                "cost_currency": cost_currency,
                "price": price,
                "market_value": market_value,
                "cost_basis": cost_basis,
                "gain_loss": gain_loss,
                "gain_loss_pct": gain_loss_pct,
                "market_value_summary": market_value_summary,
                "cost_basis_summary": cost_basis_summary,
                "gain_loss_summary": gain_loss_summary,
                "price_source": str(quote.get("exchange") or ""),
                "note": str(position.get("note") or ""),
            }
        )
    return snapshots


def portfolio_market_rows(portfolio: list[dict[str, object]], summary_currency: str | None = None) -> list[dict[str, object]]:
    summary_currency = summary_currency or default_portfolio_summary_currency(portfolio)
    snapshots = portfolio_position_snapshots(portfolio, summary_currency)
    return portfolio_market_rows_from_snapshots(snapshots)


def portfolio_market_rows_from_snapshots(snapshots: list[dict[str, object]]) -> list[dict[str, object]]:
    rows = []
    for snapshot in snapshots:
        cost_currency = str(snapshot.get("cost_currency") or "USD")
        rows.append(
            {
                "Symbol": display_ticker(str(snapshot.get("symbol") or ""), cost_currency),
                "Quantity": safe_number(snapshot.get("quantity")) or 0,
                "Cost Currency": cost_currency,
                "Avg Cost": format_portfolio_money(snapshot.get("avg_cost"), cost_currency),
                "Current Price": format_portfolio_money(snapshot.get("price"), cost_currency),
                "Market Value": format_portfolio_money(snapshot.get("market_value"), cost_currency),
                "Gain/Loss": format_portfolio_money(snapshot.get("gain_loss"), cost_currency),
                "Gain/Loss %": format_pct(snapshot.get("gain_loss_pct")),
                "Price Source": str(snapshot.get("price_source") or ""),
                "Note": str(snapshot.get("note") or ""),
            }
        )
    return rows


def portfolio_totals(snapshots: list[dict[str, object]]) -> dict[str, float | None]:
    market_values = [safe_number(snapshot.get("market_value_summary")) for snapshot in snapshots]
    cost_values = [safe_number(snapshot.get("cost_basis_summary")) for snapshot in snapshots]
    total_market_value = sum(value for value in market_values if value is not None)
    total_cost_basis = sum(value for value in cost_values if value is not None)
    total_gain_loss = total_market_value - total_cost_basis
    total_gain_loss_pct = pct_change(total_market_value, total_cost_basis) if total_cost_basis else None
    return {
        "current_wealth": total_market_value,
        "total_investment": total_cost_basis,
        "total_market_value": total_market_value,
        "total_gain_loss": total_gain_loss,
        "total_gain_loss_pct": total_gain_loss_pct,
    }


def portfolio_capm_projection(
    snapshots: list[dict[str, object]],
    benchmark: str,
    years: int,
    rolling_window: int,
) -> dict[str, float | str | None]:
    benchmark = (benchmark or "SPY").upper()
    weighted_positions = [
        {
            "symbol": str(snapshot.get("symbol") or "").upper(),
            "market_value": safe_number(snapshot.get("market_value_summary")),
        }
        for snapshot in snapshots
    ]
    weighted_positions = [
        position
        for position in weighted_positions
        if position["symbol"] and position["market_value"] is not None and position["market_value"] > 0
    ]
    total_value = sum(float(position["market_value"]) for position in weighted_positions)
    if total_value <= 0:
        return {
            "portfolio_beta": None,
            "expected_monthly_log_return": None,
            "expected_portfolio_value": None,
            "expected_gain": None,
            "beta_coverage": None,
            "risk_free_as_of": "",
        }

    weighted_beta = 0.0
    beta_weight = 0.0
    for position in weighted_positions:
        weight = float(position["market_value"]) / total_value
        beta = safe_number(summary_metrics(str(position["symbol"]), benchmark, years, rolling_window).get("latest_beta"))
        if beta is None:
            continue
        weighted_beta += weight * beta
        beta_weight += weight

    if beta_weight <= 0:
        portfolio_beta = None
    else:
        portfolio_beta = weighted_beta / beta_weight

    market_monthly_log_return = summary_metrics(benchmark, benchmark, years, rolling_window).get("avg_monthly_log_return")
    market_monthly_log_return = safe_number(market_monthly_log_return)
    tbill_annual_pct, tbill_as_of = get_three_month_tbill_rate()
    rf_monthly_log_return = math.log(1 + (tbill_annual_pct / 100)) / 12 if tbill_annual_pct is not None else None

    expected_monthly_log_return = None
    expected_portfolio_value = None
    expected_gain = None
    if portfolio_beta is not None and market_monthly_log_return is not None and rf_monthly_log_return is not None:
        expected_monthly_log_return = rf_monthly_log_return + portfolio_beta * (market_monthly_log_return - rf_monthly_log_return)
        expected_portfolio_value = total_value * math.exp(expected_monthly_log_return)
        expected_gain = expected_portfolio_value - total_value

    return {
        "portfolio_beta": portfolio_beta,
        "expected_monthly_log_return": expected_monthly_log_return,
        "expected_portfolio_value": expected_portfolio_value,
        "expected_gain": expected_gain,
        "beta_coverage": beta_weight * 100,
        "risk_free_as_of": tbill_as_of,
    }


def empty_portfolio_calculation() -> dict[str, float | str | int | None]:
    return {
        "portfolio_beta": None,
        "expected_monthly_log_return": None,
        "expected_portfolio_value": None,
        "expected_gain": None,
        "beta_coverage": None,
        "risk_free_as_of": "",
        "summary_currency": "",
        "benchmark": "",
        "years": None,
        "rolling_window": None,
        "calculated_at": "",
    }


def portfolio_calculation_matches(
    calculation: dict[str, object],
    summary_currency: str,
    benchmark: str,
    years: int,
    rolling_window: int,
) -> bool:
    return (
        str(calculation.get("summary_currency") or "").upper() == summary_currency.upper()
        and str(calculation.get("benchmark") or "").upper() == (benchmark or "SPY").upper()
        and safe_number(calculation.get("years")) == years
        and safe_number(calculation.get("rolling_window")) == rolling_window
    )


def portfolio_calculation_record(
    snapshots: list[dict[str, object]],
    summary_currency: str,
    benchmark: str,
    years: int,
    rolling_window: int,
) -> dict[str, object]:
    projection = portfolio_capm_projection(snapshots, benchmark, years, rolling_window)
    projection.update(
        {
            "summary_currency": summary_currency.upper(),
            "benchmark": (benchmark or "SPY").upper(),
            "years": years,
            "rolling_window": rolling_window,
            "calculated_at": utc_now_iso(),
        }
    )
    return projection


def signed_value_class(value) -> str:
    value = safe_number(value)
    if value is None or value == 0:
        return "neutral"
    return "positive" if value > 0 else "negative"


def upsert_position(username: str, symbol: str, quantity: float, avg_cost: float, cost_currency: str, note: str) -> None:
    record = get_user_record(username) or default_user_record(username)
    portfolio = record.setdefault("portfolio", [])
    if not isinstance(portfolio, list):
        portfolio = []
        record["portfolio"] = portfolio
    symbol = normalize_symbol(symbol) or symbol.strip().upper()
    cost_currency = cost_currency.upper()
    if cost_currency not in {"USD", "KRW"}:
        cost_currency = "USD"
    if is_crypto_symbol(symbol):
        symbol = crypto_pair_symbol(symbol, cost_currency)
    updated = False
    for position in portfolio:
        if isinstance(position, dict) and position.get("symbol") == symbol:
            position.update(
                {
                    "quantity": quantity,
                    "avg_cost": avg_cost,
                    "cost_currency": cost_currency,
                    "note": note.strip(),
                    "updated_at": utc_now_iso(),
                }
            )
            updated = True
            break
    if not updated:
        portfolio.append(
            {
                "symbol": symbol,
                "quantity": quantity,
                "avg_cost": avg_cost,
                "cost_currency": cost_currency,
                "note": note.strip(),
                "created_at": utc_now_iso(),
            }
        )
    save_user_record(username, record)


def remove_position(username: str, symbol: str) -> None:
    record = get_user_record(username)
    if not record:
        return
    portfolio = record.get("portfolio", [])
    if isinstance(portfolio, list):
        record["portfolio"] = [position for position in portfolio if not isinstance(position, dict) or position.get("symbol") != symbol]
        save_user_record(username, record)


def portfolio_edit_rows(portfolio: list[dict[str, object]]) -> list[dict[str, object]]:
    rows = []
    for position in portfolio:
        if not isinstance(position, dict):
            continue
        cost_currency = str(position.get("cost_currency") or position.get("currency") or "USD").upper()
        if cost_currency not in {"USD", "KRW"}:
            cost_currency = "USD"
        rows.append(
            {
                "Symbol": display_ticker(str(position.get("symbol") or ""), cost_currency),
                "Quantity": safe_number(position.get("quantity")) or 0,
                "Average Cost": safe_number(position.get("avg_cost")) or 0,
                "Cost Currency": cost_currency,
                "Note": str(position.get("note") or ""),
            }
        )
    return rows


def save_portfolio_edits(username: str, edited_rows: list[dict[str, object]]) -> None:
    record = get_user_record(username) or default_user_record(username)
    existing = record.get("portfolio", [])
    existing_by_symbol = {
        str(position.get("symbol") or ""): position
        for position in existing
        if isinstance(position, dict) and position.get("symbol")
    } if isinstance(existing, list) else {}

    portfolio = []
    for row in edited_rows:
        symbol = normalize_symbol(str(row.get("Symbol") or "")) or str(row.get("Symbol") or "").upper()
        if not symbol:
            continue
        cost_currency = str(row.get("Cost Currency") or "USD").upper()
        if cost_currency not in {"USD", "KRW"}:
            cost_currency = "USD"
        if is_crypto_symbol(symbol):
            symbol = crypto_pair_symbol(symbol, cost_currency)
        prior = existing_by_symbol.get(symbol, {})
        portfolio.append(
            {
                "symbol": symbol,
                "quantity": safe_number(row.get("Quantity")) or 0,
                "avg_cost": safe_number(row.get("Average Cost")) or 0,
                "cost_currency": cost_currency,
                "note": str(row.get("Note") or "").strip(),
                "created_at": prior.get("created_at") or utc_now_iso(),
                "updated_at": utc_now_iso(),
            }
        )

    record["portfolio"] = portfolio
    save_user_record(username, record)


def add_price_alert(username: str, symbol: str, direction: str, target_price: float) -> None:
    record = get_user_record(username) or default_user_record(username)
    alerts = record.setdefault("alerts", [])
    if not isinstance(alerts, list):
        alerts = []
        record["alerts"] = alerts
    alerts.append(
        {
            "id": uuid4().hex,
            "symbol": normalize_symbol(symbol) or symbol.strip().upper(),
            "direction": direction,
            "target_price": target_price,
            "active": True,
            "created_at": utc_now_iso(),
            "last_checked_at": "",
            "last_triggered_at": "",
            "last_price": None,
        }
    )
    save_user_record(username, record)


def toggle_price_alert(username: str, alert_id: str) -> None:
    record = get_user_record(username)
    if not record:
        return
    alerts = record.get("alerts", [])
    if isinstance(alerts, list):
        for alert in alerts:
            if isinstance(alert, dict) and alert.get("id") == alert_id:
                alert["active"] = not bool(alert.get("active", True))
                break
        save_user_record(username, record)


def remove_price_alert(username: str, alert_id: str) -> None:
    record = get_user_record(username)
    if not record:
        return
    alerts = record.get("alerts", [])
    if isinstance(alerts, list):
        record["alerts"] = [alert for alert in alerts if not isinstance(alert, dict) or alert.get("id") != alert_id]
        save_user_record(username, record)


def evaluate_price_alerts(username: str) -> list[dict[str, object]]:
    record = get_user_record(username)
    if not record:
        return []
    alerts = record.get("alerts", [])
    if not isinstance(alerts, list):
        return []

    triggered_alerts = []
    changed = False
    for alert in alerts:
        if not isinstance(alert, dict) or not bool(alert.get("active", True)):
            continue
        symbol = str(alert.get("symbol") or "").upper()
        target = safe_number(alert.get("target_price"))
        if not symbol or target is None:
            continue
        quote = get_quote(symbol)
        price = safe_number(quote.get("price"))
        alert["last_checked_at"] = utc_now_iso()
        alert["last_price"] = price
        changed = True
        if price is None:
            continue
        direction = str(alert.get("direction") or "above")
        is_triggered = price >= target if direction == "above" else price <= target
        if is_triggered:
            if not alert.get("last_triggered_at"):
                alert["last_triggered_at"] = utc_now_iso()
            triggered_alerts.append(
                {
                    "id": alert.get("id"),
                    "symbol": symbol,
                    "price": price,
                    "target_price": target,
                    "direction": direction,
                    "currency": str(quote.get("currency") or ""),
                }
            )
    if changed:
        save_user_record(username, record)
    return triggered_alerts


@st.cache_data(ttl=3600)
def get_ticker_info(symbol: str) -> dict[str, object]:
    provider_symbol = market_data_symbol(symbol)
    ticker = yf.Ticker(provider_symbol)
    info = {}
    try:
        if hasattr(ticker, "get_info"):
            info = ticker.get_info() or {}
    except Exception:
        info = {}
    if not info:
        try:
            info = ticker.info or {}
        except Exception:
            info = {}
    return info if isinstance(info, dict) else {}


@st.cache_data(ttl=3600)
def get_profile(symbol: str) -> dict[str, object]:
    provider_symbol = market_data_symbol(symbol)
    info = get_ticker_info(symbol)
    fallback = PROFILE_FALLBACKS.get(symbol.upper(), {}) or PROFILE_FALLBACKS.get(provider_symbol.upper(), {})

    def sector_from_watchlist() -> str:
        upper_symbol = symbol.upper()
        watchlists = KOREA_SECTOR_WATCHLISTS if is_korea_symbol(upper_symbol) else SECTOR_WATCHLISTS
        for sector_name, candidates in watchlists.items():
            if upper_symbol in candidates:
                return sector_name
        return ""

    def profile_value(*keys: str, fallback_key: str = ""):
        for key in keys:
            value = info.get(key)
            if value not in (None, "", "N/A"):
                return value
        return fallback.get(fallback_key or keys[0], "")

    sector = profile_value("sector") or sector_from_watchlist()
    industry = profile_value("industry") or SECTOR_DEFAULT_INDUSTRIES.get(str(sector), "")
    return {
        "name": profile_value("longName", "shortName", fallback_key="name") or display_ticker(symbol),
        "sector": sector,
        "industry": industry,
        "country": profile_value("country") or ("United States" if sector else ""),
        "website": profile_value("website"),
        "summary": profile_value("longBusinessSummary", fallback_key="summary"),
    }


@st.cache_data(ttl=3600)
def get_statement(symbol: str, statement_type: str) -> pd.DataFrame:
    ticker = yf.Ticker(market_data_symbol(symbol))
    try:
        table = {
            "balance": ticker.balance_sheet,
            "income": ticker.financials,
            "cashflow": ticker.cashflow,
        }[statement_type]
    except Exception:
        return pd.DataFrame()
    if table is None or table.empty:
        return pd.DataFrame()
    table = table.copy()
    table.columns = [pd.Timestamp(col).strftime("%Y-%m-%d") for col in table.columns]
    return table


def financial_cache_date() -> str:
    kst = timezone(timedelta(hours=9))
    return datetime.now(kst).date().isoformat()


def dataframe_to_cache_payload(frame: pd.DataFrame) -> dict[str, object]:
    if frame.empty:
        return {"index": [], "columns": [], "data": []}

    def normalize_cell(value: object) -> object:
        if pd.isna(value):
            return None
        number = safe_number(value)
        if number is not None:
            return number
        if isinstance(value, (str, bool)):
            return value
        return str(value)

    normalized = frame.copy()
    normalized.index = [str(index) for index in normalized.index]
    normalized.columns = [str(column) for column in normalized.columns]
    rows = []
    for _, row in normalized.iterrows():
        rows.append([normalize_cell(value) for value in row.tolist()])
    return {
        "index": normalized.index.tolist(),
        "columns": normalized.columns.tolist(),
        "data": rows,
    }


def dataframe_from_cache_payload(payload: object) -> pd.DataFrame:
    if not isinstance(payload, dict):
        return pd.DataFrame()
    columns = payload.get("columns")
    index = payload.get("index")
    data = payload.get("data")
    if not isinstance(columns, list) or not isinstance(index, list) or not isinstance(data, list):
        return pd.DataFrame()
    frame = pd.DataFrame(data, index=[str(item) for item in index], columns=[str(item) for item in columns])
    for column in frame.columns:
        converted = pd.to_numeric(frame[column], errors="coerce")
        if converted.notna().any():
            frame[column] = converted
    return frame


def load_local_financial_cache() -> dict[str, object]:
    if not FINANCIAL_CACHE_PATH.exists():
        return {}
    try:
        payload = json.loads(FINANCIAL_CACHE_PATH.read_text(encoding="utf-8"))
        return payload if isinstance(payload, dict) else {}
    except Exception:
        return {}


def save_local_financial_cache(cache: dict[str, object]) -> None:
    APP_DATA_DIR.mkdir(parents=True, exist_ok=True)
    FINANCIAL_CACHE_PATH.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")


def financial_cache_key(symbol: str) -> str:
    return market_data_symbol(symbol).upper()


def load_cached_financial_payload(symbol: str) -> dict[str, object] | None:
    cache_key = financial_cache_key(symbol)
    today = financial_cache_date()
    if supabase_is_configured():
        symbol_filter = urllib.parse.quote(cache_key, safe="")
        path = f"{SUPABASE_FINANCIAL_CACHE_TABLE}?select=symbol,cache_date,payload,updated_at&symbol=eq.{symbol_filter}&limit=1"
        try:
            rows = supabase_rest_request("GET", path)
            if isinstance(rows, list) and rows:
                row = rows[0]
                if isinstance(row, dict) and str(row.get("cache_date") or "") == today and isinstance(row.get("payload"), dict):
                    return row["payload"]
        except Exception:
            pass

    local_cache = load_local_financial_cache()
    row = local_cache.get(cache_key)
    if isinstance(row, dict) and str(row.get("cache_date") or "") == today and isinstance(row.get("payload"), dict):
        return row["payload"]
    return None


def save_cached_financial_payload(symbol: str, payload: dict[str, object]) -> None:
    cache_key = financial_cache_key(symbol)
    cache_date = financial_cache_date()
    if supabase_is_configured():
        try:
            supabase_rest_request(
                "POST",
                SUPABASE_FINANCIAL_CACHE_TABLE,
                {
                    "symbol": cache_key,
                    "cache_date": cache_date,
                    "payload": payload,
                    "updated_at": utc_now_iso(),
                },
            )
            return
        except Exception:
            pass

    local_cache = load_local_financial_cache()
    local_cache[cache_key] = {"cache_date": cache_date, "payload": payload, "updated_at": utc_now_iso()}
    save_local_financial_cache(local_cache)


def build_financial_payload(symbol: str) -> dict[str, object]:
    profile = get_profile(symbol)
    ratios, peer_count = financial_ratio_table(symbol, profile)
    statements = {
        statement_type: dataframe_to_cache_payload(get_statement(symbol, statement_type))
        for statement_type in ("balance", "income", "cashflow")
    }
    return {
        "symbol": financial_cache_key(symbol),
        "display_symbol": display_ticker(symbol),
        "cache_date": financial_cache_date(),
        "generated_at": utc_now_iso(),
        "statements": statements,
        "ratios": ratios.to_dict("records"),
        "ratio_peer_count": peer_count,
        "industry": str(profile.get("industry") or profile.get("sector") or "industry"),
    }


def get_financial_payload(symbol: str) -> tuple[dict[str, object], bool]:
    cached = load_cached_financial_payload(symbol)
    if cached is not None:
        return cached, True
    payload = build_financial_payload(symbol)
    save_cached_financial_payload(symbol, payload)
    return payload, False


def statement_from_financial_payload(payload: dict[str, object], statement_type: str) -> pd.DataFrame:
    statements = payload.get("statements") if isinstance(payload, dict) else {}
    if not isinstance(statements, dict):
        return pd.DataFrame()
    return dataframe_from_cache_payload(statements.get(statement_type))


def ratios_from_financial_payload(payload: dict[str, object]) -> pd.DataFrame:
    rows = payload.get("ratios") if isinstance(payload, dict) else []
    if not isinstance(rows, list):
        rows = []
    return pd.DataFrame(rows)


def readable_statement_label(label: object) -> str:
    text = str(label or "").replace("_", " ").strip()
    text = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", text)
    return re.sub(r"\s+", " ", text)


def balance_sheet_row_rank(label: object, original_index: int) -> tuple[int, int]:
    text = readable_statement_label(label).lower()
    compact = re.sub(r"[^a-z0-9]+", "", text)

    if "cash" in compact:
        return (100, original_index)
    if "shortterminvestment" in compact:
        return (110, original_index)
    if "receivable" in compact:
        return (120, original_index)
    if "inventory" in compact:
        return (130, original_index)
    if "prepaid" in compact:
        return (140, original_index)
    if "asset" in compact:
        if "noncurrentasset" in compact or "longtermasset" in compact:
            return (290 if "total" in compact else 240, original_index)
        if "totalcurrentasset" in compact:
            return (180, original_index)
        if "currentasset" in compact:
            return (150, original_index)
        if "totalasset" in compact:
            return (300, original_index)
        return (200, original_index)
    if any(token in compact for token in ("ppe", "propertyplant", "goodwill", "intangible", "investment", "deferredtaxasset")):
        return (230, original_index)

    if ("noncurrent" in compact or "longterm" in compact) and any(token in compact for token in ("payable", "payables", "debt")):
        return (540, original_index)
    if any(token in compact for token in ("accountspayable", "payables")):
        return (410, original_index)
    if any(token in compact for token in ("currentdebt", "shorttermdebt")):
        return (420, original_index)
    if "liabilit" in compact:
        if "noncurrentliabilit" in compact or "longtermliabilit" in compact:
            return (580 if "total" in compact else 540, original_index)
        if "totalcurrentliabilit" in compact:
            return (480, original_index)
        if "currentliabilit" in compact:
            return (430, original_index)
        if "totalliabilit" in compact:
            return (600, original_index)
        return (500, original_index)
    if any(token in compact for token in ("longtermdebt", "deferredtaxliabilit")):
        return (530, original_index)
    if "totaldebt" in compact or "netdebt" in compact:
        return (620, original_index)

    if any(token in compact for token in ("equity", "stockholder", "shareholder", "retainedearnings", "commonstock", "treasurystock")):
        if "totalequity" in compact or "stockholdersequity" in compact or "shareholdersequity" in compact:
            return (780, original_index)
        return (720, original_index)

    return (900, original_index)


def reorder_statement(statement: pd.DataFrame, statement_type: str) -> pd.DataFrame:
    if statement.empty or statement_type != "balance":
        return statement
    indexed_rows = list(enumerate(statement.index))
    ordered_index = [label for _, label in sorted(indexed_rows, key=lambda item: balance_sheet_row_rank(item[1], item[0]))]
    return statement.loc[ordered_index]


def format_statement_number(value: object) -> str:
    number = safe_number(value)
    if number is None:
        return ""
    abs_value = abs(number)
    if abs_value >= 1_000_000_000:
        return f"{number / 1_000_000_000:,.2f}B"
    if abs_value >= 1_000_000:
        return f"{number / 1_000_000:,.2f}M"
    if abs_value >= 1_000:
        return f"{number:,.0f}"
    return f"{number:,.2f}"


def format_statement_table(statement: pd.DataFrame, statement_type: str) -> pd.DataFrame:
    table = reorder_statement(statement, statement_type).copy()
    table.index = [readable_statement_label(label) for label in table.index]
    formatted = table.map(format_statement_number)
    formatted.insert(0, "Line Item", formatted.index)
    formatted.index = range(1, len(formatted) + 1)
    formatted.index.name = ""
    return formatted


def compact_statement_label(label: object) -> str:
    return re.sub(r"[^a-z0-9]+", "", readable_statement_label(label).lower())


def empty_statement_series(statement: pd.DataFrame) -> pd.Series:
    return pd.Series([None for _ in statement.columns], index=statement.columns, dtype=object)


def numeric_statement_series(row: object, columns: pd.Index) -> pd.Series:
    if isinstance(row, pd.DataFrame):
        row = row.iloc[0] if not row.empty else pd.Series(index=columns, dtype=object)
    if not isinstance(row, pd.Series):
        row = pd.Series(row, index=columns)
    return row.reindex(columns).map(safe_number)


def candidate(includes: tuple[str, ...], excludes: tuple[str, ...] = ()) -> tuple[tuple[str, ...], tuple[str, ...]]:
    return includes, excludes


def row_matches(compact_label: str, candidates: list[tuple[tuple[str, ...], tuple[str, ...]]]) -> bool:
    for includes, excludes in candidates:
        if all(token in compact_label for token in includes) and not any(token in compact_label for token in excludes):
            return True
    return False


def find_statement_series(statement: pd.DataFrame, candidates: list[tuple[tuple[str, ...], tuple[str, ...]]]) -> pd.Series | None:
    for includes, excludes in candidates:
        for label in statement.index:
            compact = compact_statement_label(label)
            if all(token in compact for token in includes) and not any(token in compact for token in excludes):
                return numeric_statement_series(statement.loc[label], statement.columns)
    return None


def find_statement_rows(
    statement: pd.DataFrame,
    candidates: list[tuple[tuple[str, ...], tuple[str, ...]]],
    exclude_labels: set[str] | None = None,
) -> list[tuple[str, pd.Series]]:
    exclude_labels = exclude_labels or set()
    rows: list[tuple[str, pd.Series]] = []
    seen: set[str] = set()
    for label in statement.index:
        readable = readable_statement_label(label)
        compact = compact_statement_label(label)
        if readable in exclude_labels or readable in seen:
            continue
        if row_matches(compact, candidates):
            rows.append((readable, numeric_statement_series(statement.loc[label], statement.columns)))
            seen.add(readable)
    return rows


def unmatched_statement_rows(
    statement: pd.DataFrame,
    matched_candidates: list[tuple[tuple[str, ...], tuple[str, ...]]],
) -> list[tuple[str, pd.Series]]:
    rows: list[tuple[str, pd.Series]] = []
    for label in statement.index:
        compact = compact_statement_label(label)
        if not row_matches(compact, matched_candidates):
            rows.append((readable_statement_label(label), numeric_statement_series(statement.loc[label], statement.columns)))
    return rows


def series_or_empty(statement: pd.DataFrame, series: pd.Series | None) -> pd.Series:
    return series if series is not None else empty_statement_series(statement)


def add_statement_series(*series_values: pd.Series | None) -> pd.Series | None:
    valid = [series for series in series_values if series is not None]
    if not valid:
        return None
    total = valid[0].copy()
    for series in valid[1:]:
        total = total.combine(
            series,
            lambda left, right: (
                (safe_number(left) or 0) + (safe_number(right) or 0)
                if safe_number(left) is not None or safe_number(right) is not None
                else None
            ),
        )
    return total


def subtract_statement_series(left: pd.Series | None, right: pd.Series | None) -> pd.Series | None:
    if left is None and right is None:
        return None
    if left is None:
        return right.map(lambda value: -safe_number(value) if safe_number(value) is not None else None)
    if right is None:
        return left
    return left.combine(
        right,
        lambda a, b: (
            (safe_number(a) or 0) - (safe_number(b) or 0)
            if safe_number(a) is not None or safe_number(b) is not None
            else None
        ),
    )


def statement_html_cell(value: object) -> str:
    return html_lib.escape(format_statement_number(value))


def statement_grid_template(column_count: int) -> str:
    return "minmax(280px, 1.45fr) " + " ".join(["minmax(118px, 1fr)"] * column_count)


def financial_grid_header(statement: pd.DataFrame) -> str:
    cells = ['<div class="financial-grid-cell financial-grid-label">Line Item</div>']
    cells.extend(f'<div class="financial-grid-cell">{html_lib.escape(str(column))}</div>' for column in statement.columns)
    return f'<div class="financial-grid-row financial-grid-header">{"".join(cells)}</div>'


def financial_grid_row(label: str, values: pd.Series | None, css_class: str = "", level: int = 0) -> str:
    series = values if values is not None else pd.Series(dtype=object)
    cells = [
        (
            f'<div class="financial-grid-cell financial-grid-label level-{level}">'
            f"{html_lib.escape(label)}</div>"
        )
    ]
    for column in series.index:
        cells.append(f'<div class="financial-grid-cell">{statement_html_cell(series.get(column))}</div>')
    return f'<div class="financial-grid-row {css_class}">{"".join(cells)}</div>'


def financial_empty_row(statement: pd.DataFrame, label: str = "No mapped line items available") -> str:
    cells = [f'<div class="financial-grid-cell financial-grid-label level-2 muted">{html_lib.escape(label)}</div>']
    cells.extend('<div class="financial-grid-cell muted"></div>' for _ in statement.columns)
    return f'<div class="financial-grid-row financial-empty-row">{"".join(cells)}</div>'


def financial_detail_group(
    title: str,
    summary: pd.Series | None,
    children: list[str],
    statement: pd.DataFrame,
    css_class: str = "",
    level: int = 0,
    open_group: bool = False,
) -> str:
    open_attr = " open" if open_group else ""
    body = "".join(children) if children else financial_empty_row(statement)
    return (
        f'<details class="financial-detail {css_class}"{open_attr}>'
        "<summary>"
        f'{financial_grid_row(title, series_or_empty(statement, summary), "financial-summary-row", level)}'
        "</summary>"
        f'<div class="financial-detail-body">{body}</div>'
        "</details>"
    )


def rows_html(rows: list[tuple[str, pd.Series]], level: int = 1, css_class: str = "") -> list[str]:
    return [financial_grid_row(label, series, css_class, level) for label, series in rows]


BALANCE_CANDIDATES = {
    "total_assets": [candidate(("totalassets",)), candidate(("total", "assets"), ("liabilit", "equity"))],
    "current_assets": [candidate(("totalcurrentassets",)), candidate(("currentassets",), ("noncurrent",))],
    "noncurrent_assets": [candidate(("totalnoncurrentassets",)), candidate(("noncurrentassets",)), candidate(("non", "current", "assets"))],
    "cash": [candidate(("cashcashequivalentsandshortterminvestments",)), candidate(("cashandcashequivalents",)), candidate(("cashfinancial",)), candidate(("shortterminvestments",))],
    "receivables": [candidate(("receivables",)), candidate(("accountsreceivable",))],
    "inventory": [candidate(("inventory",)), candidate(("inventories",))],
    "prepaid": [candidate(("prepaid",))],
    "other_current_assets": [candidate(("othercurrentassets",))],
    "long_term_investments": [candidate(("investmentinfinancialassets",)), candidate(("investmentsandadvances",)), candidate(("longterminvestments",)), candidate(("availableforsalesecurities",))],
    "ppe": [candidate(("netppe",)), candidate(("propertyplantandequipment",)), candidate(("grossppe",)), candidate(("accumulateddepreciation",))],
    "intangibles": [candidate(("goodwill",)), candidate(("intangible",))],
    "deferred_assets": [candidate(("deferredassets",)), candidate(("deferredtaxassets",))],
    "other_noncurrent_assets": [candidate(("othernoncurrentassets",))],
    "total_liabilities": [candidate(("totalliabilities",)), candidate(("total", "liabilit"))],
    "current_liabilities": [candidate(("totalcurrentliabilities",)), candidate(("currentliabilities",), ("noncurrent",))],
    "noncurrent_liabilities": [candidate(("totalnoncurrentliabilities",)), candidate(("noncurrentliabilities",)), candidate(("longtermliabilities",))],
    "total_equity": [candidate(("stockholdersequity",)), candidate(("shareholdersequity",)), candidate(("totalequity",)), candidate(("total", "equity"))],
}


def grouped_balance_statement_html(statement: pd.DataFrame) -> str:
    total_assets = find_statement_series(statement, BALANCE_CANDIDATES["total_assets"])
    current_assets = find_statement_series(statement, BALANCE_CANDIDATES["current_assets"])
    noncurrent_assets = find_statement_series(statement, BALANCE_CANDIDATES["noncurrent_assets"])
    total_liabilities = find_statement_series(statement, BALANCE_CANDIDATES["total_liabilities"])
    current_liabilities = find_statement_series(statement, BALANCE_CANDIDATES["current_liabilities"])
    noncurrent_liabilities = find_statement_series(statement, BALANCE_CANDIDATES["noncurrent_liabilities"])
    total_equity = find_statement_series(statement, BALANCE_CANDIDATES["total_equity"])

    cash_rows = find_statement_rows(statement, BALANCE_CANDIDATES["cash"], {"Cash Cash Equivalents And Short Term Investments"})
    receivable_rows = find_statement_rows(statement, [candidate(("receivable",), ("total",))], {"Receivables"})
    inventory_rows = find_statement_rows(statement, BALANCE_CANDIDATES["inventory"], {"Inventory"})
    prepaid_rows = find_statement_rows(statement, BALANCE_CANDIDATES["prepaid"])
    other_current_rows = find_statement_rows(statement, BALANCE_CANDIDATES["other_current_assets"])
    long_investment_rows = find_statement_rows(statement, BALANCE_CANDIDATES["long_term_investments"])
    ppe_rows = find_statement_rows(statement, BALANCE_CANDIDATES["ppe"], {"Net PPE"})
    intangible_rows = find_statement_rows(statement, BALANCE_CANDIDATES["intangibles"])
    deferred_asset_rows = find_statement_rows(statement, BALANCE_CANDIDATES["deferred_assets"])
    other_noncurrent_rows = find_statement_rows(statement, BALANCE_CANDIDATES["other_noncurrent_assets"])

    current_asset_children = [
        financial_detail_group(
            "Cash & Short-term Investments",
            find_statement_series(statement, [candidate(("cashcashequivalentsandshortterminvestments",))]),
            rows_html(cash_rows, 2),
            statement,
            level=1,
        ),
        financial_detail_group("Total Receivables", find_statement_series(statement, BALANCE_CANDIDATES["receivables"]), rows_html(receivable_rows, 2), statement, level=1),
        financial_detail_group("Inventories", find_statement_series(statement, BALANCE_CANDIDATES["inventory"]), rows_html(inventory_rows, 2), statement, level=1),
        financial_detail_group("Prepaid Expenses", find_statement_series(statement, BALANCE_CANDIDATES["prepaid"]), rows_html(prepaid_rows, 2), statement, level=1),
        financial_detail_group("Other Current Assets", find_statement_series(statement, BALANCE_CANDIDATES["other_current_assets"]), rows_html(other_current_rows, 2), statement, level=1),
    ]

    noncurrent_asset_children = [
        financial_detail_group("Long-term Investments", find_statement_series(statement, BALANCE_CANDIDATES["long_term_investments"]), rows_html(long_investment_rows, 2), statement, level=1),
        financial_detail_group("Property, Plant & Equipment", find_statement_series(statement, BALANCE_CANDIDATES["ppe"]), rows_html(ppe_rows, 2), statement, level=1),
        financial_detail_group("Intangible Assets", find_statement_series(statement, BALANCE_CANDIDATES["intangibles"]), rows_html(intangible_rows, 2), statement, level=1),
        financial_detail_group("Deferred Assets", find_statement_series(statement, BALANCE_CANDIDATES["deferred_assets"]), rows_html(deferred_asset_rows, 2), statement, level=1),
        financial_detail_group("Other Non-current Assets", find_statement_series(statement, BALANCE_CANDIDATES["other_noncurrent_assets"]), rows_html(other_noncurrent_rows, 2), statement, level=1),
    ]

    current_liability_rows = find_statement_rows(
        statement,
        [candidate(("current", "liabilit")), candidate(("accountspayable",)), candidate(("currentdebt",)), candidate(("payables",), ("noncurrent",))],
        {"Current Liabilities"},
    )
    noncurrent_liability_rows = find_statement_rows(
        statement,
        [candidate(("noncurrent", "liabilit")), candidate(("longterm", "debt")), candidate(("payablesnoncurrent",))],
        {"Total Non Current Liabilities Net Minority Interest"},
    )
    equity_rows = find_statement_rows(statement, [candidate(("equity",)), candidate(("retainedearnings",)), candidate(("commonstock",)), candidate(("treasurystock",))], {"Stockholders Equity"})

    body = [
        financial_detail_group(
            "Total Assets",
            total_assets,
            [
                financial_detail_group("Total Current Assets", current_assets, current_asset_children, statement, level=1, open_group=True),
                financial_detail_group("Total Non-current Assets", noncurrent_assets, noncurrent_asset_children, statement, level=1),
            ],
            statement,
            css_class="financial-grand-total asset-total",
            open_group=True,
        ),
        financial_detail_group(
            "Total Liabilities",
            total_liabilities,
            [
                financial_detail_group("Total Current Liabilities", current_liabilities, rows_html(current_liability_rows, 2), statement, level=1),
                financial_detail_group("Total Non-current Liabilities", noncurrent_liabilities, rows_html(noncurrent_liability_rows, 2), statement, level=1),
            ],
            statement,
            css_class="financial-grand-total liability-total",
        ),
        financial_detail_group("Total Equity", total_equity, rows_html(equity_rows, 1), statement, css_class="financial-grand-total equity-total"),
    ]
    matched_candidates = [item for group in BALANCE_CANDIDATES.values() for item in group]
    unmatched_rows = unmatched_statement_rows(statement, matched_candidates)
    if unmatched_rows:
        body.append(financial_detail_group("Provider-only / Unclassified Items", None, rows_html(unmatched_rows, 1), statement))
    return (
        '<div class="financial-grid-wrap">'
        f'<div class="financial-grid" style="--financial-grid-template: {statement_grid_template(len(statement.columns))};">'
        f"{financial_grid_header(statement)}{''.join(body)}"
        "</div></div>"
    )


INCOME_CANDIDATES = {
    "revenue": [candidate(("totalrevenue",)), candidate(("operatingrevenue",)), candidate(("revenue",), ("deferred", "cost"))],
    "cost": [candidate(("costofrevenue",)), candidate(("reconciledcostofrevenue",))],
    "gross_profit": [candidate(("grossprofit",))],
    "sga": [candidate(("sellinggeneralandadministration",)), candidate(("generalandadministrativeexpense",))],
    "operating_income": [candidate(("operatingincome",)), candidate(("ebit",))],
    "pretax_income": [candidate(("pretaxincome",)), candidate(("incomebeforetax",))],
    "tax": [candidate(("taxprovision",)), candidate(("incometaxexpense",))],
    "net_income": [candidate(("netincome",), ("comprehensive",)), candidate(("netincomecommonstockholders",))],
    "oci": [candidate(("othercomprehensiveincome",)), candidate(("comprehensiveincome",), ("net", "tax"))],
    "comprehensive_income": [candidate(("comprehensiveincomenetoftax",)), candidate(("totalcomprehensiveincome",))],
}


def grouped_income_statement_html(statement: pd.DataFrame) -> str:
    revenue = find_statement_series(statement, INCOME_CANDIDATES["revenue"])
    cost = find_statement_series(statement, INCOME_CANDIDATES["cost"])
    gross_profit = find_statement_series(statement, INCOME_CANDIDATES["gross_profit"])
    if gross_profit is None:
        gross_profit = subtract_statement_series(revenue, cost)
    sga = find_statement_series(statement, INCOME_CANDIDATES["sga"])
    operating_income = find_statement_series(statement, INCOME_CANDIDATES["operating_income"])
    if operating_income is None:
        operating_income = subtract_statement_series(gross_profit, sga)
    pretax_income = find_statement_series(statement, INCOME_CANDIDATES["pretax_income"])
    non_operating = subtract_statement_series(pretax_income, operating_income)
    tax = find_statement_series(statement, INCOME_CANDIDATES["tax"])
    net_income = find_statement_series(statement, INCOME_CANDIDATES["net_income"])
    if net_income is None:
        net_income = subtract_statement_series(pretax_income, tax)
    oci = find_statement_series(statement, INCOME_CANDIDATES["oci"])
    comprehensive_income = find_statement_series(statement, INCOME_CANDIDATES["comprehensive_income"])
    if comprehensive_income is None:
        comprehensive_income = add_statement_series(net_income, oci)

    sga_detail_groups = [
        ("Salaries and Benefits", [candidate(("salary",)), candidate(("salaries",)), candidate(("wage",)), candidate(("compensation",)), candidate(("personnel",))]),
        ("Rent", [candidate(("rent",)), candidate(("lease",))]),
        ("Depreciation and Amortization", [candidate(("depreciation",)), candidate(("amortization",))]),
        ("Advertising and Promotion", [candidate(("advertising",)), candidate(("marketing",)), candidate(("promotion",))]),
        ("Commissions and Fees", [candidate(("commission",)), candidate(("fees",)), candidate(("professional",))]),
        ("Freight and Delivery", [candidate(("freight",)), candidate(("shipping",)), candidate(("delivery",)), candidate(("transport",))]),
        ("Research and Development", [candidate(("researchanddevelopment",)), candidate(("research", "development"))]),
        ("Bad Debt Expense", [candidate(("baddebt",)), candidate(("provisionforcreditlosses",)), candidate(("allowance", "credit"))]),
        ("Other SG&A", [candidate(("otheroperatingexpenses",)), candidate(("otherganda",)), candidate(("othergeneral",))]),
    ]
    sga_children = [
        financial_detail_group(title, find_statement_series(statement, group_candidates), rows_html(find_statement_rows(statement, group_candidates), 2), statement, level=1)
        for title, group_candidates in sga_detail_groups
    ]

    non_operating_rows = find_statement_rows(
        statement,
        [
            candidate(("interestincome",)),
            candidate(("interestexpense",)),
            candidate(("otherincomeexpense",)),
            candidate(("netnonoperatinginterestincomeexpense",)),
            candidate(("othernonoperatingincomeexpenses",)),
        ],
    )
    oci_rows = find_statement_rows(statement, [candidate(("othercomprehensiveincome",)), candidate(("comprehensiveincome",), ("netincome",))])

    sga_detail_candidates = [item for _, group_candidates in sga_detail_groups for item in group_candidates]
    non_operating_candidates = [
        candidate(("interestincome",)),
        candidate(("interestexpense",)),
        candidate(("otherincomeexpense",)),
        candidate(("netnonoperatinginterestincomeexpense",)),
        candidate(("othernonoperatingincomeexpenses",)),
    ]
    oci_candidates = [candidate(("othercomprehensiveincome",)), candidate(("comprehensiveincome",), ("netincome",))]
    matched_candidates = [item for group in INCOME_CANDIDATES.values() for item in group] + sga_detail_candidates + non_operating_candidates + oci_candidates
    unmatched_rows = unmatched_statement_rows(statement, matched_candidates)

    body = [
        financial_grid_row("Revenue", series_or_empty(statement, revenue), "financial-formula-start", 0),
        financial_grid_row("Less: Cost of Revenue", series_or_empty(statement, cost), "financial-expense-row", 0),
        financial_grid_row("Gross Profit", series_or_empty(statement, gross_profit), "financial-result-row", 0),
        financial_detail_group("Less: Selling, General & Administrative Expenses", sga, sga_children, statement, css_class="financial-expense-group", level=0, open_group=True),
        financial_grid_row("Operating Income", series_or_empty(statement, operating_income), "financial-result-row", 0),
        financial_detail_group("Add/Less: Non-operating Income and Expenses", non_operating, rows_html(non_operating_rows, 1), statement, level=0),
        financial_grid_row("Profit Before Tax", series_or_empty(statement, pretax_income), "financial-result-row", 0),
        financial_grid_row("Less: Income Tax Expense", series_or_empty(statement, tax), "financial-expense-row", 0),
        financial_grid_row("Net Income", series_or_empty(statement, net_income), "financial-result-row financial-grand-income", 0),
        financial_detail_group("Add/Less: Other Comprehensive Income", oci, rows_html(oci_rows, 1), statement, level=0),
        financial_grid_row("Comprehensive Income", series_or_empty(statement, comprehensive_income), "financial-result-row financial-grand-income", 0),
    ]
    if unmatched_rows:
        body.append(financial_detail_group("Provider-only / Unclassified Items", None, rows_html(unmatched_rows, 1), statement))

    return (
        '<div class="financial-grid-wrap">'
        f'<div class="financial-grid" style="--financial-grid-template: {statement_grid_template(len(statement.columns))};">'
        f"{financial_grid_header(statement)}{''.join(body)}"
        "</div></div>"
    )


RATIO_FIELDS = [
    ("EPS", "eps", "number"),
    ("PER", "per", "number"),
    ("Net Profit Margin", "net_margin", "percent"),
    ("Operating Margin", "operating_margin", "percent"),
    ("ROE", "roe", "percent"),
]


def ratio_values(symbol: str) -> dict[str, float | None]:
    info = get_ticker_info(symbol)
    return {
        "eps": safe_number(info.get("trailingEps") or info.get("epsTrailingTwelveMonths")),
        "per": safe_number(info.get("trailingPE") or info.get("forwardPE")),
        "net_margin": safe_number(info.get("profitMargins")),
        "operating_margin": safe_number(info.get("operatingMargins")),
        "roe": safe_number(info.get("returnOnEquity")),
    }


def format_ratio_value(value: object, value_type: str) -> str:
    number = safe_number(value)
    if number is None:
        return "N/A"
    if value_type == "percent":
        return f"{number * 100:,.2f}%"
    return f"{number:,.2f}"


def industry_peer_candidates(symbol: str, profile: dict[str, object], limit: int = 12) -> list[str]:
    provider_symbol = market_data_symbol(symbol).upper()
    watchlists = KOREA_SECTOR_WATCHLISTS if is_korea_symbol(provider_symbol) else SECTOR_WATCHLISTS
    sector = str(profile.get("sector") or "")
    industry = str(profile.get("industry") or "")
    candidates = [candidate for candidate in watchlists.get(sector, []) if candidate.upper() != provider_symbol]
    if not candidates:
        return []

    same_industry = []
    for candidate in candidates[:limit]:
        peer_profile = get_profile(candidate)
        if industry and str(peer_profile.get("industry") or "") == industry:
            same_industry.append(candidate)
    return (same_industry or candidates)[:limit]


def mean_ratio(peer_ratios: list[dict[str, float | None]], key: str) -> float | None:
    values = [safe_number(row.get(key)) for row in peer_ratios]
    values = [value for value in values if value is not None]
    return sum(values) / len(values) if values else None


def financial_ratio_table(symbol: str, profile: dict[str, object]) -> tuple[pd.DataFrame, int]:
    company = ratio_values(symbol)
    peers = industry_peer_candidates(symbol, profile)
    peer_ratios = [ratio_values(peer) for peer in peers]
    rows = []
    for label, key, value_type in RATIO_FIELDS:
        rows.append(
            {
                "Metric": label,
                "Company": format_ratio_value(company.get(key), value_type),
                "Industry Average": format_ratio_value(mean_ratio(peer_ratios, key), value_type),
            }
        )
    return pd.DataFrame(rows), len(peer_ratios)


@st.cache_data(ttl=1800)
def get_metrics(symbol: str, benchmark: str, years: int, rolling_window: int) -> pd.DataFrame:
    return monthly_metrics(
        market_data_symbol(symbol),
        MetricConfig(years=years, benchmark=market_data_symbol(benchmark), rolling_window=rolling_window),
    )


@st.cache_data(ttl=60)
def get_market_snapshot(symbols: tuple[str, ...]) -> pd.DataFrame:
    rows = []
    crypto_symbols = [symbol.upper() for symbol in symbols if is_crypto_symbol(symbol) and crypto_quote_symbol(symbol) == "KRW"]
    for symbol in crypto_symbols:
        quote = get_quote(symbol)
        price = safe_number(quote.get("price"))
        volume = safe_number(quote.get("volume"))
        trading_value = safe_number(quote.get("trading_value"))
        rows.append(
            {
                "symbol": display_ticker(symbol, "KRW"),
                "price": price,
                "change_pct": safe_number(quote.get("change_pct")),
                "volume": volume,
                "avg_volume": None,
                "trading_value": trading_value,
                "currency": "KRW",
            }
        )

    provider_symbols = tuple(
        dict.fromkeys(
            market_data_symbol(symbol)
            for symbol in symbols
            if symbol.upper() not in crypto_symbols
        )
    )
    if not provider_symbols:
        return pd.DataFrame(rows)

    try:
        history = yf.download(
            list(provider_symbols),
            period="7d",
            interval="1d",
            group_by="ticker",
            auto_adjust=True,
            actions=False,
            threads=True,
            progress=False,
        )
    except Exception:
        history = pd.DataFrame()

    for symbol in provider_symbols:
        price = previous_close = volume = average_volume = None
        if not history.empty:
            try:
                symbol_history = history[symbol] if isinstance(history.columns, pd.MultiIndex) else history
                closes = symbol_history["Close"].dropna()
                volumes = symbol_history["Volume"].dropna() if "Volume" in symbol_history else pd.Series(dtype=float)
                if not closes.empty:
                    price = safe_number(closes.iloc[-1])
                    previous_close = safe_number(closes.iloc[-2]) if len(closes) >= 2 else None
                if not volumes.empty:
                    volume = safe_number(volumes.iloc[-1])
                    average_volume = safe_number(volumes.tail(5).mean())
            except Exception:
                pass

        change_pct = pct_change(price, previous_close)
        trading_value = price * volume if price is not None and volume is not None else None
        currency = "KRW" if symbol.endswith(".KS") or symbol.endswith(".KQ") or symbol in {"^KS11", "^KQ11"} else "USD"
        rows.append(
            {
                "symbol": symbol,
                "price": price,
                "change_pct": change_pct,
                "volume": volume,
                "avg_volume": average_volume,
                "trading_value": trading_value,
                "currency": currency,
            }
        )
    return pd.DataFrame(rows)


@st.cache_data(ttl=3600)
def get_price_bars(symbol: str, window: str = "1M") -> pd.DataFrame:
    if is_crypto_symbol(symbol) and crypto_quote_symbol(symbol) == "KRW":
        return get_upbit_krw_bars(symbol, window)
    settings = {
        "1W": ("7d", "1h"),
        "1M": ("1mo", "4h"),
        "1Y": ("1y", "1d"),
        "YTD": ("ytd", "1d"),
    }
    period, interval = settings.get(window, settings["1M"])
    history = yf.Ticker(market_data_symbol(symbol)).history(period=period, interval=interval, auto_adjust=False, actions=False)
    if history.empty:
        return pd.DataFrame()
    history = history.reset_index()
    date_column = "Datetime" if "Datetime" in history else "Date"
    history["date"] = pd.to_datetime(history[date_column]).dt.tz_localize(None)
    return history[["date", "Open", "High", "Low", "Close", "Volume"]].dropna(subset=["Open", "High", "Low", "Close"])


@st.cache_data(ttl=60)
def get_upbit_krw_bars(symbol: str, window: str = "1M") -> pd.DataFrame:
    base_symbol = crypto_base_symbol(symbol)
    market = f"KRW-{base_symbol}"
    today = datetime.now().date()
    day_count = max(1, min(200, (today - datetime(today.year, 1, 1).date()).days + 1))
    settings = {
        "1D": ("minutes/5", 200),
        "1W": ("minutes/60", 168),
        "1M": ("days", 31),
        "1Y": ("days", 200),
        "YTD": ("days", day_count),
    }
    candle_path, count = settings.get(window, settings["1M"])
    query = urllib.parse.urlencode({"market": market, "count": count})
    data = fetch_json(f"https://api.upbit.com/v1/candles/{candle_path}?{query}")
    if not isinstance(data, list) or not data:
        return pd.DataFrame()
    rows = []
    for item in data:
        if not isinstance(item, dict):
            continue
        timestamp = item.get("candle_date_time_kst") or item.get("candle_date_time_utc")
        rows.append(
            {
                "date": pd.to_datetime(timestamp),
                "Open": safe_number(item.get("opening_price")),
                "High": safe_number(item.get("high_price")),
                "Low": safe_number(item.get("low_price")),
                "Close": safe_number(item.get("trade_price")),
                "Volume": safe_number(item.get("candle_acc_trade_volume")),
            }
        )
    if not rows:
        return pd.DataFrame()
    return pd.DataFrame(rows).sort_values("date").dropna(subset=["Open", "High", "Low", "Close"])


@st.cache_data(ttl=120)
def get_representative_chart(symbol: str, window: str) -> pd.DataFrame:
    if is_crypto_symbol(symbol) and crypto_quote_symbol(symbol) == "KRW":
        bars = get_upbit_krw_bars(symbol, window)
        return bars[["date", "Close", "Volume"]] if not bars.empty else pd.DataFrame()
    settings = {
        "1D": ("1d", "5m"),
        "1W": ("7d", "30m"),
        "1M": ("1mo", "1d"),
        "1Y": ("1y", "1d"),
    }
    period, interval = settings.get(window, settings["1D"])
    history = yf.Ticker(market_data_symbol(symbol)).history(period=period, interval=interval, auto_adjust=True, actions=False)
    if history.empty:
        return pd.DataFrame()
    history = history.reset_index()
    date_column = "Datetime" if "Datetime" in history else "Date"
    history["date"] = pd.to_datetime(history[date_column]).dt.tz_localize(None)
    return history[["date", "Close", "Volume"]].dropna(subset=["Close"])


@st.cache_data(ttl=3600)
def fetch_fred_latest(series_id: str) -> tuple[float | None, str]:
    try:
        url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}"
        data = pd.read_csv(url)
        data = data[data[series_id] != "."].dropna()
        if data.empty:
            return None, ""
        row = data.iloc[-1]
        return safe_number(row[series_id]), str(row["observation_date"])
    except Exception:
        return None, ""


@st.cache_data(ttl=3600)
def get_three_month_tbill_rate() -> tuple[float | None, str]:
    rate, as_of = fetch_fred_latest("DTB3")
    if rate is not None:
        return rate, as_of
    return fetch_fred_latest("TB3MS")


@st.cache_data(ttl=3600)
def get_macro_snapshot() -> pd.DataFrame:
    # FRED has reliable no-key CSVs for US data. Other rows use current public values as fallback
    # placeholders until a dedicated macro provider such as Trading Economics, ECOS, ECB SDW, or BOJ API is wired in.
    fed_rate, fed_date = fetch_fred_latest("FEDFUNDS")
    us_m2, us_m2_date = fetch_fred_latest("M2SL")
    rows = [
        {"country": "United States", "policy_rate_pct": fed_rate, "m2": us_m2, "m2_unit": "USD bn", "as_of": us_m2_date or fed_date, "source": "FRED"},
        {"country": "Korea", "policy_rate_pct": 2.50, "m2": 4565150.50, "m2_unit": "KRW bn", "as_of": "2026-01", "source": "BOK / public fallback"},
        {"country": "Europe", "policy_rate_pct": 2.15, "m2": 16245831.00, "m2_unit": "EUR mn", "as_of": "2026-02", "source": "ECB / public fallback"},
        {"country": "Japan", "policy_rate_pct": 0.75, "m2": 1274923.40, "m2_unit": "JPY bn", "as_of": "2026-02", "source": "BOJ / public fallback"},
        {"country": "China", "policy_rate_pct": 3.00, "m2": 353860.00, "m2_unit": "CNY bn", "as_of": "2026-03", "source": "PBOC / public fallback"},
    ]
    return pd.DataFrame(rows)


FX_TO_USD_FALLBACK = {
    "USD": 1.0,
    "KRW": 1 / 1380,
    "EUR": 1.08,
    "JPY": 1 / 155,
    "CNY": 1 / 7.25,
}


FX_TICKERS_TO_USD = {
    "KRW": "KRW=X",
    "EUR": "EURUSD=X",
    "JPY": "JPY=X",
    "CNY": "CNY=X",
}


def parse_m2_unit(unit: str) -> tuple[str, float]:
    parts = str(unit).split()
    currency = parts[0].upper() if parts else "USD"
    scale = parts[1].lower() if len(parts) > 1 else "bn"
    scale_to_bn = {"mn": 1 / 1000, "bn": 1.0, "tn": 1000.0}.get(scale, 1.0)
    return currency, scale_to_bn


@st.cache_data(ttl=3600)
def get_fx_to_usd(currency: str) -> float:
    currency = currency.upper()
    if currency == "USD":
        return 1.0
    ticker_symbol = FX_TICKERS_TO_USD.get(currency)
    if ticker_symbol:
        try:
            history = yf.Ticker(ticker_symbol).history(period="5d", interval="1d", auto_adjust=True, actions=False)
            if not history.empty:
                rate = safe_number(history["Close"].dropna().iloc[-1])
                if rate:
                    if currency in {"KRW", "JPY", "CNY"}:
                        return 1 / rate
                    return rate
        except Exception:
            pass
    return FX_TO_USD_FALLBACK.get(currency, 1.0)


def format_month(value) -> str:
    if value in (None, ""):
        return ""
    parsed = pd.to_datetime(value, errors="coerce")
    if pd.isna(parsed):
        return str(value)[:7]
    return parsed.strftime("%Y-%m")


def format_currency_amount(value, currency: str) -> str:
    value = safe_number(value)
    if value is None:
        return "N/A"
    symbols = {"USD": "$", "KRW": "₩", "EUR": "€", "JPY": "¥", "CNY": "¥"}
    return f"{symbols.get(currency, currency + ' ')}{value:,.0f}"


def format_macro_table(macro: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for _, row in macro.iterrows():
        currency, scale_to_bn = parse_m2_unit(row.get("m2_unit", "USD bn"))
        m2_value = safe_number(row.get("m2"))
        m2_usd_bn = None
        if m2_value is not None:
            m2_usd_bn = m2_value * scale_to_bn * get_fx_to_usd(currency)
        rows.append(
            {
                "Country": row.get("country", ""),
                "Policy Rate": "" if safe_number(row.get("policy_rate_pct")) is None else f"{safe_number(row.get('policy_rate_pct')):.2f}%",
                "M2": format_currency_amount(m2_value, currency),
                "M2 (USD)": format_currency_amount(m2_usd_bn, "USD"),
                "As Of": format_month(row.get("as_of", "")),
                "Source": row.get("source", ""),
            }
        )
    return pd.DataFrame(rows)


def macro_table_html(macro: pd.DataFrame) -> str:
    header_cells = "".join(f"<th>{html_lib.escape(str(column))}</th>" for column in macro.columns)
    body_rows = []
    for _, row in macro.iterrows():
        cells = []
        for column in macro.columns:
            align_class = " macro-table-number" if column in {"Policy Rate", "M2", "M2 (USD)", "As Of"} else ""
            cells.append(f'<td class="{align_class.strip()}">{html_lib.escape(str(row[column]))}</td>')
        body_rows.append(f"<tr>{''.join(cells)}</tr>")
    return (
        '<div class="macro-table-wrap">'
        '<table class="macro-table">'
        "<colgroup>"
        '<col class="macro-col-country">'
        '<col class="macro-col-policy">'
        '<col class="macro-col-standard">'
        '<col class="macro-col-standard">'
        '<col class="macro-col-standard">'
        '<col class="macro-col-standard">'
        "</colgroup>"
        f"<thead><tr>{header_cells}</tr></thead>"
        f"<tbody>{''.join(body_rows)}</tbody>"
        "</table>"
        "</div>"
    )


def format_money(value, currency=""):
    value = safe_number(value)
    if value is None:
        return "N/A"
    currency = (currency or "").upper()
    if currency == "KRW":
        return f"₩{value:,.0f}"
    prefix = "$" if currency == "USD" else ""
    suffix = f" {currency}" if currency not in {"", "USD"} else ""
    return f"{prefix}{value:,.2f}{suffix}".strip()


def format_portfolio_money(value, currency=""):
    value = safe_number(value)
    if value is None:
        return "N/A"
    currency = currency.upper()
    if currency == "KRW":
        return format_money(value, currency)
    return format_money(value, currency)


def format_pct(value):
    value = safe_number(value)
    if value is None:
        return "N/A"
    return f"{value:+.2f}%"


def format_pct_plain(value):
    value = safe_number(value)
    if value is None:
        return "N/A"
    return f"{value:+.2f}%"


def format_decimal(value, digits=4):
    value = safe_number(value)
    if value is None:
        return "N/A"
    return f"{value:,.{digits}f}"


def format_integer(value):
    value = safe_number(value)
    if value is None:
        return "N/A"
    return f"{round(value):,}"


def format_millions(value):
    value = safe_number(value)
    if value is None:
        return "N/A"
    return f"{value / 1_000_000:,.2f}M"


def format_billions(value, currency=""):
    value = safe_number(value)
    if value is None:
        return "N/A"
    currency = (currency or "").upper()
    if currency == "KRW":
        return f"₩{value / 1_000_000_000:,.2f}B"
    prefix = "$" if currency == "USD" else ""
    suffix = "B" if currency == "USD" else f"B {currency}".strip()
    return f"{prefix}{value / 1_000_000_000:,.2f}{suffix}"


def latest_metrics_row(symbol: str, benchmark: str, years: int, rolling_window: int) -> pd.Series | None:
    try:
        metrics = get_metrics(symbol, benchmark, years, rolling_window)
    except Exception:
        return None
    if metrics.empty:
        return None
    return metrics.dropna(how="all").iloc[-1]


def summary_metrics(symbol: str, benchmark: str, years: int, rolling_window: int) -> dict[str, float | None]:
    try:
        metrics = get_metrics(symbol, benchmark, years, rolling_window)
    except Exception:
        return {
            "avg_monthly_log_return": None,
            "avg_monthly_volatility": None,
            "latest_beta": None,
        }
    if metrics.empty:
        return {
            "avg_monthly_log_return": None,
            "avg_monthly_volatility": None,
            "latest_beta": None,
        }

    beta_key = f"beta_rolling_{rolling_window}m"
    return {
        "avg_monthly_log_return": safe_number(metrics["monthly_log_return"].mean()),
        "avg_monthly_volatility": safe_number(metrics["monthly_volatility"].mean()),
        "latest_beta": safe_number(metrics[beta_key].dropna().iloc[-1]) if beta_key in metrics and not metrics[beta_key].dropna().empty else None,
    }


def capm_snapshot(symbol: str, benchmark: str, years: int, rolling_window: int, quote: dict[str, object]) -> dict[str, float | str | None]:
    try:
        metrics = get_metrics(symbol, benchmark, years, rolling_window)
    except Exception:
        metrics = pd.DataFrame()

    beta_key = f"beta_rolling_{rolling_window}m"
    beta = None
    market_monthly_return = None
    if not metrics.empty:
        if beta_key in metrics and not metrics[beta_key].dropna().empty:
            beta = safe_number(metrics[beta_key].dropna().iloc[-1])
        market_monthly_return = safe_number(metrics["benchmark_monthly_log_return"].mean())

    tbill_annual_pct, tbill_as_of = get_three_month_tbill_rate()
    rf_monthly_log_return = None
    if tbill_annual_pct is not None:
        rf_monthly_log_return = math.log(1 + (tbill_annual_pct / 100)) / 12

    capm_monthly_return = None
    capm_price = None
    current_vs_capm_pct = None
    previous_close = safe_number(quote.get("previous_close"))
    current_price = safe_number(quote.get("price"))
    if (
        beta is not None
        and market_monthly_return is not None
        and rf_monthly_log_return is not None
        and previous_close is not None
    ):
        capm_monthly_return = rf_monthly_log_return + beta * (market_monthly_return - rf_monthly_log_return)
        capm_price = previous_close * math.exp(capm_monthly_return)
        current_vs_capm_pct = pct_change(current_price, capm_price)

    return {
        "risk_free_annual_pct": tbill_annual_pct,
        "risk_free_as_of": tbill_as_of,
        "market_monthly_log_return": market_monthly_return,
        "capm_monthly_log_return": capm_monthly_return,
        "capm_price": capm_price,
        "current_vs_capm_pct": current_vs_capm_pct,
    }


def average_metric_values(summaries: list[dict[str, float | None]]) -> dict[str, float | None]:
    def mean_of(key: str):
        values = [safe_number(summary.get(key)) for summary in summaries]
        values = [value for value in values if value is not None]
        return sum(values) / len(values) if values else None

    return {
        "avg_monthly_log_return": mean_of("avg_monthly_log_return"),
        "avg_monthly_volatility": mean_of("avg_monthly_volatility"),
        "latest_beta": mean_of("latest_beta"),
    }


def empty_metric_summary() -> dict[str, float | None]:
    return {
        "avg_monthly_log_return": None,
        "avg_monthly_volatility": None,
        "latest_beta": None,
    }


@st.cache_data(ttl=1800)
def sector_comparison_metrics(symbol: str, benchmark: str, years: int, rolling_window: int) -> dict[str, object]:
    profile = get_profile(symbol)
    sector = str(profile.get("sector") or "")
    watchlists = KOREA_SECTOR_WATCHLISTS if is_korea_symbol(symbol) else SECTOR_WATCHLISTS
    candidates = watchlists.get(sector, [])
    if not candidates:
        return {
            "label": "Sector",
            "metrics": empty_metric_summary(),
        }

    summaries = [
        summary_metrics(candidate, benchmark, years, rolling_window)
        for candidate in candidates
    ]
    return {
        "label": f"{sector} Sector",
        "metrics": average_metric_values(summaries),
    }


@st.cache_data(ttl=1800)
def comparison_metrics(symbol: str, benchmark: str, years: int, rolling_window: int) -> list[dict[str, object]]:
    if is_crypto_symbol(symbol):
        rows: list[dict[str, object]] = [
            {
                "label": "BTC",
                "metrics": summary_metrics("BTC-USD", benchmark.upper(), years, rolling_window),
            }
        ]
        if benchmark.upper() != "BTC-USD":
            rows.append(
                {
                    "label": f"{benchmark.upper()} Market Portfolio",
                    "metrics": summary_metrics(benchmark.upper(), benchmark.upper(), years, rolling_window),
                }
            )
        return rows

    return [
        sector_comparison_metrics(symbol, benchmark, years, rolling_window),
        {
            "label": f"{benchmark.upper()} Benchmark",
            "metrics": summary_metrics(benchmark.upper(), benchmark.upper(), years, rolling_window),
        },
    ]


def to_percent(value):
    value = safe_number(value)
    if value is None:
        return None
    return value * 100


def summary_card_html(label: str, value: str, delta: str | None = None, large: bool = False) -> str:
    value_class = "summary-value large" if large else "summary-value"
    delta_value = safe_number(str(delta).replace("%", "")) if delta and delta != "N/A" else None
    delta_class = "summary-delta neutral"
    if delta_value is not None:
        delta_class = "summary-delta positive" if delta_value >= 0 else "summary-delta negative"

    card_class = "summary-card large" if large else "summary-card"
    delta_html = f'<div class="{delta_class}">{html_lib.escape(delta or "")}</div>' if delta else ""
    return "".join(
        [
            f'<div class="{card_class}">',
            f'<div class="summary-label">{html_lib.escape(label)}</div>',
            '<div class="summary-value-row">',
            f'<span class="{value_class}">{html_lib.escape(value)}</span>',
            "</div>",
            delta_html,
            "</div>",
        ]
    )


def portfolio_summary_card_html(label: str, value: str, value_class: str = "neutral", compact: bool = False) -> str:
    card_class = "portfolio-mini-card compact" if compact else "portfolio-mini-card"
    return "".join(
        [
            f'<div class="{card_class}">',
            f'<div class="portfolio-mini-label">{html_lib.escape(label)}</div>',
            f'<div class="portfolio-mini-value {value_class}">{html_lib.escape(value)}</div>',
            "</div>",
        ]
    )


ALLOCATION_COLORS = [
    "#0068c9",
    "#83c9ff",
    "#ff2b2b",
    "#ffabab",
    "#29b09d",
    "#ff8700",
    "#6d3fc0",
    "#00c7b7",
    "#7f7f7f",
    "#bcbd22",
]


def allocation_color_range(count: int) -> list[str]:
    if count <= len(ALLOCATION_COLORS):
        return ALLOCATION_COLORS[:count]
    repeats = (count // len(ALLOCATION_COLORS)) + 1
    return (ALLOCATION_COLORS * repeats)[:count]


def allocation_legend_html(symbols: list[str], colors: list[str]) -> str:
    items = []
    for symbol, color in zip(symbols, colors):
        items.append(
            "".join(
                [
                    '<div class="allocation-legend-item">',
                    f'<span class="allocation-legend-swatch" style="background:{html_lib.escape(color)}"></span>',
                    f'<span class="allocation-legend-label">{html_lib.escape(symbol)}</span>',
                    "</div>",
                ]
            )
        )
    return f'<div class="allocation-legend">{"".join(items)}</div>'


def render_focus_summary(symbol: str, benchmark: str, years: int, rolling_window: int):
    benchmark = benchmark.upper()
    quote = get_quote(symbol)
    metric_summary = summary_metrics(symbol, benchmark, years, rolling_window)
    capm = capm_snapshot(symbol, benchmark, years, rolling_window, quote)
    comparisons = comparison_metrics(symbol, benchmark, years, rolling_window)

    st.subheader(display_symbol(symbol, str(quote.get("currency") or "")))
    price_cards = [
        summary_card_html("Current Price", format_money(quote["price"], quote["currency"]), format_pct(quote["change_pct"]), large=True),
        summary_card_html("Previous Close", format_money(quote["previous_close"], quote["currency"]), large=True),
        summary_card_html("CAPM_Price", format_money(capm["capm_price"], quote["currency"]), large=True),
        summary_card_html("Current vs CAPM", format_pct(capm["current_vs_capm_pct"]), large=True),
    ]
    metric_cards = [
        summary_card_html("Avg Monthly Log Return", format_pct(to_percent(metric_summary["avg_monthly_log_return"]))),
        summary_card_html("Avg Monthly Volatility", format_pct(to_percent(metric_summary["avg_monthly_volatility"]))),
        summary_card_html(f"Monthly Beta ({rolling_window}M)", format_decimal(metric_summary["latest_beta"])),
    ]
    comparison_rows = []
    for comparison in comparisons:
        comparison_label = str(comparison["label"])
        comparison_summary = comparison["metrics"]
        comparison_rows.append(
            "".join(
                [
                    summary_card_html(f"{comparison_label} Log Return", format_pct(to_percent(comparison_summary["avg_monthly_log_return"]))),
                    summary_card_html(f"{comparison_label} Volatility", format_pct(to_percent(comparison_summary["avg_monthly_volatility"]))),
                    summary_card_html(f"{comparison_label} Beta", format_decimal(comparison_summary["latest_beta"])),
                ]
            )
        )
    st.markdown(
        (
            '<div class="summary-stack">'
            f'<div class="summary-grid summary-grid-4">{"".join(price_cards)}</div>'
            f'<div class="summary-grid summary-grid-3">{"".join(metric_cards)}</div>'
            f'{"".join(f"<div class=\"summary-grid summary-grid-3\">{row}</div>" for row in comparison_rows)}'
            "</div>"
        ),
        unsafe_allow_html=True,
    )
    st.caption(
        f"CAPM uses the 3M T-Bill as risk-free rate ({format_pct(capm['risk_free_annual_pct'])}, {capm['risk_free_as_of']})."
    )


def render_quote_cards(symbols: list[str]):
    cols = st.columns(min(4, max(1, len(symbols))))
    for index, symbol in enumerate(symbols):
        quote = get_quote(symbol)
        with cols[index % len(cols)]:
            st.metric(
                label=display_ticker(symbol, str(quote.get("currency") or "")),
                value=format_money(quote["price"], quote["currency"]),
                delta=format_pct(quote["change_pct"]),
                help=f"Previous close: {format_money(quote['previous_close'], quote['currency'])}\nExchange: {quote['exchange']}\nUTC: {quote['timestamp_utc']}",
            )


def render_market_movers(universe_symbols: list[str], market: str):
    st.subheader("Market Movers")
    if market == "crypto":
        st.caption("Crypto movers are limited to the configured large-cap crypto universe that Yahoo Finance/yfinance can resolve, not every listed coin.")
    elif market == "us":
        st.caption("US movers use the app universe plus Yahoo predefined active/gainer/loser lists when available.")
    elif market == "korea":
        st.caption("Korea movers use the configured KRX large-cap universe available through Yahoo Finance suffixes.")
    universe = set(universe_symbols)
    if market == "crypto":
        universe = {symbol for symbol in universe if not is_stablecoin_symbol(symbol)}
    if market == "us":
        for screener_name in ("most_actives", "day_gainers", "day_losers"):
            try:
                result = yf.screen(screener_name, count=25)
                quotes = result.get("quotes", []) if isinstance(result, dict) else []
                universe.update(quote.get("symbol", "").upper() for quote in quotes if quote.get("symbol"))
            except Exception:
                pass

    snapshot = get_market_snapshot(tuple(sorted(universe)))
    if snapshot.empty:
        st.info("Market mover data is unavailable right now.")
        return

    def style_column(data: pd.DataFrame, column: str):
        return data.style.apply(
            lambda row: ["background-color: #374151; color: #f9fafb; font-weight: 700" if name == column else "" for name in row.index],
            axis=1,
        )

    def format_mover_rows(data: pd.DataFrame) -> pd.DataFrame:
        formatted = data.copy()
        formatted["price"] = formatted.apply(lambda row: format_money(row["price"], row["currency"]), axis=1)
        formatted["change_pct"] = formatted["change_pct"].map(format_pct)
        formatted["volume"] = formatted["volume"].map(format_millions)
        formatted["trading_value"] = formatted.apply(lambda row: format_billions(row["trading_value"], row["currency"]), axis=1)
        return formatted[["symbol", "price", "change_pct", "volume", "trading_value"]]

    def show_top(title: str, column: str, ascending: bool = False):
        data = snapshot.dropna(subset=[column]).sort_values(column, ascending=ascending).head(10).copy()
        formatted = format_mover_rows(data)
        st.markdown(f"**{title}**")
        st.dataframe(
            style_column(formatted, column),
            use_container_width=True,
            hide_index=True,
            height=212,
        )

    row1 = st.columns(2)
    with row1[0]:
        show_top("Trading Value", "trading_value")
    with row1[1]:
        show_top("Volume", "volume")

    row2 = st.columns(2)
    with row2[0]:
        show_top("Largest Up Move vs Previous Close", "change_pct")
    with row2[1]:
        losers = snapshot.copy()
        losers["down_move"] = losers["change_pct"].where(losers["change_pct"] < 0).abs()
        data = losers.dropna(subset=["down_move"]).sort_values("down_move", ascending=False).head(10).copy()
        formatted = format_mover_rows(data)
        st.markdown("**Largest Down Move vs Previous Close**")
        st.dataframe(
            style_column(formatted, "change_pct"),
            use_container_width=True,
            hide_index=True,
            height=212,
        )


def render_price_bar_chart(symbol: str):
    window = st.pills("Bar range", ["1W", "1M", "1Y", "YTD"], default="1M", key=f"{symbol}_bar_range")
    bars = get_price_bars(symbol, window or "1M")
    if bars.empty:
        st.info(f"{display_ticker(symbol)} price bar data is unavailable.")
        return
    bars = bars.sort_values("date").reset_index(drop=True)
    bars["date_label"] = bars["date"].dt.strftime("%m-%d %H:%M" if window in {"1W", "1M"} else "%Y-%m-%d")

    min_low = safe_number(bars["Low"].min())
    max_high = safe_number(bars["High"].max())
    y_scale = alt.Scale(zero=False)
    if min_low is not None and max_high is not None:
        lower = min_low * 0.995
        upper = max_high * 1.005
        if lower == upper:
            lower *= 0.995
            upper *= 1.005
        y_scale = alt.Scale(domain=[lower, upper], zero=False)

    body_size = {"1W": 10, "1M": 9, "1Y": 3, "YTD": 4}.get(window or "1M", 7)
    price_format = ",.0f" if is_crypto_symbol(symbol) and crypto_quote_symbol(symbol) == "KRW" else ",.2f"
    x_axis = alt.X(
        "date_label:O",
        title="Date",
        sort=None,
        axis=alt.Axis(labelAngle=-45, labelOverlap=True, labelLimit=80),
        scale=alt.Scale(paddingInner=0.08 if window in {"1W", "1M"} else 0.18, paddingOuter=0.02),
    )
    base = alt.Chart(bars).encode(x=x_axis)
    rule = base.mark_rule(size=1).encode(
        y=alt.Y("Low:Q", title="Price", scale=y_scale),
        y2="High:Q",
        color=alt.condition(alt.datum.Close >= alt.datum.Open, alt.value("#16a34a"), alt.value("#dc2626")),
        tooltip=[
            alt.Tooltip("date:T", title="Date"),
            alt.Tooltip("Open:Q", format=price_format),
            alt.Tooltip("High:Q", format=price_format),
            alt.Tooltip("Low:Q", format=price_format),
            alt.Tooltip("Close:Q", format=price_format),
            alt.Tooltip("Volume:Q", format=",.0f"),
        ],
    )
    body_mark = base.mark_bar() if is_crypto_symbol(symbol) else base.mark_bar(size=body_size)
    body = body_mark.encode(
        y="Open:Q",
        y2="Close:Q",
        color=alt.condition(alt.datum.Close >= alt.datum.Open, alt.value("#16a34a"), alt.value("#dc2626")),
    )
    st.altair_chart((rule + body).properties(height=260), use_container_width=True)


def render_representative_chart(symbol: str, title: str):
    st.subheader(title)
    window = st.pills("Time range", ["1D", "1W", "1M", "1Y"], default="1D", key=f"{symbol}_time_range")
    data = get_representative_chart(symbol, window or "1D")
    if data.empty:
        st.info(f"{display_ticker(symbol)} chart data is unavailable.")
        return
    price_format = ",.0f" if is_crypto_symbol(symbol) and crypto_quote_symbol(symbol) == "KRW" else ",.2f"

    min_close = safe_number(data["Close"].min())
    max_close = safe_number(data["Close"].max())
    y_scale = alt.Scale(zero=False)
    if min_close is not None and max_close is not None:
        lower = min_close * 0.995
        upper = max_close * 1.005
        if lower == upper:
            lower *= 0.995
            upper *= 1.005
        y_scale = alt.Scale(domain=[lower, upper], zero=False)

    chart = (
        alt.Chart(data)
        .mark_line(color="#2563eb", strokeWidth=2)
        .encode(
            x=alt.X("date:T", title="Time"),
            y=alt.Y("Close:Q", title="Close", scale=y_scale),
            tooltip=[
                alt.Tooltip("date:T", title="Time"),
                alt.Tooltip("Close:Q", title="Close", format=price_format),
                alt.Tooltip("Volume:Q", title="Volume", format=",.0f"),
            ],
        )
        .properties(height=330)
    )
    st.altair_chart(chart, use_container_width=True)


def render_index_strip(market: str):
    symbols = INDEX_GROUPS[market]
    st.subheader("Major Indices")
    cols = st.columns(len(symbols))
    for col, symbol in zip(cols, symbols):
        quote = get_quote(symbol)
        col.metric(
            display_symbol(symbol, str(quote.get("currency") or "")),
            format_money(quote["price"], quote["currency"]),
            format_pct(quote["change_pct"]),
        )


def render_macro_panel():
    st.subheader("Rates and M2")
    macro = format_macro_table(get_macro_snapshot())
    st.markdown(macro_table_html(macro), unsafe_allow_html=True)


def render_market_main(config: dict[str, object]):
    st.header(str(config["title"]))
    render_representative_chart(str(config["representative"]), str(config["representative_name"]))
    render_index_strip(str(config["market"]))
    render_macro_panel()
    render_market_movers(list(config["universe"]), str(config["market"]))


def render_metrics(symbol: str, benchmark: str, years: int, rolling_window: int):
    try:
        metrics = get_metrics(symbol, benchmark, years, rolling_window)
    except Exception as exc:
        st.warning(f"{symbol} metric calculation failed: {exc}")
        return

    st.subheader(f"{display_ticker(symbol)} Monthly Metrics")
    chart_data = metrics.copy()
    chart_data["month_date"] = pd.to_datetime(chart_data["month"])
    chart_data["monthly_log_return_pct"] = chart_data["monthly_log_return"] * 100
    chart_data["monthly_volatility_pct"] = chart_data["monthly_volatility"] * 100

    st.markdown("**Price Bar Chart**")
    render_price_bar_chart(symbol)

    st.markdown("**Monthly Log Return**")
    return_line = (
        alt.Chart(chart_data)
        .mark_line(color="#2563eb", strokeWidth=2)
        .encode(
            x=alt.X("month_date:T", title="Month"),
            y=alt.Y(
                "monthly_log_return_pct:Q",
                title="Monthly Log Return (%)",
                axis=alt.Axis(titleColor="#2563eb", format=".1f"),
            ),
            tooltip=[
                alt.Tooltip("month:N", title="Month"),
                alt.Tooltip("monthly_log_return_pct:Q", title="Monthly Log Return (%)", format=".2f"),
                alt.Tooltip("monthly_volatility_pct:Q", title="Monthly Volatility (%)", format=".2f"),
            ],
        )
    )
    st.altair_chart(return_line.properties(height=300), use_container_width=True)

    st.markdown("**Monthly Volatility and Rolling Beta**")
    beta_key = f"beta_rolling_{rolling_window}m"
    volatility_line = (
        alt.Chart(chart_data)
        .mark_line(color="#dc2626", strokeWidth=2)
        .encode(
            x=alt.X("month_date:T", title="Month"),
            y=alt.Y(
                "monthly_volatility_pct:Q",
                title="Monthly Volatility (%)",
                axis=alt.Axis(titleColor="#dc2626", orient="right", format=".1f"),
            ),
            tooltip=[
                alt.Tooltip("month:N", title="Month"),
                alt.Tooltip("monthly_log_return_pct:Q", title="Monthly Log Return (%)", format=".2f"),
                alt.Tooltip("monthly_volatility_pct:Q", title="Monthly Volatility (%)", format=".2f"),
            ],
        )
    )
    if beta_key in chart_data:
        beta_chart = (
            alt.Chart(chart_data)
            .mark_line(color="#16a34a", strokeWidth=2)
            .encode(
                x=alt.X("month_date:T", title="Month"),
                y=alt.Y(f"{beta_key}:Q", title=f"Rolling Beta ({rolling_window}M)"),
                tooltip=[
                    alt.Tooltip("month:N", title="Month"),
                    alt.Tooltip(f"{beta_key}:Q", title=f"Rolling Beta ({rolling_window}M)", format=".3f"),
                    alt.Tooltip("beta_full_period:Q", title="Full-period Beta", format=".3f"),
                ],
            )
        )
        st.altair_chart(
            alt.layer(volatility_line, beta_chart).resolve_scale(y="independent").properties(height=300),
            use_container_width=True,
        )

    display_metrics = metrics.copy()
    display_metrics["monthly_log_return_pct"] = display_metrics["monthly_log_return"] * 100
    display_metrics["benchmark_monthly_log_return_pct"] = display_metrics["benchmark_monthly_log_return"] * 100
    display_metrics["monthly_volatility_pct"] = display_metrics["monthly_volatility"] * 100
    display_table = display_metrics.tail(24).iloc[::-1].copy()
    display_table = pd.DataFrame(
        {
            "Month": display_table["month"],
            "Symbol": display_ticker(symbol),
            "Benchmark": display_ticker(benchmark),
            "Monthly Return": display_table["monthly_log_return_pct"].map(format_pct_plain),
            "Benchmark Return": display_table["benchmark_monthly_log_return_pct"].map(format_pct_plain),
            "Monthly Volatility": display_table["monthly_volatility_pct"].map(format_pct_plain),
            "Beta (Full Period)": display_table["beta_full_period"].map(lambda value: format_decimal(value, 4)),
            "Beta (Rolling)": display_table[beta_key].map(lambda value: format_decimal(value, 4)),
        }
    )
    display_table.index = range(1, len(display_table) + 1)
    display_table.index.name = ""
    st.markdown(
        (
            '<div class="metrics-table-wrap">'
            f'{display_table.to_html(classes="metrics-table", escape=True, border=0)}'
            "</div>"
        ),
        unsafe_allow_html=True,
    )


def render_profile(symbol: str):
    profile = get_profile(symbol)
    st.subheader(profile["name"])
    facts = [
        ("Sector", profile["sector"] or "N/A"),
        ("Industry", profile["industry"] or "N/A"),
        ("Country", profile["country"] or "N/A"),
        ("Website", profile["website"] or "N/A"),
    ]
    cols = st.columns(4)
    for col, (label, value) in zip(cols, facts):
        col.metric(label, value)
    if profile["summary"]:
        st.write(profile["summary"])
    return profile


def render_peers(symbol: str, sector: str):
    candidates = [item for item in SECTOR_WATCHLISTS.get(sector, []) if item != symbol]
    if not candidates:
        st.info("No sector watchlist is configured for this asset yet.")
        return

    rows = []
    for candidate in candidates[:8]:
        quote = get_quote(candidate)
        candidate_profile = get_profile(candidate)
        rows.append(
            {
                "symbol": candidate,
                "company": candidate_profile["name"],
                "industry": candidate_profile["industry"],
                "price": quote["price"],
                "previous_close": quote["previous_close"],
                "change_vs_prev_close_pct": quote["change_pct"],
                "currency": quote["currency"],
            }
        )
    st.dataframe(pd.DataFrame(rows), use_container_width=True)


def render_statements(symbol: str):
    labels = {
        "balance": "Financial Position Statement",
        "income": "Income Statement",
        "cashflow": "Cashflow Statement",
    }
    payload_key = f"financial_payload_{financial_cache_key(symbol)}"
    source_key = f"{payload_key}_source"
    payload = st.session_state.get(payload_key)
    if not isinstance(payload, dict) or payload.get("symbol") != financial_cache_key(symbol):
        st.info("Financial statements and ratios are loaded on demand and cached once per day.")
        if st.button("Load financial data", use_container_width=True, key=f"load_financial_data_{financial_cache_key(symbol)}"):
            with st.spinner("Loading financial data..."):
                payload, cached = get_financial_payload(symbol)
            st.session_state[payload_key] = payload
            st.session_state[source_key] = "daily cache" if cached else "fresh yfinance fetch"
            st.rerun()
        return

    source = st.session_state.get(source_key) or "daily cache"
    cache_date = str(payload.get("cache_date") or financial_cache_date())
    generated_at = str(payload.get("generated_at") or "")
    st.caption(f"Loaded from {source}. Cache date: {cache_date}" + (f" · Generated at: {generated_at}" if generated_at else ""))

    tabs = st.tabs(
        ["Financial Position", "Income", "Cashflow", "Financial Ratio"],
        key=f"financial_statement_tabs_{financial_cache_key(symbol)}",
        on_change="rerun",
    )
    for tab, statement_type in zip(tabs[:3], ["balance", "income", "cashflow"]):
        if tab.open:
            with tab:
                statement = statement_from_financial_payload(payload, statement_type)
                st.subheader(labels[statement_type])
                if statement.empty:
                    st.info("No statement data was returned for this symbol.")
                else:
                    if statement_type == "balance":
                        st.markdown(grouped_balance_statement_html(statement), unsafe_allow_html=True)
                    elif statement_type == "income":
                        st.markdown(grouped_income_statement_html(statement), unsafe_allow_html=True)
                    else:
                        formatted = format_statement_table(statement, statement_type)
                        st.markdown(
                            (
                                '<div class="financial-table-wrap">'
                                f'{formatted.to_html(classes="financial-table", escape=True, border=0, index=False)}'
                                "</div>"
                            ),
                            unsafe_allow_html=True,
                        )
    if tabs[3].open:
        with tabs[3]:
            ratios = ratios_from_financial_payload(payload)
            st.subheader("Financial Ratio")
            if ratios.empty:
                st.info("Financial ratio data is unavailable for this symbol.")
                return
            st.markdown(
                (
                    '<div class="financial-table-wrap financial-ratio-wrap">'
                    f'{ratios.to_html(classes="financial-table financial-ratio-table", escape=True, border=0, index=False)}'
                    "</div>"
                ),
                unsafe_allow_html=True,
            )
            industry = str(payload.get("industry") or "industry")
            peer_count = safe_number(payload.get("ratio_peer_count")) or 0
            if peer_count:
                st.caption(f"Industry average uses {int(peer_count)} comparable companies from {industry}.")
            else:
                st.caption(f"Industry average is unavailable for {industry}.")


def render_symbol_search(default_symbol: str = "AAPL") -> str:
    if "selected_symbol" not in st.session_state:
        st.session_state.selected_symbol = default_symbol

    raw_symbol = st.text_input("Symbol", value=st.session_state.selected_symbol, help="Type part of a ticker.")
    candidates = search_symbols(raw_symbol, limit=12)
    normalized = normalize_symbol(raw_symbol)
    if normalized and normalized not in candidates:
        candidates = [normalized] + candidates

    if raw_symbol.strip():
        with st.container(border=True):
            for candidate in candidates[:10]:
                if st.button(display_symbol(candidate), key=f"candidate_{candidate}", use_container_width=True):
                    st.session_state.selected_symbol = candidate
                    st.session_state.pending_page = "Symbol Detail"
                    st.rerun()

    if st.session_state.selected_symbol not in candidates and normalized:
        st.session_state.selected_symbol = normalized
    return st.session_state.selected_symbol


def render_login_page(cookie_controller=None):
    st.header("Login")
    if is_logged_in():
        record = get_user_record() or {}
        profile = record.get("profile", {}) if isinstance(record.get("profile"), dict) else {}
        st.success(f"Signed in as {profile.get('display_name') or current_username()}.")
        cols = st.columns(2)
        if cols[0].button("Go to My Page", use_container_width=True):
            st.session_state.pending_page = "My Page"
            st.rerun()
        if cols[1].button("Logout", use_container_width=True):
            logout(cookie_controller)
            st.rerun()
        return

    login_tab, create_tab = st.tabs(["Login", "Create Account"])
    with login_tab:
        with st.form("login_form"):
            username = st.text_input("Username", key="login_username")
            password = st.text_input("Password", type="password", key="login_password")
            remember_login = st.checkbox("Keep me logged in on this computer", value=True, key="login_remember")
            submitted = st.form_submit_button("Login", use_container_width=True)
        if submitted:
            ok, message = authenticate(username, password)
            if ok:
                if remember_login:
                    queue_remember_cookie(create_remember_login_token(normalize_username(username)))
                st.success(message)
                st.session_state.pending_page = "My Page"
                st.rerun()
            else:
                st.error(message)

    with create_tab:
        with st.form("create_account_form"):
            new_username = st.text_input("New username", key="create_username")
            display_name = st.text_input("Display name", key="create_display_name")
            email = st.text_input("Email", key="create_email")
            new_password = st.text_input("New password", type="password", key="create_password")
            confirm_password = st.text_input("Confirm password", type="password", key="create_confirm_password")
            remember_login = st.checkbox("Keep me logged in on this computer", value=True, key="create_remember")
            submitted = st.form_submit_button("Create account", use_container_width=True)
        if submitted:
            if new_password != confirm_password:
                st.error("Passwords do not match.")
            else:
                ok, message = create_account(new_username, new_password, display_name, email)
                if ok:
                    authenticate(new_username, new_password)
                    if remember_login:
                        queue_remember_cookie(create_remember_login_token(normalize_username(new_username)))
                    st.success(message)
                    st.session_state.pending_page = "My Page"
                    st.rerun()
                else:
                    st.error(message)


def require_login() -> bool:
    if is_logged_in():
        return True
    st.info("Login is required to use My Page. Use the login panel at the top of the left sidebar.")
    return False


def render_alert_banner(triggered_alerts: list[dict[str, object]]) -> None:
    notified = st.session_state.setdefault("notified_alert_ids", set())
    for alert in triggered_alerts:
        symbol = str(alert.get("symbol") or "")
        direction = "above" if alert.get("direction") == "above" else "below"
        currency = str(alert.get("currency") or "")
        price = format_money(alert.get("price"), currency)
        target = format_money(alert.get("target_price"), currency)
        message = f"{symbol} is {direction} target: current {price}, target {target}."
        st.warning(message)
        alert_id = str(alert.get("id") or message)
        if alert_id not in notified:
            st.toast(message)
            notified.add(alert_id)


def portfolio_sidebar_summary(username: str) -> tuple[dict[str, float | None], str]:
    record = get_user_record(username) or {}
    portfolio = record.get("portfolio", [])
    portfolio = portfolio if isinstance(portfolio, list) else []
    summary_currency = default_portfolio_summary_currency(portfolio)
    snapshots = portfolio_position_snapshots(portfolio, summary_currency)
    return portfolio_totals(snapshots), summary_currency


def render_sidebar_auth_panel(cookie_controller=None) -> None:
    st.subheader("Login")
    if is_logged_in():
        username = current_username()
        record = get_user_record(username) or {}
        profile = record.get("profile", {}) if isinstance(record.get("profile"), dict) else {}
        totals, summary_currency = portfolio_sidebar_summary(username)
        st.caption(f"{profile.get('display_name') or username}")
        st.markdown(
            "".join(
                [
                    portfolio_summary_card_html(
                        "Current Wealth",
                        format_portfolio_money(totals["current_wealth"], summary_currency),
                        compact=True,
                    ),
                    portfolio_summary_card_html(
                        "Total Investment",
                        format_portfolio_money(totals["total_investment"], summary_currency),
                        compact=True,
                    ),
                    portfolio_summary_card_html(
                        "Total Gain/Loss",
                        format_portfolio_money(totals["total_gain_loss"], summary_currency),
                        signed_value_class(totals["total_gain_loss"]),
                        compact=True,
                    ),
                    portfolio_summary_card_html(
                        "Total Return",
                        format_pct(totals["total_gain_loss_pct"]),
                        signed_value_class(totals["total_gain_loss_pct"]),
                        compact=True,
                    ),
                ]
            ),
            unsafe_allow_html=True,
        )
        if st.button("My Page", use_container_width=True, key="sidebar_go_my_page"):
            st.session_state.pending_page = "My Page"
            st.rerun()
        if st.button("Logout", use_container_width=True, key="sidebar_logout"):
            logout(cookie_controller)
            st.rerun()
        return

    with st.form("sidebar_login_form"):
        username = st.text_input("ID", key="sidebar_login_username")
        password = st.text_input("PW", type="password", key="sidebar_login_password")
        remember_login = st.checkbox("Keep me logged in", value=True, key="sidebar_login_remember")
        submitted = st.form_submit_button("Login", use_container_width=True)
    if submitted:
        ok, message = authenticate(username, password)
        if ok:
            if remember_login:
                queue_remember_cookie(create_remember_login_token(normalize_username(username)))
            st.success(message)
            st.rerun()
        else:
            st.error(message)

    with st.expander("Create account"):
        with st.form("sidebar_create_account_form"):
            new_username = st.text_input("New ID", key="sidebar_create_username")
            display_name = st.text_input("Display name", key="sidebar_create_display_name")
            email = st.text_input("Email", key="sidebar_create_email")
            new_password = st.text_input("New PW", type="password", key="sidebar_create_password")
            confirm_password = st.text_input("Confirm PW", type="password", key="sidebar_create_confirm_password")
            remember_login = st.checkbox("Keep me logged in", value=True, key="sidebar_create_remember")
            submitted = st.form_submit_button("Create account", use_container_width=True)
        if submitted:
            if new_password != confirm_password:
                st.error("Passwords do not match.")
            else:
                ok, message = create_account(new_username, new_password, display_name, email)
                if ok:
                    authenticate(new_username, new_password)
                    if remember_login:
                        queue_remember_cookie(create_remember_login_token(normalize_username(new_username)))
                    st.success(message)
                    st.rerun()
                else:
                    st.error(message)


def render_portfolio_summary(
    username: str,
    record: dict[str, object],
    snapshots: list[dict[str, object]],
    summary_currency: str,
    benchmark: str,
    years: int,
    rolling_window: int,
) -> None:
    chart_rows = [
        {
            "Symbol": display_ticker(
                str(snapshot.get("symbol") or ""),
                str(snapshot.get("cost_currency") or summary_currency),
            ),
            "Market Value": safe_number(snapshot.get("market_value_summary")) or 0,
        }
        for snapshot in snapshots
        if (safe_number(snapshot.get("market_value_summary")) or 0) > 0
    ]
    chart_rows = sorted(chart_rows, key=lambda row: row["Market Value"], reverse=True)
    totals = portfolio_totals(snapshots)
    saved_calculation = record.get("portfolio_calculation", {})
    if not isinstance(saved_calculation, dict):
        saved_calculation = {}
    projection = (
        saved_calculation
        if portfolio_calculation_matches(saved_calculation, summary_currency, benchmark, years, rolling_window)
        else empty_portfolio_calculation()
    )
    chart_col, metric_col, projection_col = st.columns([1.25, 0.85, 0.85])

    with chart_col:
        st.markdown("**Portfolio Allocation**")
        if chart_rows:
            chart_data = pd.DataFrame(chart_rows)
            total_value = chart_data["Market Value"].sum()
            chart_data["Share"] = chart_data["Market Value"] / total_value
            chart_data["Rank"] = range(1, len(chart_data) + 1)
            symbol_order = chart_data["Symbol"].tolist()
            color_range = allocation_color_range(len(symbol_order))
            chart = (
                alt.Chart(chart_data)
                .mark_arc(innerRadius=62, outerRadius=108)
                .encode(
                    theta=alt.Theta("Market Value:Q", stack=True),
                    order=alt.Order("Rank:Q", sort="ascending"),
                    color=alt.Color(
                        "Symbol:N",
                        scale=alt.Scale(domain=symbol_order, range=color_range),
                        legend=None,
                    ),
                    tooltip=[
                        alt.Tooltip("Symbol:N", title="Symbol"),
                        alt.Tooltip("Market Value:Q", title=f"Value ({summary_currency})", format=",.0f"),
                        alt.Tooltip("Share:Q", title="Weight", format=".2%"),
                    ],
                )
                .properties(width=300, height=280)
            )
            allocation_chart_col, allocation_legend_col = st.columns([0.72, 0.28])
            with allocation_chart_col:
                _chart_left_pad, chart_slot, _chart_right_pad = st.columns([1, 3, 1])
                with chart_slot:
                    st.altair_chart(chart, use_container_width=False)
            with allocation_legend_col:
                st.markdown(allocation_legend_html(symbol_order, color_range), unsafe_allow_html=True)
        else:
            st.info("Allocation chart needs at least one position with a current value.")

    with metric_col:
        st.markdown("**Portfolio Summary**")
        st.markdown(
            "".join(
                [
                    portfolio_summary_card_html("Current Wealth", format_portfolio_money(totals["current_wealth"], summary_currency)),
                    portfolio_summary_card_html("Total Investment Value", format_portfolio_money(totals["total_investment"], summary_currency)),
                    portfolio_summary_card_html(
                        "Total Gain/Loss",
                        format_portfolio_money(totals["total_gain_loss"], summary_currency),
                        signed_value_class(totals["total_gain_loss"]),
                    ),
                    portfolio_summary_card_html(
                        "Total Return",
                        format_pct(totals["total_gain_loss_pct"]),
                        signed_value_class(totals["total_gain_loss_pct"]),
                    ),
                ]
            ),
            unsafe_allow_html=True,
        )

    with projection_col:
        st.markdown("**Portfolio Expected Return**")
        st.markdown(
            "".join(
                [
                    portfolio_summary_card_html(
                        f"Portfolio Beta ({rolling_window}M)",
                        format_decimal(projection["portfolio_beta"]),
                    ),
                    portfolio_summary_card_html(
                        "Monthly Expected Log Return",
                        format_pct(to_percent(projection["expected_monthly_log_return"])),
                        signed_value_class(projection["expected_monthly_log_return"]),
                    ),
                    portfolio_summary_card_html(
                        "Expected Portfolio Value",
                        format_portfolio_money(projection["expected_portfolio_value"], summary_currency),
                    ),
                    portfolio_summary_card_html(
                        "Expected Gain/Loss",
                        format_portfolio_money(projection["expected_gain"], summary_currency),
                        signed_value_class(projection["expected_gain"]),
                    ),
                ]
            ),
            unsafe_allow_html=True,
        )
        beta_coverage = safe_number(projection.get("beta_coverage"))
        if beta_coverage is not None and beta_coverage < 99.5:
            st.caption(f"Beta coverage: {beta_coverage:.1f}% of current portfolio value.")
        calculated_at = str(projection.get("calculated_at") or "")
        if calculated_at:
            st.caption(f"Calculated at {calculated_at}")


def render_portfolio_manager(username: str, record: dict[str, object], benchmark: str, years: int, rolling_window: int) -> None:
    st.subheader("Portfolio")
    portfolio = record.get("portfolio", [])
    portfolio = portfolio if isinstance(portfolio, list) else []
    default_currency = default_portfolio_summary_currency(portfolio)
    control_cols = st.columns([0.46, 0.28, 0.26])
    with control_cols[0]:
        summary_currency = st.radio(
            "Portfolio summary currency",
            ["USD", "KRW"],
            index=0 if default_currency == "USD" else 1,
            horizontal=True,
            key="portfolio_summary_currency",
        )
    snapshots = portfolio_position_snapshots(portfolio, summary_currency)
    rows = portfolio_market_rows_from_snapshots(snapshots)
    with control_cols[1]:
        st.markdown('<div class="portfolio-update-action-spacer"></div>', unsafe_allow_html=True)
        if st.button("Update calculation", use_container_width=True, key="portfolio_update_calculation", disabled=not bool(rows)):
            updated_record = get_user_record(username) or record or default_user_record(username)
            updated_record["portfolio_calculation"] = portfolio_calculation_record(
                snapshots,
                summary_currency,
                benchmark,
                years,
                rolling_window,
            )
            save_user_record(username, updated_record)
            st.success("Portfolio calculation updated.")
            st.rerun()
    if rows:
        render_portfolio_summary(username, record, snapshots, summary_currency, benchmark, years, rolling_window)
        st.dataframe(pd.DataFrame(rows), use_container_width=True, hide_index=True)
        st.markdown("**Edit Positions**")
        edited_positions = st.data_editor(
            pd.DataFrame(portfolio_edit_rows(portfolio)),
            use_container_width=True,
            hide_index=True,
            num_rows="fixed",
            key="portfolio_position_editor",
            disabled=["Symbol"],
            column_config={
                "Quantity": st.column_config.NumberColumn("Quantity", min_value=0.0, step=0.0001, format="%.6f"),
                "Average Cost": st.column_config.NumberColumn("Average Cost", min_value=0.0, step=1.0, format="%.6f"),
                "Cost Currency": st.column_config.SelectboxColumn("Cost Currency", options=["USD", "KRW"]),
                "Note": st.column_config.TextColumn("Note"),
            },
        )
        if st.button("Save edited positions", use_container_width=True):
            save_portfolio_edits(username, edited_positions.to_dict("records"))
            st.success("Portfolio edits saved.")
            st.rerun()
    else:
        st.info("No portfolio positions yet.")

    with st.form("portfolio_position_form"):
        default_symbol = str(st.session_state.get("selected_symbol", "AAPL"))
        default_currency = "KRW" if is_korea_symbol(default_symbol) or crypto_quote_symbol(default_symbol) == "KRW" else "USD"
        cols = st.columns([1.3, 0.9, 1, 0.8, 1.4])
        symbol = cols[0].text_input("Symbol", value=st.session_state.get("selected_symbol", "AAPL"), key="portfolio_symbol")
        quantity = cols[1].number_input("Quantity", min_value=0.0, value=1.0, step=1.0, key="portfolio_quantity")
        avg_cost = cols[2].number_input("Average cost", min_value=0.0, value=0.0, step=1.0, key="portfolio_avg_cost")
        cost_currency = cols[3].selectbox("Cost currency", ["USD", "KRW"], index=0 if default_currency == "USD" else 1, key="portfolio_cost_currency")
        note = cols[4].text_input("Note", key="portfolio_note")
        submitted = st.form_submit_button("Save position", use_container_width=True)
    if submitted:
        upsert_position(username, symbol, quantity, avg_cost, cost_currency, note)
        st.success("Position saved.")
        st.rerun()

    remove_options = {}
    for position in portfolio:
        if not isinstance(position, dict) or not position.get("symbol"):
            continue
        raw_symbol = str(position.get("symbol"))
        cost_currency = str(position.get("cost_currency") or position.get("currency") or "USD").upper()
        remove_options[display_ticker(raw_symbol, cost_currency)] = raw_symbol
    if remove_options:
        remove_label = st.selectbox("Remove position", list(remove_options.keys()))
        if st.button("Remove selected position", use_container_width=True):
            remove_position(username, remove_options[remove_label])
            st.rerun()


def render_alert_manager(username: str, record: dict[str, object]) -> None:
    st.subheader("Price Alerts")
    alerts = record.get("alerts", [])
    alerts = alerts if isinstance(alerts, list) else []
    if alerts:
        rows = []
        for alert in alerts:
            if not isinstance(alert, dict):
                continue
            direction = "At or above" if alert.get("direction") == "above" else "At or below"
            rows.append(
                {
                    "Symbol": str(alert.get("symbol") or ""),
                    "Condition": direction,
                    "Target": format_money(alert.get("target_price")),
                    "Last Price": format_money(alert.get("last_price")),
                    "Active": "Yes" if alert.get("active", True) else "No",
                    "Triggered At": str(alert.get("last_triggered_at") or ""),
                }
            )
        st.dataframe(pd.DataFrame(rows), use_container_width=True, hide_index=True)
    else:
        st.info("No price alerts yet.")

    with st.form("price_alert_form"):
        cols = st.columns([1.3, 1, 1])
        symbol = cols[0].text_input("Alert symbol", value=st.session_state.get("selected_symbol", "AAPL"), key="alert_symbol")
        direction_label = cols[1].selectbox("Condition", ["At or above", "At or below"], key="alert_direction")
        target_price = cols[2].number_input("Target price", min_value=0.0, value=100.0, step=1.0, key="alert_target_price")
        submitted = st.form_submit_button("Add alert", use_container_width=True)
    if submitted:
        direction = "above" if direction_label == "At or above" else "below"
        add_price_alert(username, symbol, direction, target_price)
        st.success("Alert added.")
        st.rerun()

    alert_options = {
        f"{alert.get('symbol')} {alert.get('direction')} {alert.get('target_price')}": str(alert.get("id"))
        for alert in alerts
        if isinstance(alert, dict) and alert.get("id")
    }
    if alert_options:
        selected = st.selectbox("Manage alert", list(alert_options.keys()))
        cols = st.columns(2)
        if cols[0].button("Enable / Disable", use_container_width=True):
            toggle_price_alert(username, alert_options[selected])
            st.rerun()
        if cols[1].button("Delete alert", use_container_width=True):
            remove_price_alert(username, alert_options[selected])
            st.rerun()


def render_account_settings(username: str, record: dict[str, object], cookie_controller=None) -> None:
    st.subheader("Account")
    profile = record.get("profile", {}) if isinstance(record.get("profile"), dict) else {}
    with st.form("account_settings_form"):
        display_name = st.text_input("Display name", value=str(profile.get("display_name") or username), key="account_display_name")
        email = st.text_input("Email", value=str(profile.get("email") or ""), key="account_email")
        submitted = st.form_submit_button("Save account", use_container_width=True)
    if submitted:
        record["profile"] = {
            "display_name": display_name.strip() or username,
            "email": email.strip(),
        }
        save_user_record(username, record)
        st.success("Account saved.")
        st.rerun()

    if st.button("Logout", use_container_width=True):
        logout(cookie_controller)
        st.session_state.pending_page = "Login"
        st.rerun()


def render_my_page(benchmark: str, years: int, rolling_window: int, cookie_controller=None):
    st.header("My Page")
    if not require_login():
        return

    username = current_username()
    triggered_alerts = evaluate_price_alerts(username)
    render_alert_banner(triggered_alerts)

    record = get_user_record(username) or default_user_record(username)
    profile = record.get("profile", {}) if isinstance(record.get("profile"), dict) else {}
    st.caption(f"Signed in as {profile.get('display_name') or username}.")

    portfolio_tab, alerts_tab, account_tab = st.tabs(["Portfolio", "Price Alerts", "Account"])
    with portfolio_tab:
        render_portfolio_manager(username, record, benchmark, years, rolling_window)
    with alerts_tab:
        render_alert_manager(username, get_user_record(username) or record)
    with account_tab:
        render_account_settings(username, get_user_record(username) or record, cookie_controller)


def render_symbol_detail(symbol: str, benchmark: str, years: int, rolling_window: int):
    render_focus_summary(symbol, benchmark, years, rolling_window)

    overview_tab, financials_tab, prices_tab, provider_tab = st.tabs(
        ["Companies & Industries", "Financial Statements", "Price", "Realtime Provider Notes"],
        key=f"symbol_detail_tabs_{market_data_symbol(symbol)}",
        on_change="rerun",
    )

    if overview_tab.open:
        with overview_tab:
            render_metrics(symbol, benchmark, years, rolling_window)
            profile = render_profile(symbol)
            st.subheader("Sector Watchlist Candidates")
            st.caption("This is a comparable watchlist, not investment advice.")
            render_peers(symbol, profile["sector"])

    if financials_tab.open:
        with financials_tab:
            render_statements(symbol)

    if prices_tab.open:
        with prices_tab:
            render_quote_cards([symbol])

    if provider_tab.open:
        with provider_tab:
            st.markdown(
                """
                **Speed hierarchy**

                1. Direct exchange or licensed consolidated WebSocket feed: fastest and most reliable.
                2. Broker/data-vendor WebSocket APIs: practical for apps and research.
                3. REST polling and unofficial scrapers such as yfinance: convenient, but not true low-latency.

                **Recommended provider split**

                - US stocks: Alpaca IEX/SIP, Polygon, Finnhub, IEX Cloud, or a broker API.
                - Crypto: Binance, Coinbase, Kraken, or CCXT-compatible exchange APIs.
                - Fundamentals and statements: SEC companyfacts, Financial Modeling Prep, Finnhub, Polygon reference/fundamentals, or yfinance fallback.
                """
            )


def inject_styles():
    st.markdown(
        """
        <style>
        .summary-stack {
            display: flex;
            flex-direction: column;
            gap: 0;
            margin: 0;
            width: 100%;
        }
        .summary-grid {
            display: grid;
            gap: 0;
            margin: 0;
            width: 100%;
        }
        .summary-grid-4 {
            grid-template-columns: repeat(4, minmax(0, 1fr));
        }
        .summary-grid-3 {
            grid-template-columns: repeat(3, minmax(0, 1fr));
        }
        .summary-card {
            border: 1px solid #e5e7eb;
            border-radius: 0;
            padding: 18px 26px 16px;
            height: 112px;
            background: #ffffff;
            box-sizing: border-box;
            display: flex;
            flex-direction: column;
            justify-content: flex-start;
            min-width: 0;
        }
        .summary-card.large {
            height: 138px;
            padding-top: 22px;
        }
        .summary-label {
            color: #6b7280;
            font-size: 0.78rem;
            font-weight: 700;
            letter-spacing: 0;
            line-height: 1.2;
            margin-bottom: 18px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            text-align: left;
            width: 100%;
        }
        .summary-value-row {
            display: flex;
            align-items: flex-end;
            justify-content: flex-end;
            gap: 12px;
            min-width: 0;
            width: 100%;
            overflow: hidden;
            min-height: 2.15rem;
        }
        .summary-value {
            color: #111827;
            font-size: 1.35rem;
            font-weight: 750;
            letter-spacing: 0;
            line-height: 1.15;
            overflow-wrap: anywhere;
            text-align: right;
            min-width: 0;
        }
        .summary-value.large {
            font-size: clamp(1.45rem, 2vw, 2.05rem);
            line-height: 1.05;
        }
        .summary-delta {
            margin-top: 6px;
            font-size: 0.95rem;
            font-weight: 700;
            line-height: 1;
            white-space: nowrap;
            width: 100%;
            text-align: right;
        }
        .summary-delta.positive {
            color: #15803d;
        }
        .summary-delta.negative {
            color: #dc2626;
        }
        .summary-delta.neutral {
            color: #6b7280;
        }
        .portfolio-mini-card {
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            padding: 14px 14px;
            margin-bottom: 10px;
            background: #ffffff;
        }
        .portfolio-mini-card.compact {
            padding: 10px 12px;
            margin-bottom: 8px;
        }
        .portfolio-mini-label {
            color: #6b7280;
            font-size: 0.78rem;
            font-weight: 700;
            line-height: 1.2;
            margin-bottom: 8px;
        }
        .portfolio-mini-value {
            color: #111827;
            font-size: clamp(1.05rem, 1.4vw, 1.25rem);
            font-weight: 800;
            line-height: 1.1;
            text-align: right;
            overflow-wrap: anywhere;
            font-variant-numeric: tabular-nums;
        }
        .portfolio-mini-card.compact .portfolio-mini-value {
            font-size: 1.02rem;
        }
        .portfolio-mini-value.positive {
            color: #dc2626;
        }
        .portfolio-mini-value.negative {
            color: #2563eb;
        }
        .portfolio-mini-value.neutral {
            color: #111827;
        }
        .portfolio-update-action-spacer {
            height: 1.55rem;
        }
        .allocation-legend {
            display: flex;
            flex-direction: column;
            gap: 8px;
            padding-top: 42px;
            width: 100%;
        }
        .allocation-legend-item {
            align-items: center;
            display: flex;
            gap: 8px;
            min-width: 0;
        }
        .allocation-legend-swatch {
            border-radius: 999px;
            flex: 0 0 14px;
            height: 14px;
            width: 14px;
        }
        .allocation-legend-label {
            color: #6b7280;
            font-size: 0.8rem;
            line-height: 1.15;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .macro-table-wrap {
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            overflow-x: auto;
            width: 100%;
            margin-top: 0.5rem;
        }
        .macro-table {
            border-collapse: collapse;
            table-layout: fixed;
            width: 100%;
            font-size: 0.94rem;
        }
        .macro-table thead th {
            background: #f8fafc;
            color: #6b7280;
            font-weight: 500;
            text-align: left;
        }
        .macro-table th,
        .macro-table td {
            border-bottom: 1px solid #e5e7eb;
            border-right: 1px solid #e5e7eb;
            padding: 10px 10px;
            white-space: nowrap;
        }
        .macro-table th:last-child,
        .macro-table td:last-child {
            border-right: 0;
        }
        .macro-table tbody tr:last-child td {
            border-bottom: 0;
        }
        .macro-table .macro-table-number {
            font-variant-numeric: tabular-nums;
            text-align: right !important;
        }
        .macro-table .macro-col-country {
            width: 18%;
        }
        .macro-table .macro-col-policy {
            width: 12%;
        }
        .macro-table .macro-col-standard {
            width: 17.5%;
        }
        .financial-table-wrap {
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            overflow-x: auto;
            width: 100%;
            margin-top: 0.5rem;
        }
        .financial-grid-wrap {
            border: 1px solid #d8dee8;
            border-radius: 8px;
            overflow-x: auto;
            width: 100%;
            margin-top: 0.5rem;
            background: #ffffff;
        }
        .financial-grid {
            min-width: 920px;
            width: 100%;
        }
        .financial-grid-row {
            display: grid;
            grid-template-columns: var(--financial-grid-template);
            align-items: stretch;
            min-height: 42px;
        }
        .financial-grid-cell {
            border-bottom: 1px solid #e5e7eb;
            border-right: 1px solid #e5e7eb;
            color: #111827;
            font-size: 0.92rem;
            font-variant-numeric: tabular-nums;
            padding: 10px 12px;
            text-align: right;
            white-space: nowrap;
        }
        .financial-grid-cell:last-child {
            border-right: 0;
        }
        .financial-grid-label {
            color: #374151;
            font-weight: 600;
            text-align: left;
        }
        .financial-grid-label.level-1 {
            padding-left: 28px;
        }
        .financial-grid-label.level-2 {
            padding-left: 48px;
            font-weight: 500;
        }
        .financial-grid-label.muted,
        .financial-grid-cell.muted {
            color: #9ca3af;
            font-style: italic;
        }
        .financial-grid-header .financial-grid-cell {
            background: #f8fafc;
            color: #6b7280;
            font-weight: 700;
        }
        .financial-detail {
            margin: 0;
        }
        .financial-detail > summary {
            cursor: pointer;
            display: block;
            list-style: none;
        }
        .financial-detail > summary::-webkit-details-marker {
            display: none;
        }
        .financial-detail > summary .financial-grid-label::before {
            color: #64748b;
            content: "▸";
            display: inline-block;
            margin-right: 8px;
            transition: transform 0.12s ease;
        }
        .financial-detail[open] > summary .financial-grid-label::before {
            transform: rotate(90deg);
        }
        .financial-summary-row .financial-grid-cell {
            background: #fbfdff;
            font-weight: 700;
        }
        .financial-detail-body {
            margin: 0;
        }
        .financial-grand-total > summary .financial-grid-cell,
        .financial-result-row .financial-grid-cell,
        .financial-grand-income .financial-grid-cell {
            background: #eaf2ff;
            color: #0f172a;
            font-weight: 850;
        }
        .financial-grand-total.asset-total > summary .financial-grid-cell {
            border-top: 2px solid #2563eb;
        }
        .financial-grand-total.liability-total > summary .financial-grid-cell {
            border-top: 2px solid #dc2626;
        }
        .financial-grand-total.equity-total > summary .financial-grid-cell {
            border-top: 2px solid #16a34a;
        }
        .financial-expense-row .financial-grid-cell,
        .financial-expense-group > summary .financial-grid-cell {
            background: #fff7ed;
        }
        .financial-table {
            border-collapse: collapse;
            table-layout: fixed;
            width: 100%;
            min-width: 860px;
            font-size: 0.93rem;
        }
        .financial-table thead th {
            background: #f8fafc;
            color: #6b7280;
            font-weight: 650;
            text-align: right !important;
        }
        .financial-table thead th:first-child {
            text-align: left !important;
            width: 34%;
        }
        .financial-table th,
        .financial-table td {
            border-bottom: 1px solid #e5e7eb;
            border-right: 1px solid #e5e7eb;
            padding: 10px 12px;
            white-space: nowrap;
        }
        .financial-table th:last-child,
        .financial-table td:last-child {
            border-right: 0;
        }
        .financial-table tbody tr:last-child td {
            border-bottom: 0;
        }
        .financial-table tbody td {
            font-variant-numeric: tabular-nums;
            text-align: right !important;
        }
        .financial-table tbody td:first-child {
            color: #374151;
            font-weight: 600;
            text-align: left !important;
        }
        .financial-ratio-wrap {
            max-width: 820px;
        }
        .financial-ratio-table {
            min-width: 620px;
        }
        @media (prefers-color-scheme: dark) {
            .financial-grid-wrap,
            .financial-table-wrap {
                background: #0f172a;
                border-color: #334155;
            }
            .financial-grid-cell,
            .financial-table th,
            .financial-table td {
                border-color: #334155;
                color: #e5e7eb;
            }
            .financial-grid-label,
            .financial-table tbody td:first-child {
                color: #f8fafc;
            }
            .financial-grid-header .financial-grid-cell,
            .financial-table thead th {
                background: #1e293b;
                color: #cbd5e1;
            }
            .financial-summary-row .financial-grid-cell {
                background: #111827;
            }
            .financial-grand-total > summary .financial-grid-cell,
            .financial-result-row .financial-grid-cell,
            .financial-grand-income .financial-grid-cell {
                background: rgba(37, 99, 235, 0.24);
                color: #f8fafc;
            }
            .financial-expense-row .financial-grid-cell,
            .financial-expense-group > summary .financial-grid-cell {
                background: rgba(234, 88, 12, 0.16);
            }
        }
        .metrics-table-wrap {
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            overflow-x: auto;
            width: 100%;
            margin-top: 0.5rem;
        }
        .metrics-table {
            border-collapse: collapse;
            table-layout: fixed;
            width: 100%;
            font-size: 0.94rem;
        }
        .metrics-table thead th {
            background: #f8fafc;
            color: #6b7280;
            font-weight: 500;
            text-align: center !important;
        }
        .metrics-table th,
        .metrics-table td {
            border-bottom: 1px solid #e5e7eb;
            border-right: 1px solid #e5e7eb;
            padding: 10px 10px;
            white-space: nowrap;
        }
        .metrics-table th:last-child,
        .metrics-table td:last-child {
            border-right: 0;
        }
        .metrics-table tbody tr:last-child th,
        .metrics-table tbody tr:last-child td {
            border-bottom: 0;
        }
        .metrics-table tbody th {
            color: #6b7280;
            font-weight: 400;
            text-align: right !important;
        }
        .metrics-table tbody td:nth-child(2),
        .metrics-table tbody td:nth-child(3),
        .metrics-table tbody td:nth-child(4) {
            text-align: center !important;
        }
        .metrics-table tbody td:nth-child(n+5) {
            font-variant-numeric: tabular-nums;
            text-align: right !important;
        }
        .metrics-table thead th:nth-child(1) {
            width: 4%;
        }
        .metrics-table thead th:nth-child(2),
        .metrics-table thead th:nth-child(3) {
            width: 7%;
        }
        .metrics-table thead th:nth-child(4) {
            width: 8.5%;
        }
        .metrics-table thead th:nth-child(n+5) {
            width: 14.7%;
        }
        @media (max-width: 1024px) {
            .block-container {
                padding-left: 1rem;
                padding-right: 1rem;
                padding-top: 1.25rem;
            }
            .summary-grid-4 {
                grid-template-columns: repeat(2, minmax(0, 1fr));
            }
            .summary-grid-3 {
                grid-template-columns: repeat(3, minmax(0, 1fr));
            }
            .summary-card,
            .summary-card.large {
                height: auto;
                min-height: 112px;
                padding: 16px 18px 14px;
            }
            .summary-label {
                margin-bottom: 14px;
            }
            .summary-value.large {
                font-size: clamp(1.35rem, 4vw, 1.85rem);
            }
            .macro-table {
                min-width: 760px;
            }
            .financial-table {
                min-width: 820px;
            }
            .financial-grid {
                min-width: 900px;
            }
            .metrics-table {
                min-width: 980px;
            }
            div[data-testid="stTabs"] [data-baseweb="tab-list"] {
                overflow-x: auto;
                white-space: nowrap;
            }
        }
        @media (max-width: 720px) {
            h1 {
                font-size: 1.75rem;
            }
            h2, h3 {
                font-size: 1.18rem;
            }
            .summary-grid-4,
            .summary-grid-3 {
                grid-template-columns: 1fr;
            }
            .summary-card,
            .summary-card.large {
                min-height: 96px;
                padding: 14px 14px 12px;
            }
            .summary-label {
                white-space: normal;
            }
            .summary-value-row {
                min-height: 1.8rem;
            }
            .summary-value,
            .summary-value.large {
                font-size: 1.35rem;
            }
            .summary-delta {
                font-size: 0.9rem;
            }
            .macro-table th,
            .macro-table td,
            .financial-table th,
            .financial-table td,
            .financial-grid-cell,
            .metrics-table th,
            .metrics-table td {
                padding: 8px 8px;
                font-size: 0.84rem;
            }
            div[data-testid="stHorizontalBlock"] {
                flex-wrap: wrap;
            }
            div[data-testid="stHorizontalBlock"] > div {
                min-width: 100% !important;
            }
            div[data-testid="stMetricValue"] {
                font-size: 1.35rem;
            }
        }
        </style>
        """,
        unsafe_allow_html=True,
    )


def render_top_navigation() -> str:
    if "pending_page" in st.session_state:
        st.session_state.page_selector = st.session_state.pop("pending_page")
    if st.session_state.get("page_selector") not in PAGE_OPTIONS:
        st.session_state.page_selector = PAGE_OPTIONS[0]

    page = st.pills("Page", PAGE_OPTIONS, key="page_selector", label_visibility="collapsed")
    return str(page or st.session_state.page_selector)


def main():
    st.set_page_config(page_title="My Financial Portfolio", layout="wide")
    inject_styles()
    cookie_controller = create_cookie_controller()
    restore_remembered_login(cookie_controller)
    emit_auth_cookie_scripts(cookie_controller)
    page = render_top_navigation()
    st.title("My Financial Portfolio")

    with st.sidebar:
        render_sidebar_auth_panel(cookie_controller)
        st.divider()
        st.header("Search")
        focus_symbol = render_symbol_search("AAPL")
        benchmark = st.text_input("Benchmark", value="SPY")
        years = st.slider("History window in years", min_value=1, max_value=20, value=20)
        rolling_window = st.slider("Rolling beta window in months", min_value=6, max_value=60, value=36)
        refresh_seconds = st.slider("Quote refresh seconds", min_value=5, max_value=120, value=20)
        auto_refresh = st.toggle("Auto refresh quotes", value=False)

    if auto_refresh:
        try:
            from streamlit_autorefresh import st_autorefresh

            st_autorefresh(interval=refresh_seconds * 1000, key="quote_refresh")
        except Exception:
            st.info("Auto refresh package is unavailable. Use the browser refresh button.")

    if page == "My Page":
        render_my_page(benchmark, years, rolling_window, cookie_controller)
    elif page in PAGE_CONFIG:
        render_market_main(PAGE_CONFIG[page])
    else:
        render_symbol_detail(focus_symbol, benchmark, years, rolling_window)


if __name__ == "__main__":
    main()
