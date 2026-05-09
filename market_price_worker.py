from __future__ import annotations

import argparse
import asyncio
import json
import os
import threading
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import websockets


DEFAULT_CRYPTO_SYMBOLS = [
    "BTC-KRW",
    "ETH-KRW",
    "XRP-KRW",
    "BNB-KRW",
    "SOL-KRW",
    "DOGE-KRW",
    "TRX-KRW",
    "ADA-KRW",
    "XLM-KRW",
    "SUI-KRW",
    "HBAR-KRW",
    "LINK-KRW",
    "AVAX-KRW",
    "BCH-KRW",
    "LTC-KRW",
    "DOT-KRW",
    "BGB-KRW",
    "XMR-KRW",
    "SHIB-KRW",
    "UNI-KRW",
    "PEPE-KRW",
    "AAVE-KRW",
    "ONDO-KRW",
    "NEAR-KRW",
    "ICP-KRW",
    "ETC-KRW",
    "APT-KRW",
    "ATOM-KRW",
    "VET-KRW",
    "KAS-KRW",
    "FET-KRW",
    "OP-KRW",
    "WLD-KRW",
    "RENDER-KRW",
    "POL-KRW",
    "FIL-KRW",
    "ALGO-KRW",
    "ARB-KRW",
]

UPBIT_MARKET_URL = "https://api.upbit.com/v1/market/all?isDetails=false"
UPBIT_WEBSOCKET_URL = "wss://api.upbit.com/websocket/v1"
SUPABASE_MARKET_QUOTE_TABLE = "market_quote_cache"
YAHOO_SPARK_URL = "https://query1.finance.yahoo.com/v7/finance/spark"


def ignore_dead_local_proxy() -> None:
    for key in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
        if os.environ.get(key) == "http://127.0.0.1:9":
            os.environ.pop(key, None)


ignore_dead_local_proxy()


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path not in {"/", "/healthz"}:
            self.send_response(404)
            self.end_headers()
            return

        body = b"ok\n"
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        return


def start_health_server() -> None:
    port_text = os.environ.get("PORT", "8080")
    try:
        port = int(port_text)
    except ValueError:
        port = 8080

    server = ThreadingHTTPServer(("0.0.0.0", port), HealthHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    print(f"{utc_now_iso()} health server listening on :{port}", flush=True)


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


def fetch_json(url: str, headers: dict[str, str] | None = None) -> object:
    request = urllib.request.Request(
        url,
        headers={"accept": "application/json", "User-Agent": "portfolio-price-worker/1.0", **(headers or {})},
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))


def crypto_base_symbol(symbol: str) -> str:
    symbol = symbol.strip().upper()
    if "-" in symbol:
        return symbol.split("-", 1)[0]
    return symbol


def app_symbol_from_upbit_market(market: str) -> str:
    return f"{market.split('-', 1)[1].upper()}-KRW"


def upbit_market_for_symbol(symbol: str) -> str:
    return f"KRW-{crypto_base_symbol(symbol)}"


def discover_upbit_markets(symbols: list[str] | None = None) -> list[str]:
    requested = {upbit_market_for_symbol(symbol) for symbol in symbols or []}
    try:
        data = fetch_json(UPBIT_MARKET_URL)
    except Exception as exc:
        fallback = sorted(requested or {upbit_market_for_symbol(symbol) for symbol in DEFAULT_CRYPTO_SYMBOLS})
        print(f"{utc_now_iso()} upbit market discovery failed, using fallback list ({len(fallback)} markets): {exc}", flush=True)
        return fallback
    if not isinstance(data, list):
        return sorted(requested)
    supported = {
        str(item.get("market") or "").upper()
        for item in data
        if isinstance(item, dict) and str(item.get("market") or "").upper().startswith("KRW-")
    }
    if requested:
        return sorted(requested & supported)
    return sorted(supported)


def parse_symbol_list(text: str) -> list[str]:
    return sorted({item.strip().upper() for item in text.replace("\n", ",").split(",") if item.strip()})


def read_symbols_file(path_text: str) -> list[str]:
    if not path_text:
        return []
    path = Path(path_text)
    if not path.exists():
        return []
    return parse_symbol_list(path.read_text(encoding="utf-8"))


def load_stock_symbols(args: argparse.Namespace) -> list[str]:
    symbols = parse_symbol_list(",".join(args.stock_symbols or []))
    symbols.extend(parse_symbol_list(os.environ.get("PRICE_WORKER_STOCK_SYMBOLS", "")))
    symbols.extend(read_symbols_file(args.stock_symbols_file or os.environ.get("PRICE_WORKER_STOCK_SYMBOLS_FILE", "")))
    universe_url = args.universe_url or os.environ.get("STRATEGY_UNIVERSE_URL", "")
    if universe_url:
        try:
            secret = args.universe_secret or os.environ.get("STRATEGY_UNIVERSE_SECRET", "") or os.environ.get("CRON_SECRET", "")
            headers = {"Authorization": f"Bearer {secret}"} if secret else {}
            payload = fetch_json(universe_url, headers=headers)
            if isinstance(payload, dict):
                raw_symbols = payload.get("symbols")
                if isinstance(raw_symbols, list):
                    symbols.extend(str(symbol) for symbol in raw_symbols)
                raw_markets = payload.get("markets")
                if isinstance(raw_markets, list):
                    for market in raw_markets:
                        if isinstance(market, dict) and isinstance(market.get("symbols"), list):
                            symbols.extend(str(symbol) for symbol in market["symbols"])
        except Exception as exc:
            print(f"{utc_now_iso()} strategy universe load failed: {exc}", flush=True)
    return sorted({symbol.strip().upper() for symbol in symbols if symbol.strip() and "-" not in symbol})


def shard_symbols(symbols: list[str], shard_index: int, shard_count: int) -> list[str]:
    if shard_count <= 1:
        return symbols
    if shard_index < 0 or shard_index >= shard_count:
        raise ValueError(f"stock shard index must be between 0 and {shard_count - 1}.")
    return [symbol for index, symbol in enumerate(symbols) if index % shard_count == shard_index]


def row_from_upbit_ticker(message: dict[str, object]) -> dict[str, object] | None:
    market = str(message.get("code") or "").upper()
    if not market.startswith("KRW-"):
        return None

    price = float_or_none(message.get("trade_price"))
    if price is None or price <= 0:
        return None
    previous_close = float_or_none(message.get("prev_closing_price"))
    if previous_close is not None and previous_close <= 0:
        previous_close = None
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


def row_from_upbit_rest_ticker(ticker: dict[str, object]) -> dict[str, object] | None:
    market = str(ticker.get("market") or "").upper()
    if not market.startswith("KRW-"):
        return None

    price = float_or_none(ticker.get("trade_price"))
    if price is None or price <= 0:
        return None
    previous_close = float_or_none(ticker.get("prev_closing_price"))
    if previous_close is not None and previous_close <= 0:
        previous_close = None
    signed_change_rate = ticker.get("signed_change_rate")
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
        "exchange": "Upbit REST Worker",
        "source": "upbit_rest_worker",
        "payload": ticker,
        "updated_at": utc_now_iso(),
    }


def float_or_none(value: object) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def pct_change(price: float | None, previous_close: float | None) -> float | None:
    if price is None or previous_close is None or previous_close == 0:
        return None
    return (price / previous_close - 1) * 100


def row_from_yahoo_spark(item: dict[str, object]) -> dict[str, object] | None:
    symbol = str(item.get("symbol") or "").upper().strip()
    if not symbol:
        return None
    response = item.get("response")
    first_response = response[0] if isinstance(response, list) and response else None
    meta = first_response.get("meta") if isinstance(first_response, dict) else None
    if not isinstance(meta, dict):
        return None

    price = float_or_none(meta.get("regularMarketPrice") or meta.get("postMarketPrice") or meta.get("preMarketPrice"))
    if price is None or price <= 0:
        return None
    previous_close = float_or_none(meta.get("chartPreviousClose") or meta.get("previousClose") or meta.get("regularMarketPreviousClose"))
    if previous_close is not None and previous_close <= 0:
        previous_close = None
    change_pct = float_or_none(meta.get("regularMarketChangePercent")) or pct_change(price, previous_close)
    return {
      "symbol": symbol,
      "provider_symbol": symbol,
      "price": price,
      "previous_close": previous_close,
      "change_pct": change_pct,
      "currency": str(meta.get("currency") or "").upper(),
      "exchange": str(meta.get("fullExchangeName") or meta.get("exchangeName") or meta.get("exchange") or "Yahoo Spark"),
      "source": "yahoo_spark_worker",
      "payload": item,
      "updated_at": utc_now_iso(),
    }


def chunked(items: list[str], size: int) -> list[list[str]]:
    return [items[index:index + size] for index in range(0, len(items), size)]


def yahoo_spark_results(batch: list[str]) -> list[dict[str, object]]:
    query = urllib.parse.urlencode({"symbols": ",".join(batch), "range": "1d", "interval": "1m"})
    payload = fetch_json(f"{YAHOO_SPARK_URL}?{query}")
    if not isinstance(payload, dict):
        return []
    spark = payload.get("spark")
    if isinstance(spark, dict) and isinstance(spark.get("result"), list):
        return [item for item in spark["result"] if isinstance(item, dict)]
    return []


def yahoo_rows_for_batch(batch: list[str]) -> tuple[list[dict[str, object]], int]:
    try:
        rows = []
        skipped = 0
        for item in yahoo_spark_results(batch):
            row = row_from_yahoo_spark(item)
            if row:
                rows.append(row)
            else:
                skipped += 1
        return rows, skipped
    except Exception as exc:
        if len(batch) <= 1:
            symbol = batch[0] if batch else "unknown"
            print(f"{utc_now_iso()} yahoo quote skipped {symbol}: {exc}", flush=True)
            return [], len(batch)
        midpoint = max(1, len(batch) // 2)
        left_rows, left_skipped = yahoo_rows_for_batch(batch[:midpoint])
        right_rows, right_skipped = yahoo_rows_for_batch(batch[midpoint:])
        return [*left_rows, *right_rows], left_skipped + right_skipped


async def fetch_and_upsert_yahoo_batch(batch: list[str]) -> tuple[int, int]:
    rows, skipped = await asyncio.to_thread(yahoo_rows_for_batch, batch)
    if rows:
        await asyncio.to_thread(supabase_upsert, rows)
    return len(rows), skipped


def upbit_rest_rows_for_batch(batch: list[str]) -> tuple[list[dict[str, object]], int]:
    try:
        query = urllib.parse.urlencode({"markets": ",".join(batch)})
        payload = fetch_json(f"https://api.upbit.com/v1/ticker?{query}")
        if not isinstance(payload, list):
            return [], len(batch)
        rows = []
        skipped = 0
        for item in payload:
            row = row_from_upbit_rest_ticker(item) if isinstance(item, dict) else None
            if row:
                rows.append(row)
            else:
                skipped += 1
        return rows, skipped
    except Exception as exc:
        if len(batch) <= 1:
            market = batch[0] if batch else "unknown"
            print(f"{utc_now_iso()} upbit REST quote skipped {market}: {exc}", flush=True)
            return [], len(batch)
        midpoint = max(1, len(batch) // 2)
        left_rows, left_skipped = upbit_rest_rows_for_batch(batch[:midpoint])
        right_rows, right_skipped = upbit_rest_rows_for_batch(batch[midpoint:])
        return [*left_rows, *right_rows], left_skipped + right_skipped


async def fetch_and_upsert_upbit_rest_batch(batch: list[str]) -> tuple[int, int]:
    rows, skipped = await asyncio.to_thread(upbit_rest_rows_for_batch, batch)
    if rows:
        await asyncio.to_thread(supabase_upsert, rows)
    return len(rows), skipped


async def poll_upbit_rest_quotes(markets: list[str], interval: float, batch_size: int, concurrency: int) -> None:
    if not markets:
        print(f"{utc_now_iso()} crypto REST polling disabled", flush=True)
        return
    concurrency = max(1, concurrency)
    batches = chunked(markets, max(1, batch_size))
    print(
        f"{utc_now_iso()} polling {len(markets)} crypto quotes every {interval}s with {concurrency} REST workers",
        flush=True,
    )
    while True:
        started_at = datetime.now(timezone.utc)
        updated = 0
        skipped = 0
        processed = 0
        for batch_group in chunked(batches, concurrency):
            results = await asyncio.gather(
                *(fetch_and_upsert_upbit_rest_batch(batch) for batch in batch_group),
                return_exceptions=True,
            )
            for result in results:
                if isinstance(result, Exception):
                    print(f"{utc_now_iso()} upbit REST quote batch failed: {result}", flush=True)
                    continue
                batch_updated, batch_skipped = result
                updated += batch_updated
                skipped += batch_skipped
            processed += len(batch_group)
            if processed % 20 == 0 or processed >= len(batches):
                print(f"{utc_now_iso()} crypto REST progress {processed}/{len(batches)} batches; upserted {updated}", flush=True)
            await asyncio.sleep(0.05)
        elapsed = (datetime.now(timezone.utc) - started_at).total_seconds()
        print(f"{utc_now_iso()} upserted {updated} crypto REST quotes in {elapsed:.1f}s; skipped {skipped}", flush=True)
        await asyncio.sleep(interval)


async def poll_yahoo_quotes(symbols: list[str], interval: float, batch_size: int, concurrency: int) -> None:
    if not symbols:
        print(f"{utc_now_iso()} stock quote polling disabled", flush=True)
        return
    concurrency = max(1, concurrency)
    print(f"{utc_now_iso()} polling {len(symbols)} stock quotes every {interval}s with {concurrency} workers", flush=True)
    batches = chunked(symbols, max(1, batch_size))
    while True:
        started_at = datetime.now(timezone.utc)
        updated = 0
        skipped = 0
        processed = 0
        for batch_group in chunked(batches, concurrency):
            results = await asyncio.gather(
                *(fetch_and_upsert_yahoo_batch(batch) for batch in batch_group),
                return_exceptions=True,
            )
            for result in results:
                if isinstance(result, Exception):
                    print(f"{utc_now_iso()} yahoo quote batch failed: {result}", flush=True)
                    continue
                batch_updated, batch_skipped = result
                updated += batch_updated
                skipped += batch_skipped
            processed += len(batch_group)
            if processed % 50 == 0 or processed >= len(batches):
                print(f"{utc_now_iso()} stock quote progress {processed}/{len(batches)} batches; upserted {updated}", flush=True)
            await asyncio.sleep(0.05)
        elapsed = (datetime.now(timezone.utc) - started_at).total_seconds()
        print(f"{utc_now_iso()} upserted {updated} stock quotes in {elapsed:.1f}s; skipped {skipped} invalid or missing quote rows", flush=True)
        await asyncio.sleep(interval)


async def flush_quotes(latest_rows: dict[str, dict[str, object]], interval: float, stream_name: str) -> None:
    while True:
        await asyncio.sleep(interval)
        if not latest_rows:
            continue
        rows = list(latest_rows.values())
        latest_rows.clear()
        supabase_upsert(rows)
        print(f"{utc_now_iso()} {stream_name} upserted {len(rows)} quotes", flush=True)


async def stream_upbit(markets: list[str], flush_interval: float, reconnect_delay: float, stream_name: str) -> None:
    latest_rows: dict[str, dict[str, object]] = {}
    flush_task = asyncio.create_task(flush_quotes(latest_rows, flush_interval, stream_name))
    try:
        while True:
            try:
                async with websockets.connect(UPBIT_WEBSOCKET_URL, ping_interval=20, ping_timeout=20, proxy=None) as websocket:
                    subscribe_message = [
                        {"ticket": "myfinancialportfolio-market-cache"},
                        {"type": "ticker", "codes": markets},
                    ]
                    await websocket.send(json.dumps(subscribe_message))
                    print(f"{utc_now_iso()} {stream_name} subscribed to {len(markets)} markets: {', '.join(markets)}", flush=True)
                    async for raw_message in websocket:
                        if isinstance(raw_message, bytes):
                            raw_message = raw_message.decode("utf-8")
                        message = json.loads(raw_message)
                        if isinstance(message, dict):
                            row = row_from_upbit_ticker(message)
                            if row:
                                latest_rows[str(row["symbol"])] = row
            except Exception as exc:
                print(f"{utc_now_iso()} {stream_name} websocket error: {exc}", flush=True)
                await asyncio.sleep(reconnect_delay)
    finally:
        flush_task.cancel()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Stream Upbit crypto quotes into Supabase.")
    parser.add_argument("--symbols", nargs="*", default=None, help="Optional app symbols such as BTC-KRW ETH-KRW. Defaults to every Upbit KRW market.")
    parser.add_argument("--disable-crypto", action="store_true", default=os.environ.get("PRICE_WORKER_DISABLE_CRYPTO", "").lower() in {"1", "true", "yes"}, help="Disable all Upbit crypto quote updates.")
    parser.add_argument("--disable-crypto-websocket", action="store_true", default=os.environ.get("PRICE_WORKER_DISABLE_CRYPTO_WEBSOCKET", "").lower() in {"1", "true", "yes"}, help="Disable Upbit crypto WebSocket streaming.")
    parser.add_argument("--crypto-batch-size", type=int, default=int(os.environ.get("PRICE_WORKER_CRYPTO_BATCH_SIZE", "100")), help="Upbit markets per WebSocket subscription.")
    parser.add_argument("--disable-crypto-rest-poll", action="store_true", default=os.environ.get("PRICE_WORKER_DISABLE_CRYPTO_REST_POLL", "").lower() in {"1", "true", "yes"}, help="Disable the Upbit REST polling cache backstop.")
    parser.add_argument("--crypto-rest-poll-interval", type=float, default=float(os.environ.get("PRICE_WORKER_CRYPTO_REST_POLL_INTERVAL", "30")), help="Seconds between full crypto REST polling passes.")
    parser.add_argument("--crypto-rest-batch-size", type=int, default=int(os.environ.get("PRICE_WORKER_CRYPTO_REST_BATCH_SIZE", "80")), help="Upbit markets per REST ticker request.")
    parser.add_argument("--crypto-rest-concurrency", type=int, default=int(os.environ.get("PRICE_WORKER_CRYPTO_REST_CONCURRENCY", "2")), help="Concurrent Upbit REST ticker batches.")
    parser.add_argument("--stock-symbols", nargs="*", default=[], help="Stock symbols such as AAPL MSFT 005930.KS.")
    parser.add_argument("--stock-symbols-file", default="", help="Optional file with comma/newline separated stock symbols.")
    parser.add_argument("--stock-poll-interval", type=float, default=float(os.environ.get("PRICE_WORKER_STOCK_POLL_INTERVAL", "60")), help="Seconds between full stock quote polling passes.")
    parser.add_argument("--stock-batch-size", type=int, default=int(os.environ.get("PRICE_WORKER_STOCK_BATCH_SIZE", "40")), help="Yahoo quote symbols per request.")
    parser.add_argument("--stock-concurrency", type=int, default=int(os.environ.get("PRICE_WORKER_STOCK_CONCURRENCY", "6")), help="Concurrent Yahoo quote batches.")
    parser.add_argument("--stock-shard-index", type=int, default=int(os.environ.get("PRICE_WORKER_STOCK_SHARD_INDEX", "0")), help="Zero-based stock symbol shard index.")
    parser.add_argument("--stock-shard-count", type=int, default=int(os.environ.get("PRICE_WORKER_STOCK_SHARD_COUNT", "1")), help="Total number of stock symbol shards.")
    parser.add_argument("--universe-url", default="", help="Optional URL returning JSON strategy universe symbols.")
    parser.add_argument("--universe-secret", default="", help="Bearer secret for the strategy universe URL.")
    parser.add_argument("--flush-interval", type=float, default=1.5, help="Seconds between Supabase quote upserts.")
    parser.add_argument("--reconnect-delay", type=float, default=5.0, help="Seconds to wait before reconnecting.")
    return parser.parse_args()


async def run_worker(args: argparse.Namespace) -> None:
    tasks = []
    requested_symbols = parse_symbol_list(",".join(args.symbols or []))
    requested_symbols.extend(parse_symbol_list(os.environ.get("PRICE_WORKER_CRYPTO_SYMBOLS", "")))
    markets = []
    if not args.disable_crypto:
        markets = discover_upbit_markets(requested_symbols)
        if not markets:
            raise SystemExit("No Upbit KRW markets are available for crypto streaming.")
    if not args.disable_crypto and not args.disable_crypto_websocket:
        crypto_batches = chunked(markets, max(1, args.crypto_batch_size))
        print(f"{utc_now_iso()} crypto streaming {len(markets)} Upbit KRW markets across {len(crypto_batches)} websocket connection(s)", flush=True)
        for index, market_batch in enumerate(crypto_batches, start=1):
            tasks.append(stream_upbit(market_batch, args.flush_interval, args.reconnect_delay, f"crypto-{index}/{len(crypto_batches)}"))
    elif args.disable_crypto:
        print(f"{utc_now_iso()} crypto quote streaming disabled", flush=True)
    else:
        print(f"{utc_now_iso()} crypto websocket streaming disabled", flush=True)
    if not args.disable_crypto and not args.disable_crypto_rest_poll:
        tasks.append(poll_upbit_rest_quotes(markets, args.crypto_rest_poll_interval, args.crypto_rest_batch_size, args.crypto_rest_concurrency))
    elif not args.disable_crypto:
        print(f"{utc_now_iso()} crypto REST polling disabled", flush=True)

    stock_symbols = shard_symbols(load_stock_symbols(args), args.stock_shard_index, args.stock_shard_count)
    if stock_symbols:
        print(
            f"{utc_now_iso()} stock shard {args.stock_shard_index + 1}/{args.stock_shard_count} owns {len(stock_symbols)} symbols",
            flush=True,
        )
        tasks.append(poll_yahoo_quotes(stock_symbols, args.stock_poll_interval, args.stock_batch_size, args.stock_concurrency))
    else:
        print(f"{utc_now_iso()} stock quote polling disabled for empty shard", flush=True)

    if not tasks:
        raise SystemExit("No quote worker tasks are enabled.")
    await asyncio.gather(*tasks)


def main() -> None:
    args = parse_args()
    start_health_server()
    asyncio.run(run_worker(args))


if __name__ == "__main__":
    main()
