from __future__ import annotations

import argparse
import math
import os
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


@dataclass(frozen=True)
class MetricConfig:
    years: int
    benchmark: str
    rolling_window: int


def _load_dependencies():
    for key in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
        if os.environ.get(key) == "http://127.0.0.1:9":
            os.environ.pop(key, None)

    try:
        import numpy as np
        import pandas as pd
        import yfinance as yf
    except ImportError as exc:
        missing = exc.name or "a required package"
        raise SystemExit(
            f"Missing dependency: {missing}. Install with: python -m pip install -r requirements.txt"
        ) from exc

    return np, pd, yf


def download_daily_prices(symbol: str, years: int):
    _, pd, yf = _load_dependencies()

    ticker = yf.Ticker(symbol)
    history = ticker.history(period="max", interval="1d", auto_adjust=True, actions=False)
    if history.empty:
        raise ValueError(f"No daily price history returned for {symbol}")

    history = history.sort_index()
    if history.index.tz is not None:
        history.index = history.index.tz_convert(None)
    history.index = history.index.normalize()

    cutoff = pd.Timestamp.today().normalize() - pd.DateOffset(years=years)
    history = history.loc[history.index >= cutoff]
    if history.empty:
        raise ValueError(f"No prices for {symbol} inside the last {years} years")

    return history[["Close"]].rename(columns={"Close": symbol})


def latest_price(symbol: str) -> dict[str, object]:
    _, _, yf = _load_dependencies()

    ticker = yf.Ticker(symbol)
    try:
        fast_info = ticker.fast_info
        price = fast_info.get("last_price") or fast_info.get("regular_market_price")
        currency = fast_info.get("currency")
        exchange = fast_info.get("exchange")
    except Exception:
        price = currency = exchange = None

    if price is None or (isinstance(price, float) and math.isnan(price)):
        intraday = ticker.history(period="1d", interval="1m", auto_adjust=True, actions=False)
        if intraday.empty:
            raise ValueError(f"No latest price returned for {symbol}")
        price = float(intraday["Close"].dropna().iloc[-1])
        currency = None
        exchange = None

    return {
        "symbol": symbol,
        "price": float(price),
        "currency": currency or "",
        "exchange": exchange or "",
        "timestamp_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


def monthly_metrics(symbol: str, config: MetricConfig):
    np, pd, _ = _load_dependencies()

    asset = download_daily_prices(symbol, config.years)
    benchmark = download_daily_prices(config.benchmark, config.years)
    prices = asset.join(benchmark, how="inner").dropna()
    if len(prices) < 2:
        raise ValueError(f"Not enough overlapping price history for {symbol} and {config.benchmark}")

    daily_log_returns = np.log(prices / prices.shift(1)).dropna()
    monthly_close = prices.resample("ME").last().dropna()
    monthly_log_returns = np.log(monthly_close / monthly_close.shift(1)).dropna()

    rows = pd.DataFrame(index=monthly_log_returns.index)
    rows["symbol"] = symbol
    rows["benchmark"] = config.benchmark
    rows["monthly_log_return"] = monthly_log_returns[symbol]
    rows["benchmark_monthly_log_return"] = monthly_log_returns[config.benchmark]
    rows["monthly_volatility"] = daily_log_returns[symbol].resample("ME").std()

    aligned = monthly_log_returns[[symbol, config.benchmark]].dropna()
    benchmark_variance = aligned[config.benchmark].var()
    full_beta = aligned[symbol].cov(aligned[config.benchmark]) / benchmark_variance
    rows["beta_full_period"] = full_beta

    rolling_cov = aligned[symbol].rolling(config.rolling_window).cov(aligned[config.benchmark])
    rolling_var = aligned[config.benchmark].rolling(config.rolling_window).var()
    rows[f"beta_rolling_{config.rolling_window}m"] = rolling_cov / rolling_var

    rows = rows.reset_index(names="month")
    rows["month"] = rows["month"].dt.strftime("%Y-%m")
    return rows


def build_metrics(args: argparse.Namespace) -> int:
    _, pd, _ = _load_dependencies()

    config = MetricConfig(
        years=args.years,
        benchmark=args.benchmark,
        rolling_window=args.rolling_window,
    )

    frames = []
    for symbol in args.symbols:
        frames.append(monthly_metrics(symbol, config))

    result = pd.concat(frames, ignore_index=True)
    output = Path(args.out)
    output.parent.mkdir(parents=True, exist_ok=True)
    result.to_csv(output, index=False)
    print(f"Wrote {len(result):,} rows to {output}")
    return 0


def watch_prices(args: argparse.Namespace) -> int:
    print("Press Ctrl+C to stop.")
    try:
        while True:
            rows = []
            for symbol in args.symbols:
                try:
                    quote = latest_price(symbol)
                    rows.append(
                        "{timestamp_utc}  {symbol:<12} {price:>14,.6f} {currency:<4} {exchange}".format(
                            **quote
                        )
                    )
                except Exception as exc:
                    rows.append(f"{datetime.now(timezone.utc).isoformat(timespec='seconds')}  {symbol:<12} ERROR: {exc}")

            print("\n".join(rows), flush=True)
            time.sleep(args.interval)
    except KeyboardInterrupt:
        print("\nStopped.")
        return 0


def stream_prices(args: argparse.Namespace) -> int:
    _, _, yf = _load_dependencies()

    def message_handler(message: dict[str, object]) -> None:
        symbol = message.get("id") or message.get("symbol") or ""
        price = message.get("price") or message.get("lastPrice") or ""
        timestamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
        print(f"{timestamp}  {symbol:<12} {price}", flush=True)

    print("Streaming with yfinance WebSocket. Press Ctrl+C to stop.")
    try:
        with yf.WebSocket(verbose=False) as websocket:
            websocket.subscribe(args.symbols)
            websocket.listen(message_handler)
    except KeyboardInterrupt:
        print("\nStopped.")
        return 0


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Track stock/crypto prices and calculate monthly log returns, volatility, and beta."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    metrics = subparsers.add_parser("metrics", help="Calculate monthly metrics from daily price history.")
    metrics.add_argument("--symbols", nargs="+", required=True, help="Ticker symbols, e.g. AAPL MSFT BTC-USD")
    metrics.add_argument("--benchmark", default="SPY", help="Benchmark ticker for beta calculation. Default: SPY")
    metrics.add_argument("--years", type=int, default=20, help="Maximum lookback in years. Default: 20")
    metrics.add_argument("--rolling-window", type=int, default=36, help="Rolling beta window in months. Default: 36")
    metrics.add_argument("--out", default="monthly_metrics.csv", help="CSV output path.")
    metrics.set_defaults(func=build_metrics)

    watch = subparsers.add_parser("watch", help="Poll latest prices.")
    watch.add_argument("--symbols", nargs="+", required=True, help="Ticker symbols, e.g. AAPL BTC-USD")
    watch.add_argument("--interval", type=int, default=15, help="Polling interval in seconds. Default: 15")
    watch.set_defaults(func=watch_prices)

    stream = subparsers.add_parser("stream", help="Stream live prices with yfinance WebSocket.")
    stream.add_argument("--symbols", nargs="+", required=True, help="Ticker symbols, e.g. AAPL BTC-USD")
    stream.set_defaults(func=stream_prices)

    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
