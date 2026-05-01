from __future__ import annotations

import argparse
import asyncio
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import websockets


DEFAULT_CRYPTO_SYMBOLS = [
    "BTC-USD",
    "ETH-USD",
    "XRP-USD",
    "BNB-USD",
    "SOL-USD",
    "DOGE-USD",
    "TRX-USD",
    "ADA-USD",
    "XLM-USD",
    "SUI-USD",
    "HBAR-USD",
    "LINK-USD",
    "AVAX-USD",
    "BCH-USD",
    "LTC-USD",
    "DOT-USD",
    "SHIB-USD",
    "UNI-USD",
    "PEPE-USD",
    "AAVE-USD",
    "ONDO-USD",
    "NEAR-USD",
    "ETC-USD",
    "APT-USD",
    "POL-USD",
    "FIL-USD",
    "ALGO-USD",
    "ARB-USD",
]

UPBIT_MARKET_URL = "https://api.upbit.com/v1/market/all?isDetails=false"
UPBIT_WEBSOCKET_URL = "wss://api.upbit.com/websocket/v1"
SUPABASE_MARKET_QUOTE_TABLE = "market_quote_cache"


def ignore_dead_local_proxy() -> None:
    for key in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
        if os.environ.get(key) == "http://127.0.0.1:9":
            os.environ.pop(key, None)


ignore_dead_local_proxy()


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def read_streamlit_secrets() -> dict[str, object]:
    secrets_path = Path(".streamlit") / "secrets.toml"
    if not secrets_path.exists():
        return {}
    try:
        import tomllib
    except Exception:
        return {}
    try:
        return tomllib.loads(secrets_path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def config_value(name: str, *fallback_names: str) -> str:
    names = (name, *fallback_names)
    for key in names:
        value = os.environ.get(key, "")
        if value:
            return value.strip()

    secrets = read_streamlit_secrets()
    for key in names:
        value = secrets.get(key, "")
        if value:
            return str(value).strip()

    supabase = secrets.get("supabase", {})
    if hasattr(supabase, "get"):
        for key in names:
            for candidate in {key, key.lower(), key.replace("SUPABASE_", "").lower()}:
                value = supabase.get(candidate, "")
                if value:
                    return str(value).strip()
    return ""


def supabase_config() -> tuple[str, str]:
    return (
        config_value("SUPABASE_URL").rstrip("/"),
        config_value("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_KEY"),
    )


def supabase_upsert(rows: list[dict[str, object]]) -> None:
    if not rows:
        return
    url, key = supabase_config()
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.")

    request = urllib.request.Request(
        f"{url}/rest/v1/{SUPABASE_MARKET_QUOTE_TABLE}",
        data=json.dumps(rows, ensure_ascii=False).encode("utf-8"),
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            response.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Supabase upsert failed ({exc.code}): {detail}") from exc


def fetch_json(url: str) -> object:
    request = urllib.request.Request(
        url,
        headers={"accept": "application/json", "User-Agent": "portfolio-price-worker/1.0"},
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))


def crypto_base_symbol(symbol: str) -> str:
    symbol = symbol.strip().upper()
    if "-" in symbol:
        return symbol.split("-", 1)[0]
    return symbol


def app_symbol_from_upbit_market(market: str) -> str:
    return f"{market.split('-', 1)[1].upper()}-USD"


def upbit_market_for_symbol(symbol: str) -> str:
    return f"KRW-{crypto_base_symbol(symbol)}"


def discover_upbit_markets(symbols: list[str]) -> list[str]:
    requested = {upbit_market_for_symbol(symbol) for symbol in symbols}
    data = fetch_json(UPBIT_MARKET_URL)
    if not isinstance(data, list):
        return sorted(requested)
    supported = {
        str(item.get("market") or "").upper()
        for item in data
        if isinstance(item, dict) and str(item.get("market") or "").upper().startswith("KRW-")
    }
    return sorted(requested & supported)


def row_from_upbit_ticker(message: dict[str, object]) -> dict[str, object] | None:
    market = str(message.get("code") or "").upper()
    if not market.startswith("KRW-"):
        return None

    price = message.get("trade_price")
    previous_close = message.get("prev_closing_price")
    signed_change_rate = message.get("signed_change_rate")
    change_pct = None
    try:
        if signed_change_rate is not None:
            change_pct = float(signed_change_rate) * 100
    except (TypeError, ValueError):
        change_pct = None

    return {
        "symbol": app_symbol_from_upbit_market(market),
        "provider_symbol": market,
        "price": price,
        "previous_close": previous_close,
        "change_pct": change_pct,
        "currency": "KRW",
        "exchange": "Upbit WebSocket",
        "source": "upbit_ws",
        "payload": message,
        "updated_at": utc_now_iso(),
    }


async def flush_quotes(latest_rows: dict[str, dict[str, object]], interval: float) -> None:
    while True:
        await asyncio.sleep(interval)
        if not latest_rows:
            continue
        rows = list(latest_rows.values())
        latest_rows.clear()
        supabase_upsert(rows)
        print(f"{utc_now_iso()} upserted {len(rows)} quotes", flush=True)


async def stream_upbit(markets: list[str], flush_interval: float, reconnect_delay: float) -> None:
    latest_rows: dict[str, dict[str, object]] = {}
    flush_task = asyncio.create_task(flush_quotes(latest_rows, flush_interval))
    try:
        while True:
            try:
                async with websockets.connect(UPBIT_WEBSOCKET_URL, ping_interval=20, ping_timeout=20, proxy=None) as websocket:
                    subscribe_message = [
                        {"ticket": "myfinancialportfolio-market-cache"},
                        {"type": "ticker", "codes": markets},
                    ]
                    await websocket.send(json.dumps(subscribe_message))
                    print(f"{utc_now_iso()} subscribed to {', '.join(markets)}", flush=True)
                    async for raw_message in websocket:
                        if isinstance(raw_message, bytes):
                            raw_message = raw_message.decode("utf-8")
                        message = json.loads(raw_message)
                        if isinstance(message, dict):
                            row = row_from_upbit_ticker(message)
                            if row:
                                latest_rows[str(row["symbol"])] = row
            except Exception as exc:
                print(f"{utc_now_iso()} websocket error: {exc}", flush=True)
                await asyncio.sleep(reconnect_delay)
    finally:
        flush_task.cancel()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Stream Upbit crypto quotes into Supabase.")
    parser.add_argument("--symbols", nargs="*", default=DEFAULT_CRYPTO_SYMBOLS, help="App symbols such as BTC-USD ETH-USD.")
    parser.add_argument("--flush-interval", type=float, default=1.5, help="Seconds between Supabase quote upserts.")
    parser.add_argument("--reconnect-delay", type=float, default=5.0, help="Seconds to wait before reconnecting.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    markets = discover_upbit_markets(args.symbols)
    if not markets:
        raise SystemExit("No requested symbols are supported by Upbit KRW markets.")
    asyncio.run(stream_upbit(markets, args.flush_interval, args.reconnect_delay))


if __name__ == "__main__":
    main()
