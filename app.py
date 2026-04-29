from __future__ import annotations

import hashlib
import json
import math
import os
import secrets
import html as html_lib
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

import altair as alt
import pandas as pd
import streamlit as st

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
CRYPTO_UNIVERSE = ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "BNB-USD", "ADA-USD", "DOGE-USD"]
CRYPTO_UNIVERSE = [
    "BTC-USD",
    "ETH-USD",
    "USDT-USD",
    "XRP-USD",
    "BNB-USD",
    "SOL-USD",
    "USDC-USD",
    "DOGE-USD",
    "TRX-USD",
    "ADA-USD",
    "LINK-USD",
    "AVAX-USD",
    "XLM-USD",
    "BCH-USD",
    "HBAR-USD",
    "LTC-USD",
    "DOT-USD",
    "BGB-USD",
    "XMR-USD",
    "UNI-USD",
    "DAI-USD",
    "PEPE-USD",
    "APT-USD",
    "NEAR-USD",
    "ICP-USD",
    "ETC-USD",
    "ONDO-USD",
    "AAVE-USD",
    "ARB-USD",
    "POL-USD",
    "VET-USD",
    "ATOM-USD",
    "FIL-USD",
    "RENDER-USD",
    "ALGO-USD",
    "KAS-USD",
    "FET-USD",
    "OP-USD",
    "WLD-USD",
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
    "crypto": ["BTC-USD", "ETH-USD", "SOL-USD", "BNB-USD"],
    "us": ["^GSPC", "^IXIC", "^DJI", "^RUT", "^VIX"],
    "korea": ["^KS11", "^KQ11", "005930.KS", "000660.KS"],
}

PAGE_CONFIG = {
    "Coin Main": {
        "market": "crypto",
        "title": "Coin Main",
        "representative": "BTC-USD",
        "representative_name": "Bitcoin (BTC-USD)",
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

PAGE_OPTIONS = ["Coin Main", "US Stock Main", "Korea Stock Main", "Symbol Detail", "Login", "My Page"]

APP_DATA_DIR = Path(os.environ.get("PORTFOLIO_USER_DATA_DIR", "user_data"))
USER_STORE_PATH = APP_DATA_DIR / "users.json"
PASSWORD_HASH_ITERATIONS = 200_000

SYMBOL_LABELS = {
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
}
CRYPTO_QUOTE_SYMBOLS = {"USD", "USDT", "USDC", "KRW", "EUR", "JPY", "BTC", "ETH"}


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
            symbols.append(f"{token}-USD")
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


def display_symbol(symbol: str) -> str:
    label = SYMBOL_LABELS.get(symbol)
    return f"{label} ({symbol})" if label else symbol


def is_crypto_symbol(symbol: str) -> bool:
    return symbol in CRYPTO_UNIVERSE or symbol.endswith("-USD")


def is_korea_symbol(symbol: str) -> bool:
    return symbol.endswith(".KS") or symbol.endswith(".KQ") or symbol in {"^KS11", "^KQ11"}


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


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
    }


def load_user_store() -> dict[str, object]:
    if not USER_STORE_PATH.exists():
        return {"users": {}}
    try:
        return json.loads(USER_STORE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {"users": {}}


def save_user_store(store: dict[str, object]) -> None:
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


def current_username() -> str:
    return str(st.session_state.get("auth_user") or "")


def is_logged_in() -> bool:
    return bool(current_username())


def save_user_record(username: str, record: dict[str, object]) -> None:
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


def logout() -> None:
    st.session_state.pop("auth_user", None)


@st.cache_data(ttl=3600)
def search_symbols(query: str, limit: int = 30) -> list[str]:
    normalized_query = query.strip().upper().replace("/", "-")
    if not normalized_query:
        return MARKET_UNIVERSE[:limit]

    searchable_universe = sorted(set(MARKET_UNIVERSE + KOREA_UNIVERSE + ["^GSPC", "^IXIC", "^DJI", "^KS11", "^KQ11"]))
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


@st.cache_data(ttl=20)
def get_quote(symbol: str) -> dict[str, object]:
    ticker = yf.Ticker(symbol)
    info = {}
    try:
        info = ticker.info or {}
    except Exception:
        info = {}

    price = None
    previous_close = None
    currency = info.get("currency") or ""
    exchange = info.get("exchange") or info.get("fullExchangeName") or ""

    try:
        fast = ticker.fast_info
        price = safe_number(fast.get("last_price") or fast.get("regular_market_price"))
        previous_close = safe_number(fast.get("previous_close"))
        currency = currency or fast.get("currency") or ""
        exchange = exchange or fast.get("exchange") or ""
    except Exception:
        pass

    if symbol.endswith("-USD"):
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

    if previous_close is None:
        previous_close = safe_number(info.get("previousClose") or info.get("regularMarketPreviousClose"))

    return {
        "symbol": symbol,
        "price": price,
        "previous_close": previous_close,
        "change_pct": pct_change(price, previous_close),
        "currency": currency,
        "exchange": exchange,
        "timestamp_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


def portfolio_market_rows(portfolio: list[dict[str, object]]) -> list[dict[str, object]]:
    rows = []
    for position in portfolio:
        symbol = str(position.get("symbol") or "").upper()
        if not symbol:
            continue
        quantity = safe_number(position.get("quantity")) or 0
        avg_cost = safe_number(position.get("avg_cost")) or 0
        quote = get_quote(symbol)
        price = safe_number(quote.get("price"))
        market_value = price * quantity if price is not None else None
        cost_basis = avg_cost * quantity
        gain_loss = market_value - cost_basis if market_value is not None else None
        gain_loss_pct = pct_change(market_value, cost_basis) if market_value is not None and cost_basis else None
        rows.append(
            {
                "Symbol": symbol,
                "Quantity": quantity,
                "Avg Cost": format_money(avg_cost, str(quote.get("currency") or "")),
                "Current Price": format_money(price, str(quote.get("currency") or "")),
                "Market Value": format_money(market_value, str(quote.get("currency") or "")),
                "Gain/Loss": format_money(gain_loss, str(quote.get("currency") or "")),
                "Gain/Loss %": format_pct(gain_loss_pct),
                "Note": str(position.get("note") or ""),
            }
        )
    return rows


def upsert_position(username: str, symbol: str, quantity: float, avg_cost: float, note: str) -> None:
    record = get_user_record(username) or default_user_record(username)
    portfolio = record.setdefault("portfolio", [])
    if not isinstance(portfolio, list):
        portfolio = []
        record["portfolio"] = portfolio
    symbol = normalize_symbol(symbol) or symbol.strip().upper()
    updated = False
    for position in portfolio:
        if isinstance(position, dict) and position.get("symbol") == symbol:
            position.update(
                {
                    "quantity": quantity,
                    "avg_cost": avg_cost,
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
def get_profile(symbol: str) -> dict[str, object]:
    ticker = yf.Ticker(symbol)
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

    fallback = PROFILE_FALLBACKS.get(symbol.upper(), {})

    def sector_from_watchlist() -> str:
        upper_symbol = symbol.upper()
        for sector_name, candidates in SECTOR_WATCHLISTS.items():
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
        "name": profile_value("longName", "shortName", fallback_key="name") or symbol,
        "sector": sector,
        "industry": industry,
        "country": profile_value("country") or ("United States" if sector else ""),
        "website": profile_value("website"),
        "summary": profile_value("longBusinessSummary", fallback_key="summary"),
    }


@st.cache_data(ttl=3600)
def get_statement(symbol: str, statement_type: str) -> pd.DataFrame:
    ticker = yf.Ticker(symbol)
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


@st.cache_data(ttl=1800)
def get_metrics(symbol: str, benchmark: str, years: int, rolling_window: int) -> pd.DataFrame:
    return monthly_metrics(symbol, MetricConfig(years=years, benchmark=benchmark, rolling_window=rolling_window))


@st.cache_data(ttl=60)
def get_market_snapshot(symbols: tuple[str, ...]) -> pd.DataFrame:
    rows = []
    try:
        history = yf.download(
            list(symbols),
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

    for symbol in symbols:
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
    settings = {
        "1W": ("7d", "1h"),
        "1M": ("1mo", "4h"),
        "1Y": ("1y", "1d"),
        "YTD": ("ytd", "1d"),
    }
    period, interval = settings.get(window, settings["1M"])
    history = yf.Ticker(symbol).history(period=period, interval=interval, auto_adjust=False, actions=False)
    if history.empty:
        return pd.DataFrame()
    history = history.reset_index()
    date_column = "Datetime" if "Datetime" in history else "Date"
    history["date"] = pd.to_datetime(history[date_column]).dt.tz_localize(None)
    return history[["date", "Open", "High", "Low", "Close", "Volume"]].dropna(subset=["Open", "High", "Low", "Close"])


@st.cache_data(ttl=120)
def get_representative_chart(symbol: str, window: str) -> pd.DataFrame:
    settings = {
        "1D": ("1d", "5m"),
        "1W": ("7d", "30m"),
        "1M": ("1mo", "1d"),
        "1Y": ("1y", "1d"),
    }
    period, interval = settings.get(window, settings["1D"])
    history = yf.Ticker(symbol).history(period=period, interval=interval, auto_adjust=True, actions=False)
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
    prefix = "$" if currency == "USD" else ""
    suffix = " KRW" if currency == "KRW" else (f" {currency}" if currency not in {"", "USD"} else "")
    return f"{prefix}{value:,.2f}{suffix}".strip()


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
    prefix = "$" if currency == "USD" else ""
    suffix = "B KRW" if currency == "KRW" else ("B" if currency == "USD" else f"B {currency}".strip())
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


def render_focus_summary(symbol: str, benchmark: str, years: int, rolling_window: int):
    benchmark = benchmark.upper()
    quote = get_quote(symbol)
    metric_summary = summary_metrics(symbol, benchmark, years, rolling_window)
    capm = capm_snapshot(symbol, benchmark, years, rolling_window, quote)
    comparisons = comparison_metrics(symbol, benchmark, years, rolling_window)

    st.subheader(display_symbol(symbol))
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
                label=f"{symbol} {quote['currency']}",
                value=format_money(quote["price"]),
                delta=format_pct(quote["change_pct"]),
                help=f"Previous close: {format_money(quote['previous_close'])}\nExchange: {quote['exchange']}\nUTC: {quote['timestamp_utc']}",
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
            lambda row: ["background-color: #fff3bf; font-weight: 700" if name == column else "" for name in row.index],
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
        st.info(f"{symbol} price bar data is unavailable.")
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
            alt.Tooltip("Open:Q", format=",.2f"),
            alt.Tooltip("High:Q", format=",.2f"),
            alt.Tooltip("Low:Q", format=",.2f"),
            alt.Tooltip("Close:Q", format=",.2f"),
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
        st.info(f"{symbol} chart data is unavailable.")
        return

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
                alt.Tooltip("Close:Q", title="Close", format=",.2f"),
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
        col.metric(display_symbol(symbol), format_money(quote["price"], quote["currency"]), format_pct(quote["change_pct"]))


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

    st.subheader(f"{symbol} Monthly Metrics")
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
            "Symbol": display_table["symbol"],
            "Benchmark": display_table["benchmark"],
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
    tabs = st.tabs(["Financial Position", "Income", "Cashflow"])
    for tab, statement_type in zip(tabs, ["balance", "income", "cashflow"]):
        with tab:
            statement = get_statement(symbol, statement_type)
            st.subheader(labels[statement_type])
            if statement.empty:
                st.info("No statement data was returned for this symbol.")
            else:
                st.dataframe(statement, use_container_width=True)


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


def render_login_page():
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
            logout()
            st.rerun()
        return

    login_tab, create_tab = st.tabs(["Login", "Create Account"])
    with login_tab:
        with st.form("login_form"):
            username = st.text_input("Username", key="login_username")
            password = st.text_input("Password", type="password", key="login_password")
            submitted = st.form_submit_button("Login", use_container_width=True)
        if submitted:
            ok, message = authenticate(username, password)
            if ok:
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
            submitted = st.form_submit_button("Create account", use_container_width=True)
        if submitted:
            if new_password != confirm_password:
                st.error("Passwords do not match.")
            else:
                ok, message = create_account(new_username, new_password, display_name, email)
                if ok:
                    authenticate(new_username, new_password)
                    st.success(message)
                    st.session_state.pending_page = "My Page"
                    st.rerun()
                else:
                    st.error(message)


def require_login() -> bool:
    if is_logged_in():
        return True
    st.info("Login is required to use My Page.")
    if st.button("Go to Login", use_container_width=True):
        st.session_state.pending_page = "Login"
        st.rerun()
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


def render_portfolio_manager(username: str, record: dict[str, object]) -> None:
    st.subheader("Portfolio")
    portfolio = record.get("portfolio", [])
    portfolio = portfolio if isinstance(portfolio, list) else []
    rows = portfolio_market_rows(portfolio)
    if rows:
        st.dataframe(pd.DataFrame(rows), use_container_width=True, hide_index=True)
    else:
        st.info("No portfolio positions yet.")

    with st.form("portfolio_position_form"):
        cols = st.columns([1.3, 1, 1, 1.4])
        symbol = cols[0].text_input("Symbol", value=st.session_state.get("selected_symbol", "AAPL"), key="portfolio_symbol")
        quantity = cols[1].number_input("Quantity", min_value=0.0, value=1.0, step=1.0, key="portfolio_quantity")
        avg_cost = cols[2].number_input("Average cost", min_value=0.0, value=0.0, step=1.0, key="portfolio_avg_cost")
        note = cols[3].text_input("Note", key="portfolio_note")
        submitted = st.form_submit_button("Save position", use_container_width=True)
    if submitted:
        upsert_position(username, symbol, quantity, avg_cost, note)
        st.success("Position saved.")
        st.rerun()

    symbols = [str(position.get("symbol")) for position in portfolio if isinstance(position, dict) and position.get("symbol")]
    if symbols:
        remove_symbol = st.selectbox("Remove position", symbols)
        if st.button("Remove selected position", use_container_width=True):
            remove_position(username, remove_symbol)
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


def render_account_settings(username: str, record: dict[str, object]) -> None:
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
        logout()
        st.session_state.pending_page = "Login"
        st.rerun()


def render_my_page():
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
        render_portfolio_manager(username, record)
    with alerts_tab:
        render_alert_manager(username, get_user_record(username) or record)
    with account_tab:
        render_account_settings(username, get_user_record(username) or record)


def render_symbol_detail(symbol: str, benchmark: str, years: int, rolling_window: int):
    render_focus_summary(symbol, benchmark, years, rolling_window)
    render_metrics(symbol, benchmark, years, rolling_window)

    overview_tab, financials_tab, prices_tab, provider_tab = st.tabs(
        ["Companies & Industries", "Financial Statements", "Price", "Realtime Provider Notes"]
    )

    with overview_tab:
        profile = render_profile(symbol)
        st.subheader("Sector Watchlist Candidates")
        st.caption("This is a comparable watchlist, not investment advice.")
        render_peers(symbol, profile["sector"])

    with financials_tab:
        render_statements(symbol)

    with prices_tab:
        render_quote_cards([symbol])

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
    page = render_top_navigation()
    st.title("My Financial Portfolio")

    with st.sidebar:
        st.header("Search")
        focus_symbol = render_symbol_search("AAPL")
        benchmark = st.text_input("Benchmark", value="SPY")
        years = st.slider("History window in years", min_value=1, max_value=20, value=20)
        rolling_window = st.slider("Rolling beta window in months", min_value=6, max_value=60, value=36)
        refresh_seconds = st.slider("Quote refresh seconds", min_value=5, max_value=120, value=20)
        auto_refresh = st.toggle("Auto refresh quotes", value=False)
        st.divider()
        if is_logged_in():
            record = get_user_record() or {}
            profile = record.get("profile", {}) if isinstance(record.get("profile"), dict) else {}
            st.caption(f"Logged in: {profile.get('display_name') or current_username()}")
            if st.button("My Page", use_container_width=True):
                st.session_state.pending_page = "My Page"
                st.rerun()
        else:
            if st.button("Login", use_container_width=True):
                st.session_state.pending_page = "Login"
                st.rerun()

    if auto_refresh:
        try:
            from streamlit_autorefresh import st_autorefresh

            st_autorefresh(interval=refresh_seconds * 1000, key="quote_refresh")
        except Exception:
            st.info("Auto refresh package is unavailable. Use the browser refresh button.")

    if page == "Login":
        render_login_page()
    elif page == "My Page":
        render_my_page()
    elif page in PAGE_CONFIG:
        render_market_main(PAGE_CONFIG[page])
    else:
        render_symbol_detail(focus_symbol, benchmark, years, rolling_window)


if __name__ == "__main__":
    main()
