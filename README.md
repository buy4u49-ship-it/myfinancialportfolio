# Market Intelligence Dashboard

Streamlit dashboard for stocks, crypto, Korean equities, market movers, monthly return/risk metrics, financial statements, and CAPM-implied prices.

## Run Locally

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python -m streamlit run app.py --server.port=8501
```

Open:

```text
http://localhost:8501
```

## Edit on Another Computer

Recommended workflow:

1. Install Git: https://git-scm.com/downloads
2. Create a GitHub repository.
3. From this project folder:

```powershell
git init
git add .
git commit -m "Initial market dashboard"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

On another computer:

```powershell
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git
cd YOUR_REPO
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m streamlit run app.py --server.port=8501
```

## Deploy Online: Streamlit Community Cloud

This is the simplest option for a Streamlit app.

1. Push this project to GitHub.
2. Go to https://share.streamlit.io/
3. Select the GitHub repository.
4. Set main file path:

```text
app.py
```

5. Deploy.

The app will be available from a public HTTPS URL that works on desktop and mobile.

## Next.js / Vercel version

This repo now also includes a Next.js app for Vercel. It keeps Supabase as the account/portfolio store and keeps the Fly.io worker as the realtime Upbit quote writer.

Local setup:

```powershell
npm.cmd install
npm.cmd run dev
```

Required Vercel environment variables:

```text
SUPABASE_URL=https://lwtlxlhnxznehomhlhif.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SESSION_SECRET=your-long-random-session-secret
DART_API_KEY=your-opendart-api-key
```

Do not expose `SUPABASE_SERVICE_ROLE_KEY` as a `NEXT_PUBLIC_...` variable. It is used only by Next.js server routes.

The Next.js app currently provides:

- Existing Supabase username/password login using the same PBKDF2 password hash as the Streamlit app.
- Portfolio loading/saving from `public.app_user_records`.
- Realtime crypto prices from `public.market_quote_cache`, written by the Fly.io worker.
- A single portfolio table with inline Buy/Sell actions.
- Transaction history saved into `record.transactions`.

For Vercel, keep the default settings:

```text
Build command: npm run build
Output directory: Next.js default
```

### Supabase user storage

The app stores accounts, remember-login tokens, portfolios, and alerts in Supabase when these Streamlit secrets are configured:

```toml
SUPABASE_URL = "https://lwtlxlhnxznehomhlhif.supabase.co"
SUPABASE_SERVICE_ROLE_KEY = "your-service-role-key"
```

In Streamlit Community Cloud, open the app settings, go to **Secrets**, and add the values above. The service role key must stay in Streamlit secrets and must not be committed to GitHub.

If these secrets are not configured, the app falls back to local `user_data/users.json` storage.

### Realtime crypto quote cache

Crypto current prices are read from Upbit KRW quotes instead of yfinance. For the fastest updates, create the Supabase quote cache table by running `supabase_market_quote_cache.sql` in the Supabase SQL Editor, then run this worker as a separate process:

```powershell
cd "C:\Users\buy4u\OneDrive\문서\New project"
python .\market_price_worker.py
```

Or run the helper script, which automatically switches into this project folder:

```powershell
powershell -ExecutionPolicy Bypass -File "C:\Users\buy4u\OneDrive\문서\New project\run_market_price_worker.ps1"
```

The worker streams Upbit ticker data over WebSocket and upserts the latest prices into `public.market_quote_cache`. By default it discovers every Upbit KRW market from `https://api.upbit.com/v1/market/all?isDetails=false` and splits the subscription into batches with `PRICE_WORKER_CRYPTO_BATCH_SIZE` or `--crypto-batch-size`. Set `PRICE_WORKER_CRYPTO_SYMBOLS` or pass `--symbols BTC-KRW ETH-KRW` only when you want to limit crypto streaming to a smaller list. The Streamlit app reads that cache first and falls back to direct Upbit REST quotes if the worker is not running or the cached quote is stale.

Streamlit Community Cloud normally runs only the Streamlit web app process, not a permanent background quote worker. If this worker runs only on your PC, the WebSocket cache updates only while your PC is on and the worker is running. Other users can still open the Streamlit app when your PC is off, but prices will come from the app's direct Upbit REST fallback instead of the faster Supabase WebSocket cache. For always-on cache updates, deploy this worker as a background worker on a separate hosting service such as Render, Railway, or Fly.io.

If you run the worker outside Streamlit Cloud, provide the same secrets as environment variables:

```powershell
$env:SUPABASE_URL = "https://lwtlxlhnxznehomhlhif.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "your-service-role-key"
python .\market_price_worker.py
```

### Deploy only the quote worker on Fly.io

This repo includes `Dockerfile`, `requirements-worker.txt`, and `fly.toml` so Fly.io runs only `market_price_worker.py`. Streamlit Community Cloud should still run `app.py`; Fly.io is only for the always-on Upbit WebSocket quote cache.

The Fly.io app is configured with `auto_stop_machines = "off"` and `min_machines_running = 1` so the quote worker keeps running even when there is no web traffic. One `shared-cpu-1x@256MB` Machine is intended to be enough for this worker, including all Upbit KRW markets, because the worker keeps multiple WebSocket subscriptions inside one process. Add another Machine only if logs show CPU, memory, or reconnect pressure; running two identical crypto workers duplicates the same quote writes and roughly doubles the compute cost.

Before deploying, create `public.market_quote_cache` by running `supabase_market_quote_cache.sql` in the Supabase SQL Editor.

For weekly financial statement and ratio caching, also run `supabase_financial_statement_cache.sql` in the Supabase SQL Editor. The Next.js app stores OpenDART Korean-stock financial data in this table and reuses it for seven days instead of calling OpenDART on every page load.

In Fly.io, add these secrets in the app's **Secrets** page:

```text
SUPABASE_URL=https://lwtlxlhnxznehomhlhif.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
DART_API_KEY=your-opendart-api-key
```

If deploying with `flyctl`, use:

```powershell
fly secrets set SUPABASE_URL="https://lwtlxlhnxznehomhlhif.supabase.co" SUPABASE_SERVICE_ROLE_KEY="your-service-role-key" -a myfinancialportfolio
fly deploy -a myfinancialportfolio
```

If the Fly.io app name is different, update `app = "myfinancialportfolio"` in `fly.toml` and the `-a` value above to match the Fly.io app name.

## Deploy Online: Render

This repository includes `render.yaml` and `Procfile`.

1. Push this project to GitHub.
2. Go to https://render.com/
3. Create a new Web Service from the GitHub repo.
4. Render should detect `render.yaml`.
5. If manual setup is needed:

```text
Build command: pip install -r requirements.txt
Start command: streamlit run app.py --server.port=$PORT --server.address=0.0.0.0 --server.headless=true
```

## CLI

Create monthly metrics CSV:

```powershell
python market_tracker.py metrics --symbols AAPL MSFT BTC-USD ETH-USD --benchmark SPY --out monthly_metrics.csv
```

Poll prices:

```powershell
python market_tracker.py watch --symbols AAPL TSLA BTC-USD --interval 10
```

Stream Yahoo Finance WebSocket prices:

```powershell
python market_tracker.py stream --symbols AAPL TSLA BTC-USD
```

## Notes

- The app uses `yfinance` as the default data source.
- US 3-month T-Bill data is fetched from FRED for CAPM calculations.
- Some market data can be delayed or unavailable depending on Yahoo Finance coverage.
- For production-grade realtime feeds, use licensed providers such as Alpaca SIP, Polygon, Finnhub, broker APIs, Binance, Coinbase, or Kraken.
