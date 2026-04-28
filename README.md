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
