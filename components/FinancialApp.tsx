"use client";

import { CSSProperties, FormEvent, ReactNode, useEffect, useState } from "react";
import type {
  ChartPoint,
  FinancialLine,
  FinancialStatement,
  MacroPoint,
  MarketMoverRow,
  MarketPageResponse,
  PriceAlert,
  PortfolioResponse,
  PortfolioRow,
  PortfolioTransaction,
  Quote,
  SymbolDetailResponse
} from "@/lib/types";
import { KOREA_STOCK_NAMES } from "@/lib/symbols";

type User = {
  username: string;
  displayName: string;
  email?: string;
};

type PageKey = "coin" | "us" | "korea" | "symbol" | "my";
type TradeMode = "BUY" | "SELL";
type ChartRange = "1D" | "1W" | "1M" | "1Y" | "YTD";
type MyTab = "portfolio" | "alerts" | "account";
type MappingCandidate = SymbolDetailResponse["statements"]["mappingCandidates"][number];
type MappingOption = { statement: string; lineKey: string; label: string };

const PAGES: Array<{ key: PageKey; label: string }> = [
  { key: "coin", label: "Coin Main" },
  { key: "us", label: "US Stock Main" },
  { key: "korea", label: "Korea Stock Main" },
  { key: "symbol", label: "Symbol Detail" },
  { key: "my", label: "My Page" }
];

const moneyFormatters = new Map<string, Intl.NumberFormat>();
const numberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 8 });
const MARKET_CHART_RANGES: ChartRange[] = ["1D", "1W", "1M", "1Y"];
const SYMBOL_BAR_RANGES: ChartRange[] = ["1W", "1M", "1Y", "YTD"];
const INDEX_LABELS: Record<string, string> = {
  "BTC-KRW": "Bitcoin",
  "ETH-KRW": "Ethereum",
  "SOL-KRW": "Solana",
  "BNB-KRW": "BNB",
  "^GSPC": "S&P 500 Index",
  "^IXIC": "Nasdaq Composite",
  "^DJI": "Dow Jones Industrial Average",
  "^RUT": "Russell 2000",
  "^VIX": "CBOE Volatility Index",
  "^KS11": "KOSPI Composite Index",
  "^KQ11": "KOSDAQ Composite Index",
  "005930.KS": "Samsung Electronics",
  "000660.KS": "SK Hynix"
};

function currencyFormatter(currency: string) {
  const key = currency || "USD";
  if (!moneyFormatters.has(key)) {
    moneyFormatters.set(
      key,
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: key,
        maximumFractionDigits: key === "KRW" ? 0 : 2
      })
    );
  }
  return moneyFormatters.get(key)!;
}

function formatNumber(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "N/A";
  }
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(value);
}

function formatCompact(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "N/A";
  }
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2
  }).format(value);
}

function formatMoney(value: number | null | undefined, currency: string) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "N/A";
  }
  return currencyFormatter(currency || "USD").format(value);
}

function formatPct(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "N/A";
  }
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function signedClass(value: number | null | undefined) {
  if (!value) {
    return "neutral";
  }
  return value > 0 ? "positive" : "negative";
}

function displayIndexLabel(symbol: string) {
  const normalized = symbol.toUpperCase();
  if (KOREA_STOCK_NAMES[normalized]) {
    return KOREA_STOCK_NAMES[normalized];
  }
  const label = INDEX_LABELS[normalized];
  return label ? `${label} (${normalized})` : normalized;
}

function displayMarketSymbol(symbol: string) {
  return KOREA_STOCK_NAMES[symbol.toUpperCase()] || symbol;
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }
  return payload;
}

export default function FinancialApp() {
  const [page, setPage] = useState<PageKey>("coin");
  const [user, setUser] = useState<User | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioResponse | null>(null);
  const [marketData, setMarketData] = useState<Partial<Record<PageKey, MarketPageResponse>>>({});
  const [symbolDetail, setSymbolDetail] = useState<SymbolDetailResponse | null>(null);
  const [symbol, setSymbol] = useState("AAPL");
  const [symbolDraft, setSymbolDraft] = useState("AAPL");
  const [benchmark, setBenchmark] = useState("SPY");
  const [historyYears, setHistoryYears] = useState(20);
  const [rollingWindow, setRollingWindow] = useState(36);
  const [marketRanges, setMarketRanges] = useState<Record<"coin" | "us" | "korea", ChartRange>>({
    coin: "1D",
    us: "1D",
    korea: "1D"
  });
  const [symbolRange, setSymbolRange] = useState<ChartRange>("1M");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [error, setError] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [activeTrade, setActiveTrade] = useState<{ symbol: string; mode: TradeMode } | null>(null);
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [newSymbol, setNewSymbol] = useState("");
  const [newCurrency, setNewCurrency] = useState("KRW");
  const [symbolTab, setSymbolTab] = useState<"overview" | "financials" | "price" | "provider">("overview");
  const [myTab, setMyTab] = useState<MyTab>("portfolio");
  const [alertSymbol, setAlertSymbol] = useState("BTC-KRW");
  const [alertDirection, setAlertDirection] = useState<"above" | "below">("above");
  const [alertTarget, setAlertTarget] = useState("");
  const [profileDraft, setProfileDraft] = useState({ displayName: "", email: "" });
  const [credentials, setCredentials] = useState({
    username: "",
    password: "",
    displayName: "",
    email: ""
  });

  async function loadSession() {
    try {
      const data = await parseJsonResponse<{ user: User | null }>(await fetch("/api/auth/me", { cache: "no-store" }));
      setUser(data.user);
      if (data.user) {
        await loadPortfolio(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Session check failed.");
    }
  }

  async function loadMarket(target: PageKey, range = marketRanges[target as "coin" | "us" | "korea"] || "1D") {
    const market = target === "coin" ? "crypto" : target === "us" ? "us" : "korea";
    const data = await parseJsonResponse<MarketPageResponse>(
      await fetch(`/api/market?market=${market}&range=${range}`, { cache: "no-store" })
    );
    setMarketData((prev) => ({ ...prev, [target]: data }));
  }

  async function loadSymbol(targetSymbol = symbol, range = symbolRange) {
    const params = new URLSearchParams({
      symbol: targetSymbol,
      range,
      benchmark,
      historyYears: String(historyYears),
      rollingWindow: String(rollingWindow)
    });
    const data = await parseJsonResponse<SymbolDetailResponse>(
      await fetch(`/api/symbol?${params.toString()}`, { cache: "no-store" })
    );
    setSymbolDetail(data);
  }

  async function loadPortfolio(silent = false) {
    if (!silent) {
      setBusy(true);
    }
    try {
      const data = await parseJsonResponse<PortfolioResponse>(await fetch("/api/portfolio", { cache: "no-store" }));
      setPortfolio(data);
      setUser(data.user);
      setProfileDraft({ displayName: data.user.displayName, email: data.user.email || "" });
      setError("");
    } catch (err) {
      if (!silent) {
        setError(err instanceof Error ? err.message : "Portfolio load failed.");
      }
    } finally {
      if (!silent) {
        setBusy(false);
      }
    }
  }

  async function refreshCurrentPage() {
    setBusy(true);
    setError("");
    try {
      if (page === "coin" || page === "us" || page === "korea") {
        await loadMarket(page, marketRanges[page]);
      } else if (page === "symbol") {
        await loadSymbol(symbol, symbolRange);
      } else if (user) {
        await loadPortfolio();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refresh failed.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    async function boot() {
      setLoading(true);
      await Promise.allSettled([loadSession(), loadMarket("coin")]);
      setLoading(false);
    }
    boot();
  }, []);

  useEffect(() => {
    if (page === "coin" || page === "us" || page === "korea") {
      if (!marketData[page]) {
        refreshCurrentPage();
      }
    } else if (page === "symbol" && !symbolDetail) {
      refreshCurrentPage();
    } else if (page === "my" && user && !portfolio) {
      loadPortfolio();
    }
  }, [page]);

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const endpoint = authMode === "login" ? "/api/auth/login" : "/api/auth/register";
      const data = await parseJsonResponse<{ user: User }>(
        await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(credentials)
        })
      );
      setUser(data.user);
      await loadPortfolio(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed.");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    setPortfolio(null);
    setCredentials({ username: "", password: "", displayName: "", email: "" });
  }

  async function submitTrade(targetSymbol: string, mode: TradeMode, currency: string) {
    setBusy(true);
    setError("");
    try {
      const data = await parseJsonResponse<PortfolioResponse>(
        await fetch("/api/portfolio", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: mode,
            symbol: targetSymbol,
            quantity: Number(quantity),
            price: Number(price),
            currency
          })
        })
      );
      setPortfolio(data);
      setActiveTrade(null);
      setQuantity("");
      setPrice("");
      if (newSymbol.toUpperCase() === targetSymbol.toUpperCase()) {
        setNewSymbol("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Trade failed.");
    } finally {
      setBusy(false);
    }
  }

  async function changeMarketRange(target: "coin" | "us" | "korea", range: ChartRange) {
    setMarketRanges((prev) => ({ ...prev, [target]: range }));
    setBusy(true);
    try {
      await loadMarket(target, range);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chart range update failed.");
    } finally {
      setBusy(false);
    }
  }

  async function changeSymbolRange(range: ChartRange) {
    setSymbolRange(range);
    setBusy(true);
    try {
      await loadSymbol(symbol, range);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chart range update failed.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmSettings() {
    if (page !== "symbol") {
      setPage("symbol");
    }
    setSettingsBusy(true);
    setError("");
    try {
      await loadSymbol(symbol, symbolRange);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Settings update failed.");
    } finally {
      setSettingsBusy(false);
    }
  }

  async function saveFinancialMapping(candidate: MappingCandidate, lineKey: string) {
    setBusy(true);
    setError("");
    try {
      await parseJsonResponse<{ ok: boolean; mappingCount: number }>(
        await fetch("/api/financial-mappings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            statementDiv: candidate.statementDiv,
            accountId: candidate.accountId,
            accountName: candidate.accountName,
            lineKey
          })
        })
      );
      await loadSymbol(symbol, symbolRange);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Mapping save failed.");
      throw err;
    } finally {
      setBusy(false);
    }
  }

  async function patchPortfolio(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const data = await parseJsonResponse<PortfolioResponse>(
        await fetch("/api/portfolio", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        })
      );
      setPortfolio(data);
      setUser(data.user);
      setProfileDraft({ displayName: data.user.displayName, email: data.user.email || "" });
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Portfolio update failed.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function submitAlert() {
    const data = await patchPortfolio({
      action: "add_alert",
      symbol: alertSymbol,
      direction: alertDirection,
      targetPrice: Number(alertTarget)
    });
    if (data) {
      setAlertTarget("");
    }
  }

  function openSymbol(target: string) {
    const next = target.trim().toUpperCase();
    if (!next) {
      return;
    }
    setSymbol(next);
    setSymbolDraft(next);
    setPage("symbol");
    setBusy(true);
    loadSymbol(next, symbolRange)
      .catch((err) => setError(err instanceof Error ? err.message : "Symbol load failed."))
      .finally(() => setBusy(false));
  }

  const pageTitle =
    page === "coin"
      ? "Coin Main"
      : page === "us"
        ? "US Stock Main"
        : page === "korea"
          ? "Korea Stock Main"
          : page === "symbol"
            ? "Symbol Detail"
            : "My Page";

  if (loading) {
    return (
      <main className="app-shell">
        <div className="loading-panel">Loading financial dashboard...</div>
      </main>
    );
  }

  return (
    <div className="app-frame">
      <Sidebar
        user={user}
        portfolio={portfolio}
        symbolDraft={symbolDraft}
        benchmark={benchmark}
        historyYears={historyYears}
        rollingWindow={rollingWindow}
        authMode={authMode}
        credentials={credentials}
        busy={busy}
        settingsBusy={settingsBusy}
        onSymbolDraft={setSymbolDraft}
        onBenchmark={setBenchmark}
        onHistoryYears={setHistoryYears}
        onRollingWindow={setRollingWindow}
        onAuthMode={setAuthMode}
        onCredentials={setCredentials}
        onSubmitAuth={submitAuth}
        onConfirmSettings={confirmSettings}
        onOpenSymbol={openSymbol}
        onGoMyPage={() => setPage("my")}
        onLogout={logout}
      />
      <main className="app-shell">
      <header className="topbar app-topbar">
        <div>
          <p className="eyebrow">My Financial Portfolio</p>
          <h1>{pageTitle}</h1>
        </div>
        <div className="topbar-actions">
          <button className="ghost-button" onClick={refreshCurrentPage} disabled={busy}>
            Refresh
          </button>
          {user ? (
            <button className="ghost-button" onClick={logout}>
              Logout
            </button>
          ) : (
            <button className="ghost-button" onClick={() => setPage("my")}>
              Login
            </button>
          )}
        </div>
      </header>

      <div className="nav-search-row">
        <nav className="page-nav">
          {PAGES.map((item) => (
            <button
              key={item.key}
              className={page === item.key ? "active" : ""}
              onClick={() => setPage(item.key)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="symbol-toolbar">
          <input
            value={symbolDraft}
            placeholder="Symbol, e.g. BTC-KRW"
            onChange={(event) => setSymbolDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                openSymbol(symbolDraft);
              }
            }}
          />
          <button className="primary-button" onClick={() => openSymbol(symbolDraft)}>
            Search
          </button>
        </div>
      </div>

      {error ? <div className="alert">{error}</div> : null}

      {page === "coin" || page === "us" || page === "korea" ? (
        <MarketPage
          data={marketData[page]}
          range={marketRanges[page]}
          onRange={(range) => changeMarketRange(page, range)}
          onOpenSymbol={openSymbol}
        />
      ) : null}

      {page === "symbol" ? (
        <SymbolDetail
          data={symbolDetail}
          activeTab={symbolTab}
          range={symbolRange}
          onTab={setSymbolTab}
          onRange={changeSymbolRange}
          onOpenSymbol={openSymbol}
          onSaveMapping={saveFinancialMapping}
        />
      ) : null}

      {page === "my" ? (
        user ? (
          <MyPage
            user={user}
            portfolio={portfolio}
            busy={busy}
            newSymbol={newSymbol}
            newCurrency={newCurrency}
            activeTrade={activeTrade}
            quantity={quantity}
            price={price}
            activeTab={myTab}
            alertSymbol={alertSymbol}
            alertDirection={alertDirection}
            alertTarget={alertTarget}
            profileDraft={profileDraft}
            setNewSymbol={setNewSymbol}
            setNewCurrency={setNewCurrency}
            setActiveTrade={setActiveTrade}
            setQuantity={setQuantity}
            setPrice={setPrice}
            setActiveTab={setMyTab}
            setAlertSymbol={setAlertSymbol}
            setAlertDirection={setAlertDirection}
            setAlertTarget={setAlertTarget}
            setProfileDraft={setProfileDraft}
            submitTrade={submitTrade}
            submitAlert={submitAlert}
            patchPortfolio={patchPortfolio}
          />
        ) : (
          <AuthPanel
            mode={authMode}
            credentials={credentials}
            busy={busy}
            onMode={setAuthMode}
            onCredentials={setCredentials}
            onSubmit={submitAuth}
          />
        )
      ) : null}
      </main>
    </div>
  );
}

function Sidebar({
  user,
  portfolio,
  symbolDraft,
  benchmark,
  historyYears,
  rollingWindow,
  authMode,
  credentials,
  busy,
  settingsBusy,
  onSymbolDraft,
  onBenchmark,
  onHistoryYears,
  onRollingWindow,
  onAuthMode,
  onCredentials,
  onSubmitAuth,
  onConfirmSettings,
  onOpenSymbol,
  onGoMyPage,
  onLogout
}: {
  user: User | null;
  portfolio: PortfolioResponse | null;
  symbolDraft: string;
  benchmark: string;
  historyYears: number;
  rollingWindow: number;
  authMode: "login" | "register";
  credentials: { username: string; password: string; displayName: string; email: string };
  busy: boolean;
  settingsBusy: boolean;
  onSymbolDraft: (value: string) => void;
  onBenchmark: (value: string) => void;
  onHistoryYears: (value: number) => void;
  onRollingWindow: (value: number) => void;
  onAuthMode: (mode: "login" | "register") => void;
  onCredentials: (value: { username: string; password: string; displayName: string; email: string }) => void;
  onSubmitAuth: (event: FormEvent<HTMLFormElement>) => void;
  onConfirmSettings: () => void;
  onOpenSymbol: (value: string) => void;
  onGoMyPage: () => void;
  onLogout: () => void;
}) {
  const currency = portfolio?.summary.currency || "KRW";
  const candidates = buildSearchCandidates(symbolDraft);
  return (
    <aside className="side-panel">
      <section className="side-section">
        <h2>Login</h2>
        <p className="muted">{user ? user.displayName : "Not signed in"}</p>
      </section>

      {user && portfolio ? (
        <section className="side-section side-summary">
          <MiniMetric label="Current Wealth" value={formatMoney(portfolio.summary.currentValue, currency)} />
          <MiniMetric label="Total Investment" value={formatMoney(portfolio.summary.costBasis, currency)} />
          <MiniMetric label="Total Gain/Loss" value={formatMoney(portfolio.summary.unrealizedGainLoss, currency)} tone={signedClass(portfolio.summary.unrealizedGainLoss)} />
          <MiniMetric label="Total Return" value={formatPct(portfolio.summary.totalReturnPct)} tone={signedClass(portfolio.summary.totalReturnPct)} />
          <button className="ghost-button" onClick={onGoMyPage}>My Page</button>
          <button className="ghost-button" onClick={onLogout}>Logout</button>
        </section>
      ) : (
        <section className="side-section">
          <form className="side-auth-form" onSubmit={onSubmitAuth}>
            <label>
              ID
              <input
                value={credentials.username}
                onChange={(event) => onCredentials({ ...credentials, username: event.target.value })}
                autoComplete="username"
                required
              />
            </label>
            <label>
              PW
              <input
                type="password"
                value={credentials.password}
                onChange={(event) => onCredentials({ ...credentials, password: event.target.value })}
                autoComplete={authMode === "login" ? "current-password" : "new-password"}
                required
              />
            </label>
            {authMode === "register" ? (
              <>
                <label>
                  Display name
                  <input value={credentials.displayName} onChange={(event) => onCredentials({ ...credentials, displayName: event.target.value })} />
                </label>
                <label>
                  Email
                  <input type="email" value={credentials.email} onChange={(event) => onCredentials({ ...credentials, email: event.target.value })} />
                </label>
              </>
            ) : null}
            <button className="primary-button" disabled={busy}>
              {busy ? "Working..." : authMode === "login" ? "Login" : "Create account"}
            </button>
            <button type="button" className="ghost-button" onClick={() => onAuthMode(authMode === "login" ? "register" : "login")}>
              {authMode === "login" ? "Create account" : "Use existing account"}
            </button>
          </form>
          <button className="ghost-button" onClick={onGoMyPage}>Open My Page</button>
        </section>
      )}

      <section className="side-section">
        <h2>Search</h2>
        <label>
          Symbol
          <input
            value={symbolDraft}
            onChange={(event) => onSymbolDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                onOpenSymbol(symbolDraft);
              }
            }}
          />
        </label>
        <div className="candidate-list">
          {candidates.map((candidate) => (
            <button key={candidate} className="mini-ghost" onClick={() => onOpenSymbol(candidate)}>
              {candidate}
            </button>
          ))}
        </div>
      </section>

      <section className="side-section">
        <h2>Settings</h2>
        <label>
          Benchmark
          <input value={benchmark} onChange={(event) => onBenchmark(event.target.value.toUpperCase())} />
        </label>
        <label>
          History window in years
          <input type="number" min="1" max="20" value={historyYears} onChange={(event) => onHistoryYears(Number(event.target.value))} />
        </label>
        <label>
          Rolling beta window in months
          <input type="number" min="6" max="60" value={rollingWindow} onChange={(event) => onRollingWindow(Number(event.target.value))} />
        </label>
        <button className="primary-button" onClick={onConfirmSettings} disabled={settingsBusy}>
          {settingsBusy ? "Applying..." : "Confirm"}
        </button>
      </section>
    </aside>
  );
}

function buildSearchCandidates(query: string) {
  const normalized = query.trim().toUpperCase();
  const universe = [
    "AAPL",
    "MSFT",
    "NVDA",
    "TSLA",
    "SPY",
    "QQQ",
    "BTC-KRW",
    "ETH-KRW",
    "SOL-KRW",
    "XRP-KRW",
    "OP-KRW",
    "WLD-KRW",
    "RENDER-KRW",
    "005930.KS",
    "000660.KS"
  ];
  const matches = normalized ? universe.filter((symbol) => symbol.includes(normalized)).slice(0, 8) : universe.slice(0, 6);
  return matches.includes(normalized) || !normalized ? matches : [normalized, ...matches].slice(0, 8);
}

function MarketPage({
  data,
  range,
  onRange,
  onOpenSymbol
}: {
  data?: MarketPageResponse;
  range: ChartRange;
  onRange: (range: ChartRange) => void;
  onOpenSymbol: (symbol: string) => void;
}) {
  if (!data) {
    return <div className="loading-panel">Loading market page...</div>;
  }

  return (
    <>
      <section className="panel hero-panel">
        <div className="panel-heading">
          <div>
            <h2>{data.representative.name}</h2>
          </div>
          <QuotePill quote={data.representative.quote} showSymbol={false} />
        </div>
        <TimeRangeSelector ranges={MARKET_CHART_RANGES} active={range} onChange={onRange} />
        <LineChart points={data.representative.chart} currency={data.representative.quote.currency} range={range} />
      </section>

      <section className="panel indices-panel">
        <div className="panel-heading">
          <div>
            <h2>Major Indices</h2>
          </div>
        </div>
        <div className="index-strip-grid">
          {data.indices.map((quote) => (
            <button key={quote.symbol} className="index-metric" onClick={() => onOpenSymbol(quote.symbol)}>
              <span className="index-metric-label">{displayIndexLabel(quote.symbol)}</span>
              <strong className="index-metric-value">{formatMoney(quote.price, quote.currency)}</strong>
              <IndexDeltaPill value={quote.changePct} />
            </button>
          ))}
        </div>
      </section>

      <MacroPanel points={data.macro} />

      <section className="market-movers-grid">
        <MoverTable title="Trading Value" rows={data.movers.tradingValue} onOpenSymbol={onOpenSymbol} />
        <MoverTable title="Volume" rows={data.movers.volume} onOpenSymbol={onOpenSymbol} />
        <MoverTable title="Largest Up Move" rows={data.movers.gainers} onOpenSymbol={onOpenSymbol} />
        <MoverTable title="Largest Down Move" rows={data.movers.losers} onOpenSymbol={onOpenSymbol} />
      </section>
    </>
  );
}

function SymbolDetail({
  data,
  activeTab,
  range,
  onTab,
  onRange,
  onOpenSymbol,
  onSaveMapping
}: {
  data: SymbolDetailResponse | null;
  activeTab: "overview" | "financials" | "price" | "provider";
  range: ChartRange;
  onTab: (tab: "overview" | "financials" | "price" | "provider") => void;
  onRange: (range: ChartRange) => void;
  onOpenSymbol: (symbol: string) => void;
  onSaveMapping: (candidate: MappingCandidate, lineKey: string) => Promise<void>;
}) {
  if (!data) {
    return <div className="loading-panel">Search a symbol to load detail.</div>;
  }
  const mappingOptions = financialMappingOptions(data.statements);

  return (
    <>
      <section className="summary-grid">
        <SummaryCard label="Current Price" value={formatMoney(data.quote.price, data.quote.currency)} tone={signedClass(data.quote.changePct)} />
        <SummaryCard label="Previous Close" value={formatMoney(data.quote.previousClose, data.quote.currency)} />
        <SummaryCard label="1M Return" value={formatPct(data.metrics.avgReturnPct)} tone={signedClass(data.metrics.avgReturnPct)} />
        <SummaryCard label="1M Volatility" value={formatPct(data.metrics.volatilityPct)} />
      </section>

      <BenchmarkComparisonPanel
        rows={data.benchmark.comparisons}
        industry={data.statements.ratioIndustry}
        benchmark={data.benchmark.symbol}
        rollingWindow={data.benchmark.rollingWindowMonths}
      />

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>
              {data.profile.name} <span className="muted">({data.symbol})</span>
            </h2>
            <p className="muted">
              {data.profile.sector || "N/A"} · {data.profile.industry || "N/A"} · {data.profile.country || "N/A"}
            </p>
          </div>
          <QuotePill quote={data.quote} />
        </div>
        <TimeRangeSelector label="Bar range" ranges={SYMBOL_BAR_RANGES} active={range} onChange={onRange} />
        <PriceBarChart points={data.chart} currency={data.quote.currency} range={range} />
      </section>

      <HistoricalAnalyticsCharts data={data} />

      <nav className="subtabs">
        {[
          ["overview", "Companies & Industries"],
          ["financials", "Financial Statements"],
          ["price", "Price"],
          ["provider", "Realtime Provider Notes"]
        ].map(([key, label]) => (
          <button key={key} className={activeTab === key ? "active" : ""} onClick={() => onTab(key as typeof activeTab)}>
            {label}
          </button>
        ))}
      </nav>

      {activeTab === "overview" ? (
        <section className="two-column">
          <article className="panel">
        <div className="panel-heading">
          <div>
            <h2>Company Profile</h2>
          </div>
        </div>
            <div className="profile-facts">
              <MiniMetric label="Sector" value={data.profile.sector || "N/A"} />
              <MiniMetric label="Industry" value={data.profile.industry || "N/A"} />
              <MiniMetric label="Country" value={data.profile.country || "N/A"} />
              <MiniMetric label="Website" value={data.profile.website || "N/A"} />
            </div>
            <p className="profile-copy">{data.profile.summary || "Company profile data is unavailable for this symbol."}</p>
          </article>
          <article className="panel">
        <div className="panel-heading">
          <div>
            <h2>Sector Watchlist Candidates</h2>
          </div>
        </div>
            <div className="table-wrap peer-table-wrap">
              <table className="peer-table">
                <thead>
                  <tr>
                    <th className="text-cell">Symbol</th>
                    <th className="text-cell">Company</th>
                    <th className="text-cell">Industry</th>
                    <th className="number-cell">Price</th>
                    <th className="number-cell">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {data.peers.map((quote) => (
                    <tr key={quote.symbol} className="click-row" onClick={() => onOpenSymbol(quote.symbol)}>
                      <td className="text-cell strong">{quote.symbol}</td>
                      <td className="text-cell">{quote.name || quote.symbol}</td>
                      <td className="text-cell">{quote.industry || quote.sector || "N/A"}</td>
                      <td className="number-cell">{formatMoney(quote.price, quote.currency)}</td>
                      <td className={`number-cell ${signedClass(quote.changePct)}`}>{formatPct(quote.changePct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        </section>
      ) : null}

      {activeTab === "financials" ? (
        <section className="financial-panels">
          <FinancialDataNotes
            source={data.statements.dataSource}
            notes={data.statements.dataNotes}
            candidates={data.statements.mappingCandidates}
            mappingOptions={mappingOptions}
            onSaveMapping={onSaveMapping}
          />
          <FinancialPositionPanel statement={data.statements.balance} />
          <IncomeStatementPanel statement={data.statements.income} />
          <CashflowPanel statement={data.statements.cashflow} />
          <FinancialRatioPanel rows={data.statements.ratios} industry={data.statements.ratioIndustry} peerCount={data.statements.ratioPeerCount} />
        </section>
      ) : null}

      {activeTab === "price" ? (
        <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Price Snapshot</h2>
          </div>
        </div>
          <div className="quote-grid">
            <SummaryCard label="High" value={formatMoney(data.metrics.high, data.quote.currency)} />
            <SummaryCard label="Low" value={formatMoney(data.metrics.low, data.quote.currency)} />
            <SummaryCard label="Volume" value={formatCompact(data.metrics.volume)} />
            <SummaryCard label="Updated" value={new Date(data.refreshedAt).toLocaleTimeString()} />
          </div>
        </section>
      ) : null}

      {activeTab === "provider" ? (
        <section className="panel provider-notes">
          <h2>Speed hierarchy</h2>
          <p>Direct exchange or licensed WebSocket feeds are fastest. This app keeps crypto KRW prices fast through the Fly.io Upbit worker and Supabase cache.</p>
          <p>US and Korea stocks currently use Yahoo chart endpoints as the practical free fallback. For production-grade low latency, use a licensed stock provider.</p>
        </section>
      ) : null}
    </>
  );
}

function BenchmarkComparisonPanel({
  rows,
  industry,
  benchmark,
  rollingWindow
}: {
  rows: SymbolDetailResponse["benchmark"]["comparisons"];
  industry: string;
  benchmark: string;
  rollingWindow: number;
}) {
  return (
    <section className="panel benchmark-comparison-panel">
      <div className="panel-heading">
        <div>
          <h2>
            Valuation & Risk Comparison
            <span className="comparison-benchmark">Benchmark: {benchmark} · Rolling Window: {rollingWindow}M</span>
          </h2>
        </div>
      </div>
      <div className="table-wrap">
        <table className="comparison-table">
          <thead>
            <tr>
              <th className="text-cell">Metric</th>
              <th className="number-cell">Company</th>
              <th className="number-cell">{industry || "Sector"} Average</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.metric}>
                <td className="text-cell strong">{row.metric}</td>
                <td className="number-cell">{row.company}</td>
                <td className="number-cell">{row.industryAverage}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function HistoricalAnalyticsCharts({ data }: { data: SymbolDetailResponse }) {
  return (
    <section className="historical-analytics">
      <article className="panel">
        <div className="panel-heading">
          <div>
            <h2>Monthly Log Return</h2>
          </div>
        </div>
        <MetricLineChart points={data.benchmark.monthlyLogReturns} yLabel="Monthly Log Return (%)" />
      </article>
      <article className="panel">
        <div className="panel-heading">
          <div>
            <h2>Monthly Volatility and Rolling Beta</h2>
          </div>
        </div>
        <RiskLineChart points={data.benchmark.monthlyRisk} rollingWindow={data.benchmark.rollingWindowMonths} />
      </article>
    </section>
  );
}

function historicalXTicks(points: Array<{ time: string }>, targetTickCount = 10) {
  if (!points.length) {
    return [];
  }
  const lastIndex = points.length - 1;
  const step = Math.max(1, Math.ceil(lastIndex / targetTickCount));
  const indexes = new Set<number>();
  for (let index = 0; index <= lastIndex; index += step) {
    indexes.add(index);
  }
  if (lastIndex > 0 && !indexes.has(lastIndex) && lastIndex - Math.max(...indexes) > step * 0.65) {
    indexes.add(lastIndex);
  }
  return Array.from(indexes)
    .sort((a, b) => a - b)
    .map((index) => ({ point: points[index], index }));
}

function formatHistoricalTick(time: string) {
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) {
    return time.slice(0, 7);
  }
  return String(date.getUTCFullYear());
}

function finiteValues(values: Array<number | null | undefined>) {
  return values.filter((value): value is number => value !== null && value !== undefined && Number.isFinite(value));
}

function chartExtent(values: number[]) {
  if (!values.length) {
    return { min: -1, max: 1 };
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || Math.max(Math.abs(max), 1);
  const padding = span * 0.12;
  return { min: min - padding, max: max + padding };
}

function axisTicks(min: number, max: number, count = 5) {
  if (max === min) {
    return [min];
  }
  return Array.from({ length: count }, (_, index) => min + ((max - min) * index) / (count - 1));
}

function metricPath<T>(
  points: T[],
  value: (point: T) => number | null | undefined,
  x: (index: number) => number,
  y: (value: number) => number
) {
  let started = false;
  return points
    .map((point, index) => {
      const current = value(point);
      if (current === null || current === undefined || !Number.isFinite(current)) {
        started = false;
        return "";
      }
      const command = started ? "L" : "M";
      started = true;
      return `${command} ${x(index).toFixed(2)} ${y(current).toFixed(2)}`;
    })
    .filter(Boolean)
    .join(" ");
}

function MetricLineChart({ points, yLabel }: { points: SymbolDetailResponse["benchmark"]["monthlyLogReturns"]; yLabel: string }) {
  const width = 1280;
  const height = 320;
  const margin = { top: 24, right: 42, bottom: 58, left: 88 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const values = finiteValues(points.map((point) => point.value));
  const { min, max } = chartExtent(values);
  const x = (index: number) => margin.left + (points.length <= 1 ? 0 : (index / (points.length - 1)) * plotWidth);
  const y = (value: number) => margin.top + ((max - value) / (max - min || 1)) * plotHeight;
  const ticks = historicalXTicks(points);
  const path = metricPath(points, (point) => point.value, x, y);

  if (!values.length) {
    return <div className="empty-cell chart-empty">Monthly history is unavailable for this symbol.</div>;
  }

  return (
    <div className="chart-shell historical-chart-shell">
      <svg viewBox={`0 0 ${width} ${height}`} role="img">
        {axisTicks(min, max).map((tick) => (
          <g key={tick}>
            <line className="chart-grid-line" x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} />
            <text className="chart-axis-label" x={margin.left - 18} y={y(tick) + 4} textAnchor="end">
              {tick.toFixed(1)}
            </text>
          </g>
        ))}
        {ticks.map((tick) => (
          <text key={`${tick.index}-${tick.point.time}`} className="chart-axis-label" x={x(tick.index)} y={height - 28} textAnchor="middle">
            {formatHistoricalTick(tick.point.time)}
          </text>
        ))}
        <text className="chart-axis-title" x={width / 2} y={height - 8} textAnchor="middle">
          Month
        </text>
        <text className="chart-axis-title blue-axis" x={18} y={height / 2} textAnchor="middle" transform={`rotate(-90 18 ${height / 2})`}>
          {yLabel}
        </text>
        <path d={path} fill="none" stroke="#2563eb" strokeWidth="2.4" />
      </svg>
    </div>
  );
}

function RiskLineChart({
  points,
  rollingWindow
}: {
  points: SymbolDetailResponse["benchmark"]["monthlyRisk"];
  rollingWindow: number;
}) {
  const width = 1280;
  const height = 340;
  const margin = { top: 26, right: 88, bottom: 58, left: 88 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const betaValues = finiteValues(points.map((point) => point.rollingBeta));
  const volatilityValues = finiteValues(points.map((point) => point.monthlyVolatilityPct));
  const betaExtent = chartExtent(betaValues);
  const rawVolatilityExtent = chartExtent(volatilityValues);
  const volatilityExtent = { min: Math.max(0, rawVolatilityExtent.min), max: rawVolatilityExtent.max };
  const x = (index: number) => margin.left + (points.length <= 1 ? 0 : (index / (points.length - 1)) * plotWidth);
  const betaY = (value: number) => margin.top + ((betaExtent.max - value) / (betaExtent.max - betaExtent.min || 1)) * plotHeight;
  const volatilityY = (value: number) =>
    margin.top + ((volatilityExtent.max - value) / (volatilityExtent.max - volatilityExtent.min || 1)) * plotHeight;
  const ticks = historicalXTicks(points);
  const betaPath = metricPath(points, (point) => point.rollingBeta, x, betaY);
  const volatilityPath = metricPath(points, (point) => point.monthlyVolatilityPct, x, volatilityY);

  if (!betaValues.length && !volatilityValues.length) {
    return <div className="empty-cell chart-empty">Risk history is unavailable for this symbol.</div>;
  }

  return (
    <div className="chart-shell historical-chart-shell">
      <svg viewBox={`0 0 ${width} ${height}`} role="img">
        {axisTicks(betaExtent.min, betaExtent.max).map((tick) => (
          <g key={tick}>
            <line className="chart-grid-line" x1={margin.left} x2={width - margin.right} y1={betaY(tick)} y2={betaY(tick)} />
            <text className="chart-axis-label" x={margin.left - 18} y={betaY(tick) + 4} textAnchor="end">
              {tick.toFixed(1)}
            </text>
          </g>
        ))}
        {axisTicks(volatilityExtent.min, volatilityExtent.max).map((tick) => (
          <text key={tick} className="chart-axis-label" x={width - margin.right + 18} y={volatilityY(tick) + 4} textAnchor="start">
            {tick.toFixed(1)}
          </text>
        ))}
        {ticks.map((tick) => (
          <text key={`${tick.index}-${tick.point.time}`} className="chart-axis-label" x={x(tick.index)} y={height - 28} textAnchor="middle">
            {formatHistoricalTick(tick.point.time)}
          </text>
        ))}
        <text className="chart-axis-title" x={width / 2} y={height - 8} textAnchor="middle">
          Month
        </text>
        <text className="chart-axis-title" x={18} y={height / 2} textAnchor="middle" transform={`rotate(-90 18 ${height / 2})`}>
          Rolling Beta ({rollingWindow}M)
        </text>
        <text className="chart-axis-title red-axis" x={width - 18} y={height / 2} textAnchor="middle" transform={`rotate(90 ${width - 18} ${height / 2})`}>
          Monthly Volatility (%)
        </text>
        <path d={betaPath} fill="none" stroke="#16a34a" strokeWidth="2.4" />
        <path d={volatilityPath} fill="none" stroke="#dc2626" strokeWidth="2.4" />
        <g className="chart-legend">
          <line x1={width - 228} x2={width - 202} y1={margin.top + 4} y2={margin.top + 4} stroke="#16a34a" strokeWidth="2.4" />
          <text x={width - 194} y={margin.top + 9}>Rolling Beta</text>
          <line x1={width - 112} x2={width - 86} y1={margin.top + 4} y2={margin.top + 4} stroke="#dc2626" strokeWidth="2.4" />
          <text x={width - 78} y={margin.top + 9}>Volatility</text>
        </g>
      </svg>
    </div>
  );
}

function financialMappingOptions(statements: SymbolDetailResponse["statements"]): MappingOption[] {
  return [
    ...statements.balance.lines.map((line) => ({
      statement: "Financial Position Statement",
      lineKey: line.key,
      label: `${line.label}`
    })),
    ...statements.income.lines.map((line) => ({
      statement: "Income Statement",
      lineKey: line.key,
      label: `${line.label}`
    })),
    ...statements.cashflow.lines.map((line) => ({
      statement: "Cashflow Statement",
      lineKey: line.key,
      label: `${line.label}`
    }))
  ];
}

function candidateKey(candidate: MappingCandidate) {
  return [candidate.statementDiv, candidate.accountId, candidate.accountName].join("|");
}

function FinancialDataNotes({
  source,
  notes,
  candidates,
  mappingOptions,
  onSaveMapping
}: {
  source: string;
  notes: string[];
  candidates: SymbolDetailResponse["statements"]["mappingCandidates"];
  mappingOptions: MappingOption[];
  onSaveMapping: (candidate: MappingCandidate, lineKey: string) => Promise<void>;
}) {
  const [mappingTargets, setMappingTargets] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState("");
  if (!notes.length && !candidates.length) {
    return null;
  }
  const optionsForCandidate = (candidate: MappingCandidate) => {
    const sameStatement = mappingOptions.filter((option) => option.statement === candidate.statement);
    return sameStatement.length ? sameStatement : mappingOptions;
  };
  return (
    <section className="panel financial-data-notes">
      <strong>{source}</strong>
      {notes.map((note) => (
        <p key={note}>{note}</p>
      ))}
      {candidates.length ? (
        <div className="mapping-candidate-wrap">
          <h3>Mapping Required</h3>
          <div className="table-wrap">
            <table className="mapping-candidate-table">
              <thead>
                <tr>
                  <th className="text-cell">Statement</th>
                  <th className="text-cell">OpenDART Account</th>
                  <th className="text-cell">Account ID</th>
                  <th className="number-cell">Sample Value</th>
                  <th className="text-cell">Years</th>
                  <th className="text-cell">Map To</th>
                  <th className="text-cell">Action</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((candidate) => {
                  const key = candidateKey(candidate);
                  const options = optionsForCandidate(candidate);
                  const selectedLineKey = mappingTargets[key] || "";
                  const isSaving = savingKey === key;
                  return (
                    <tr key={key}>
                      <td className="text-cell">{candidate.statement}</td>
                      <td className="text-cell strong">{candidate.accountName}</td>
                      <td className="text-cell">{candidate.accountId || "N/A"}</td>
                      <td className="number-cell">{candidate.sampleValue}</td>
                      <td className="text-cell">{candidate.years.join(", ")}</td>
                      <td className="text-cell">
                        <select
                          className="mapping-target-select"
                          value={selectedLineKey}
                          onChange={(event) => setMappingTargets((prev) => ({ ...prev, [key]: event.target.value }))}
                        >
                          <option value="">Select line item</option>
                          {options.map((option) => (
                            <option key={`${option.statement}-${option.lineKey}`} value={option.lineKey}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="text-cell">
                        <button
                          className="mini-ghost"
                          disabled={!selectedLineKey || isSaving}
                          onClick={async () => {
                            setSavingKey(key);
                            try {
                              await onSaveMapping(candidate, selectedLineKey);
                            } finally {
                              setSavingKey("");
                            }
                          }}
                        >
                          {isSaving ? "Saving" : "Save"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function MyPage({
  user,
  portfolio,
  busy,
  newSymbol,
  newCurrency,
  activeTrade,
  quantity,
  price,
  activeTab,
  alertSymbol,
  alertDirection,
  alertTarget,
  profileDraft,
  setNewSymbol,
  setNewCurrency,
  setActiveTrade,
  setQuantity,
  setPrice,
  setActiveTab,
  setAlertSymbol,
  setAlertDirection,
  setAlertTarget,
  setProfileDraft,
  submitTrade,
  submitAlert,
  patchPortfolio
}: {
  user: User;
  portfolio: PortfolioResponse | null;
  busy: boolean;
  newSymbol: string;
  newCurrency: string;
  activeTrade: { symbol: string; mode: TradeMode } | null;
  quantity: string;
  price: string;
  activeTab: MyTab;
  alertSymbol: string;
  alertDirection: "above" | "below";
  alertTarget: string;
  profileDraft: { displayName: string; email: string };
  setNewSymbol: (value: string) => void;
  setNewCurrency: (value: string) => void;
  setActiveTrade: (value: { symbol: string; mode: TradeMode } | null) => void;
  setQuantity: (value: string) => void;
  setPrice: (value: string) => void;
  setActiveTab: (value: MyTab) => void;
  setAlertSymbol: (value: string) => void;
  setAlertDirection: (value: "above" | "below") => void;
  setAlertTarget: (value: string) => void;
  setProfileDraft: (value: { displayName: string; email: string }) => void;
  submitTrade: (symbol: string, mode: TradeMode, currency: string) => void;
  submitAlert: () => void;
  patchPortfolio: (body: Record<string, unknown>) => Promise<PortfolioResponse | null>;
}) {
  const rows = portfolio?.rows || [];
  const transactions = portfolio?.transactions || [];
  const summaryCurrency = portfolio?.summary.currency || "KRW";
  const newSymbolNormalized = newSymbol.trim().toUpperCase();

  function startTrade(row: PortfolioRow, mode: TradeMode) {
    setActiveTrade({ symbol: row.symbol, mode });
    setQuantity("");
    setPrice(row.price ? String(row.price) : "");
  }

  return (
    <>
      <nav className="subtabs my-tabs">
        {[
          ["portfolio", "Portfolio"],
          ["alerts", "Price Alerts"],
          ["account", "Account"]
        ].map(([key, label]) => (
          <button key={key} className={activeTab === key ? "active" : ""} onClick={() => setActiveTab(key as MyTab)}>
            {label}
          </button>
        ))}
      </nav>

      {portfolio?.triggeredAlerts.length ? <AlertBanner alerts={portfolio.triggeredAlerts} /> : null}

      {activeTab === "portfolio" ? (
        <>
          <PortfolioAnalytics rows={rows} portfolio={portfolio} currency={summaryCurrency} />
          <section className="summary-grid">
            <SummaryCard label="Current Value" value={formatMoney(portfolio?.summary.currentValue, summaryCurrency)} />
            <SummaryCard label="Cost Basis" value={formatMoney(portfolio?.summary.costBasis, summaryCurrency)} />
            <SummaryCard
              label="Cumulative Gain/Loss"
              value={formatMoney(portfolio?.summary.cumulativeGainLoss, summaryCurrency)}
              tone={signedClass(portfolio?.summary.cumulativeGainLoss)}
            />
            <SummaryCard
              label="Cumulative Return"
              value={formatPct(portfolio?.summary.cumulativeReturnPct)}
              tone={signedClass(portfolio?.summary.cumulativeReturnPct)}
            />
          </section>

          <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Current Portfolio</h2>
          </div>
          <div className="add-position">
            <input placeholder="Symbol, e.g. BTC-KRW" value={newSymbol} onChange={(event) => setNewSymbol(event.target.value)} />
            <select value={newCurrency} onChange={(event) => setNewCurrency(event.target.value)}>
              <option value="KRW">KRW</option>
              <option value="USD">USD</option>
            </select>
            <button
              className="buy-button"
              disabled={!newSymbolNormalized}
              onClick={() => {
                setActiveTrade({ symbol: newSymbolNormalized, mode: "BUY" });
                setQuantity("");
                setPrice("");
              }}
            >
              Buy
            </button>
          </div>
        </div>
        <PortfolioTable
          rows={rows}
          activeTrade={activeTrade}
          quantity={quantity}
          price={price}
          newCurrency={newCurrency}
          busy={busy}
          onStartTrade={startTrade}
          onQuantity={setQuantity}
          onPrice={setPrice}
          onCancel={() => setActiveTrade(null)}
          onSubmit={submitTrade}
        />
          </section>

          <TransactionPanel transactions={transactions} currency={summaryCurrency} />
        </>
      ) : null}

      {activeTab === "alerts" ? (
        <PriceAlertsPanel
          alerts={portfolio?.alerts || []}
          symbol={alertSymbol}
          direction={alertDirection}
          target={alertTarget}
          busy={busy}
          onSymbol={setAlertSymbol}
          onDirection={setAlertDirection}
          onTarget={setAlertTarget}
          onSubmit={submitAlert}
          onToggle={(alertId) => patchPortfolio({ action: "toggle_alert", alertId })}
          onDelete={(alertId) => patchPortfolio({ action: "delete_alert", alertId })}
        />
      ) : null}

      {activeTab === "account" ? (
        <AccountPanel
          user={user}
          draft={profileDraft}
          busy={busy}
          onDraft={setProfileDraft}
          onSave={() => patchPortfolio({ action: "update_profile", displayName: profileDraft.displayName, email: profileDraft.email })}
        />
      ) : null}
    </>
  );
}

function AlertBanner({ alerts }: { alerts: PortfolioResponse["triggeredAlerts"] }) {
  return (
    <section className="alert triggered-alerts">
      {alerts.map((alert) => (
        <div key={alert.id}>
          <strong>{alert.symbol}</strong> is {alert.direction === "above" ? "at or above" : "at or below"} {formatMoney(alert.target_price, alert.currency)}.
          Last price: {formatMoney(alert.price, alert.currency)}
        </div>
      ))}
    </section>
  );
}

function PortfolioAnalytics({
  rows,
  portfolio,
  currency
}: {
  rows: PortfolioRow[];
  portfolio: PortfolioResponse | null;
  currency: string;
}) {
  const projection = portfolio?.projection;
  return (
    <section className="portfolio-analytics">
      <article className="allocation-panel">
        <h2>Portfolio Allocation</h2>
        <AllocationDonut rows={rows} currency={currency} />
      </article>
      <article className="portfolio-card-stack">
        <h2>Portfolio Summary</h2>
        <MiniMetric label="Current Wealth" value={formatMoney(portfolio?.summary.currentValue, currency)} />
        <MiniMetric label="Total Investment Value" value={formatMoney(portfolio?.summary.costBasis, currency)} />
        <MiniMetric
          label="Total Gain/Loss"
          value={formatMoney(portfolio?.summary.unrealizedGainLoss, currency)}
          tone={signedClass(portfolio?.summary.unrealizedGainLoss)}
        />
        <MiniMetric
          label="Total Return"
          value={formatPct(portfolio?.summary.totalReturnPct)}
          tone={signedClass(portfolio?.summary.totalReturnPct)}
        />
      </article>
      <article className="portfolio-card-stack">
        <h2>Portfolio Expected Return</h2>
        <MiniMetric label="Portfolio Beta (36M)" value={formatNumber(projection?.portfolioBeta, 4)} />
        <MiniMetric
          label="Monthly Expected Log Return"
          value={formatPct(projection?.expectedMonthlyLogReturnPct)}
          tone={signedClass(projection?.expectedMonthlyLogReturnPct)}
        />
        <MiniMetric label="Expected Portfolio Value" value={formatMoney(projection?.expectedPortfolioValue, currency)} />
        <MiniMetric
          label="Expected Gain/Loss"
          value={formatMoney(projection?.expectedGainLoss, currency)}
          tone={signedClass(projection?.expectedGainLoss)}
        />
      </article>
    </section>
  );
}

function MiniMetric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="mini-metric">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
    </div>
  );
}

function AllocationDonut({ rows, currency }: { rows: PortfolioRow[]; currency: string }) {
  const chartRows = rows.filter((row) => (row.marketValue ?? 0) > 0);
  const total = chartRows.reduce((sum, row) => sum + (row.marketValue ?? 0), 0);
  const colors = ["#0068c9", "#83c9ff", "#ff2b2b", "#ffabab", "#29b09d", "#ff8700", "#6d3fc0", "#00c7b7", "#7f7f7f", "#bcbd22"];
  let offset = 0;
  const circumference = 2 * Math.PI * 54;

  if (!chartRows.length || total <= 0) {
    return <div className="empty-cell">Allocation chart needs at least one position with a current value.</div>;
  }

  return (
    <div className="allocation-layout">
      <svg className="donut-chart" viewBox="0 0 160 160" role="img">
        <circle cx="80" cy="80" r="54" fill="none" stroke="var(--line)" strokeWidth="28" />
        {chartRows.map((row, index) => {
          const value = row.marketValue ?? 0;
          const dash = (value / total) * circumference;
          const segment = (
            <circle
              key={row.symbol}
              cx="80"
              cy="80"
              r="54"
              fill="none"
              stroke={colors[index % colors.length]}
              strokeWidth="28"
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 80 80)"
            />
          );
          offset += dash;
          return segment;
        })}
        <circle cx="80" cy="80" r="34" fill="var(--panel)" />
      </svg>
      <div className="allocation-legend">
        {chartRows.map((row, index) => (
          <div key={row.symbol} className="allocation-legend-item">
            <span className="allocation-legend-swatch" style={{ background: colors[index % colors.length] }}></span>
            <span className="allocation-legend-label">{row.symbol}</span>
            <span className="allocation-legend-value">{formatMoney(row.marketValue, currency)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PriceAlertsPanel({
  alerts,
  symbol,
  direction,
  target,
  busy,
  onSymbol,
  onDirection,
  onTarget,
  onSubmit,
  onToggle,
  onDelete
}: {
  alerts: PriceAlert[];
  symbol: string;
  direction: "above" | "below";
  target: string;
  busy: boolean;
  onSymbol: (value: string) => void;
  onDirection: (value: "above" | "below") => void;
  onTarget: (value: string) => void;
  onSubmit: () => void;
  onToggle: (alertId: string) => void;
  onDelete: (alertId: string) => void;
}) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Price Alerts</h2>
        </div>
        <div className="alert-form">
          <input placeholder="Symbol" value={symbol} onChange={(event) => onSymbol(event.target.value)} />
          <select value={direction} onChange={(event) => onDirection(event.target.value === "below" ? "below" : "above")}>
            <option value="above">At or above</option>
            <option value="below">At or below</option>
          </select>
          <input type="number" min="0" step="any" placeholder="Target price" value={target} onChange={(event) => onTarget(event.target.value)} />
          <button className="primary-button" disabled={busy || !symbol || !target} onClick={onSubmit}>
            Add alert
          </button>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="text-cell">Symbol</th>
              <th className="text-cell">Condition</th>
              <th className="number-cell">Target</th>
              <th className="number-cell">Last Price</th>
              <th className="text-cell">Active</th>
              <th className="text-cell">Triggered At</th>
              <th className="action-cell">Manage</th>
            </tr>
          </thead>
          <tbody>
            {alerts.map((alert) => (
              <tr key={alert.id}>
                <td className="text-cell strong">{alert.symbol}</td>
                <td className="text-cell">{alert.direction === "above" ? "At or above" : "At or below"}</td>
                <td className="number-cell">{formatMoney(alert.target_price, alert.currency || "KRW")}</td>
                <td className="number-cell">{formatMoney(alert.last_price, alert.currency || "KRW")}</td>
                <td className="text-cell">{alert.active ? "Yes" : "No"}</td>
                <td className="text-cell">{alert.last_triggered_at ? new Date(alert.last_triggered_at).toLocaleString() : ""}</td>
                <td className="action-cell">
                  <div className="trade-buttons">
                    <button className="mini-ghost" onClick={() => onToggle(alert.id)}>
                      Enable / Disable
                    </button>
                    <button className="sell-button" onClick={() => onDelete(alert.id)}>
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!alerts.length ? (
              <tr>
                <td className="empty-cell" colSpan={7}>
                  No price alerts yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AccountPanel({
  user,
  draft,
  busy,
  onDraft,
  onSave
}: {
  user: User;
  draft: { displayName: string; email: string };
  busy: boolean;
  onDraft: (value: { displayName: string; email: string }) => void;
  onSave: () => void;
}) {
  return (
    <section className="panel account-panel">
      <div className="panel-heading">
        <div>
          <h2>Account</h2>
        </div>
      </div>
      <div className="account-form">
        <label>
          Display name
          <input value={draft.displayName} onChange={(event) => onDraft({ ...draft, displayName: event.target.value })} />
        </label>
        <label>
          Email
          <input type="email" value={draft.email} onChange={(event) => onDraft({ ...draft, email: event.target.value })} />
        </label>
        <button className="primary-button" disabled={busy} onClick={onSave}>
          Save account
        </button>
      </div>
    </section>
  );
}

function AuthPanel({
  mode,
  credentials,
  busy,
  onMode,
  onCredentials,
  onSubmit
}: {
  mode: "login" | "register";
  credentials: { username: string; password: string; displayName: string; email: string };
  busy: boolean;
  onMode: (mode: "login" | "register") => void;
  onCredentials: (value: { username: string; password: string; displayName: string; email: string }) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <section className="auth-panel compact-auth">
      <div>
        <p className="eyebrow">Account</p>
        <h1>Login required</h1>
        <p className="muted">Market pages are public. My Page uses your Supabase account portfolio.</p>
      </div>
      <form onSubmit={onSubmit} className="auth-form">
        <label>
          Username
          <input
            value={credentials.username}
            onChange={(event) => onCredentials({ ...credentials, username: event.target.value })}
            autoComplete="username"
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={credentials.password}
            onChange={(event) => onCredentials({ ...credentials, password: event.target.value })}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
          />
        </label>
        {mode === "register" ? (
          <>
            <label>
              Display name
              <input value={credentials.displayName} onChange={(event) => onCredentials({ ...credentials, displayName: event.target.value })} />
            </label>
            <label>
              Email
              <input type="email" value={credentials.email} onChange={(event) => onCredentials({ ...credentials, email: event.target.value })} />
            </label>
          </>
        ) : null}
        <button className="primary-button" disabled={busy}>
          {busy ? "Working..." : mode === "login" ? "Login" : "Create account"}
        </button>
        <button type="button" className="ghost-button" onClick={() => onMode(mode === "login" ? "register" : "login")}>
          {mode === "login" ? "Create a new account" : "Use existing account"}
        </button>
      </form>
    </section>
  );
}

function PortfolioTable({
  rows,
  activeTrade,
  quantity,
  price,
  newCurrency,
  busy,
  onStartTrade,
  onQuantity,
  onPrice,
  onCancel,
  onSubmit
}: {
  rows: PortfolioRow[];
  activeTrade: { symbol: string; mode: TradeMode } | null;
  quantity: string;
  price: string;
  newCurrency: string;
  busy: boolean;
  onStartTrade: (row: PortfolioRow, mode: TradeMode) => void;
  onQuantity: (value: string) => void;
  onPrice: (value: string) => void;
  onCancel: () => void;
  onSubmit: (symbol: string, mode: TradeMode, currency: string) => void;
}) {
  return (
    <div className="table-wrap">
      <table className="portfolio-table">
        <thead>
          <tr>
            <th className="text-cell">Symbol</th>
            <th className="number-cell">Quantity</th>
            <th className="number-cell">Average Cost</th>
            <th className="number-cell">Current Price</th>
            <th className="number-cell">Market Value</th>
            <th className="number-cell">Gain/Loss</th>
            <th className="number-cell">Return</th>
            <th className="number-cell">Allocation</th>
            <th className="action-cell">Trade</th>
          </tr>
        </thead>
        <tbody>
          {activeTrade && !rows.some((row) => row.symbol === activeTrade.symbol) ? (
            <TradeOnlyRow
              symbol={activeTrade.symbol}
              currency={newCurrency}
              mode={activeTrade.mode}
              quantity={quantity}
              price={price}
              busy={busy}
              onQuantity={onQuantity}
              onPrice={onPrice}
              onCancel={onCancel}
              onSubmit={() => onSubmit(activeTrade.symbol, activeTrade.mode, newCurrency)}
            />
          ) : null}
          {rows.map((row) => (
            <tr key={row.symbol}>
              <td className="text-cell strong">{row.symbol}</td>
              <td className="number-cell">{numberFormatter.format(row.quantity)}</td>
              <td className="number-cell">{formatMoney(row.avgCost, row.currency)}</td>
              <td className="number-cell">
                <div>{formatMoney(row.price, row.currency)}</div>
                <span className={signedClass(row.changePct)}>{formatPct(row.changePct)}</span>
              </td>
              <td className="number-cell">{formatMoney(row.marketValue, row.currency)}</td>
              <td className={`number-cell ${signedClass(row.gainLoss)}`}>{formatMoney(row.gainLoss, row.currency)}</td>
              <td className={`number-cell ${signedClass(row.gainLossPct)}`}>{formatPct(row.gainLossPct)}</td>
              <td className="number-cell">{formatPct(row.allocationPct)}</td>
              <td className="action-cell">
                {activeTrade?.symbol === row.symbol ? (
                  <InlineTradeForm
                    mode={activeTrade.mode}
                    symbol={row.symbol}
                    currency={row.currency}
                    quantity={quantity}
                    price={price}
                    busy={busy}
                    onQuantity={onQuantity}
                    onPrice={onPrice}
                    onCancel={onCancel}
                    onSubmit={() => onSubmit(row.symbol, activeTrade.mode, row.currency)}
                  />
                ) : (
                  <div className="trade-buttons">
                    <button className="buy-button" onClick={() => onStartTrade(row, "BUY")}>
                      Buy
                    </button>
                    <button className="sell-button" onClick={() => onStartTrade(row, "SELL")}>
                      Sell
                    </button>
                  </div>
                )}
              </td>
            </tr>
          ))}
          {!rows.length && !activeTrade ? (
            <tr>
              <td colSpan={9} className="empty-cell">
                Add a symbol above to start recording trades.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function SummaryCard({ label, value, tone = "neutral" }: { label: string; value: string; tone?: string }) {
  return (
    <article className="summary-card">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
    </article>
  );
}

function QuotePill({ quote, showSymbol = true }: { quote: Quote; showSymbol?: boolean }) {
  return (
    <div className="quote-pill">
      {showSymbol ? <span>{quote.symbol}</span> : null}
      <strong>{formatMoney(quote.price, quote.currency)}</strong>
      <em className={signedClass(quote.changePct)}>{formatPct(quote.changePct)}</em>
    </div>
  );
}

function IndexDeltaPill({ value }: { value: number | null | undefined }) {
  const hasValue = value !== null && value !== undefined && Number.isFinite(value);
  const arrow = hasValue ? (value < 0 ? "\u2193" : "\u2191") : "";
  return (
    <em className={`index-delta ${signedClass(value)}`}>
      {arrow ? <span aria-hidden="true">{arrow}</span> : null}
      {formatPct(value)}
    </em>
  );
}

function TimeRangeSelector({
  label = "Time range",
  ranges,
  active,
  onChange
}: {
  label?: string;
  ranges: ChartRange[];
  active: ChartRange;
  onChange: (range: ChartRange) => void;
}) {
  return (
    <div className="range-control">
      <span>{label}</span>
      <div>
        {ranges.map((range) => (
          <button key={range} className={active === range ? "active" : ""} onClick={() => onChange(range)}>
            {range}
          </button>
        ))}
      </div>
    </div>
  );
}

function validPricePoint(point: ChartPoint) {
  const values = [point.open, point.high, point.low, point.close].filter((value): value is number => value !== null && value !== undefined);
  return point.close > 0 && values.every((value) => Number.isFinite(value) && value > 0);
}

function chartStats(points: ChartPoint[]) {
  const values = points
    .flatMap((point) => [point.low ?? point.close, point.high ?? point.close, point.close])
    .filter((value) => Number.isFinite(value) && value > 0);
  const minRaw = values.length ? Math.min(...values) : 0;
  const maxRaw = values.length ? Math.max(...values) : 1;
  const padding = Math.max((maxRaw - minRaw) * 0.08, Math.abs(maxRaw || 1) * 0.002);
  const min = minRaw - padding;
  const max = maxRaw + padding;
  const span = max - min || 1;
  const ticks = Array.from({ length: 6 }, (_, index) => max - (span / 5) * index);
  return { min, max, span, ticks };
}

function chartXLabel(point: ChartPoint, range: ChartRange) {
  const date = new Date(point.time);
  if (!Number.isFinite(date.getTime())) {
    return "";
  }
  if (range === "1D") {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  if (range === "1Y" || range === "YTD") {
    return date.toLocaleDateString([], { year: "2-digit", month: "2-digit", day: "2-digit" });
  }
  return date.toLocaleDateString([], { month: "2-digit", day: "2-digit" });
}

function chartXTicks(points: ChartPoint[]) {
  if (!points.length) {
    return [];
  }
  const targetTickCount = 8;
  const lastTickIndex = Math.max(0, points.length - 2);
  const step = Math.max(1, Math.ceil(lastTickIndex / targetTickCount));
  const indexes = new Set<number>();
  for (let index = 0; index <= lastTickIndex; index += step) {
    indexes.add(index);
  }
  return Array.from(indexes)
    .sort((a, b) => a - b)
    .map((index) => ({ point: points[index], index }));
}

function chartTickAnchor(tickIndex: number, totalTicks: number) {
  if (tickIndex === 0) {
    return "start";
  }
  if (tickIndex === totalTicks - 1) {
    return "end";
  }
  return "middle";
}

function LineChart({ points, currency, range }: { points: ChartPoint[]; currency: string; range: ChartRange }) {
  const pricePoints = points.filter(validPricePoint);
  const width = 1280;
  const height = 360;
  const margin = { top: 26, right: 28, bottom: 74, left: 142 };
  const xTickY = height - 42;
  const xTitleY = height - 8;
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const { min, span, ticks } = chartStats(pricePoints);
  const xFor = (index: number) => margin.left + (index / Math.max(pricePoints.length - 1, 1)) * innerWidth;
  const yFor = (value: number) => margin.top + innerHeight - ((value - min) / span) * innerHeight;
  const path = pricePoints
    .map((point, index) => `${index === 0 ? "M" : "L"}${xFor(index).toFixed(2)},${yFor(point.close).toFixed(2)}`)
    .join(" ");
  const xTicks = chartXTicks(pricePoints);

  return (
    <div className="chart-shell full-chart">
      {pricePoints.length ? (
        <>
          <svg viewBox={`0 0 ${width} ${height}`} role="img">
            {ticks.map((tick) => (
              <g key={tick}>
                <line x1={margin.left} x2={width - margin.right} y1={yFor(tick)} y2={yFor(tick)} className="chart-grid-line" />
                <text x={margin.left - 18} y={yFor(tick) + 4} className="chart-axis-label" textAnchor="end">
                  {currency === "KRW" ? Math.round(tick).toLocaleString("en-US") : tick.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                </text>
              </g>
            ))}
            {xTicks.map(({ point, index }, tickIndex) => {
              return (
                <text key={`${point.time}-${tickIndex}`} x={xFor(index)} y={xTickY} className="chart-axis-label" textAnchor={chartTickAnchor(tickIndex, xTicks.length)}>
                  {chartXLabel(point, range)}
                </text>
              );
            })}
            <text x={28} y={margin.top + innerHeight / 2} className="chart-axis-title" textAnchor="middle" transform={`rotate(-90 28 ${margin.top + innerHeight / 2})`}>
              Price
            </text>
            <text x={margin.left + innerWidth / 2} y={xTitleY} className="chart-axis-title" textAnchor="middle">
              Time
            </text>
            <path d={path} fill="none" stroke="#2563eb" strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
          </svg>
          <div className="chart-legend">
            <span className="legend-line"></span>
            Price
          </div>
        </>
      ) : (
        <div className="empty-cell">Chart data is unavailable.</div>
      )}
    </div>
  );
}

function PriceBarChart({ points, currency, range }: { points: ChartPoint[]; currency: string; range: ChartRange }) {
  const pricePoints = points.filter(validPricePoint);
  const width = 1280;
  const height = 360;
  const margin = { top: 26, right: 28, bottom: 74, left: 142 };
  const xTickY = height - 42;
  const xTitleY = height - 8;
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const { min, span, ticks } = chartStats(pricePoints);
  const xFor = (index: number) => margin.left + (index / Math.max(pricePoints.length - 1, 1)) * innerWidth;
  const yFor = (value: number) => margin.top + innerHeight - ((value - min) / span) * innerHeight;
  const barWidth = Math.max(3, Math.min(13, innerWidth / Math.max(pricePoints.length, 1) * 0.62));
  const xTicks = chartXTicks(pricePoints);

  return (
    <div className="chart-shell full-chart">
      {pricePoints.length ? (
        <>
          <svg viewBox={`0 0 ${width} ${height}`} role="img">
            {ticks.map((tick) => (
              <g key={tick}>
                <line x1={margin.left} x2={width - margin.right} y1={yFor(tick)} y2={yFor(tick)} className="chart-grid-line" />
                <text x={margin.left - 18} y={yFor(tick) + 4} className="chart-axis-label" textAnchor="end">
                  {currency === "KRW" ? Math.round(tick).toLocaleString("en-US") : tick.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                </text>
              </g>
            ))}
            {pricePoints.map((point, index) => {
              const open = point.open ?? point.close;
              const high = point.high ?? Math.max(open, point.close);
              const low = point.low ?? Math.min(open, point.close);
              const rising = point.close >= open;
              const top = yFor(Math.max(open, point.close));
              const bottom = yFor(Math.min(open, point.close));
              const x = xFor(index);
              return (
                <g key={point.time}>
                  <line x1={x} x2={x} y1={yFor(high)} y2={yFor(low)} stroke={rising ? "#16a34a" : "#dc2626"} strokeWidth="1.4" />
                  <rect
                    x={x - barWidth / 2}
                    y={top}
                    width={barWidth}
                    height={Math.max(1, bottom - top)}
                    fill={rising ? "#16a34a" : "#dc2626"}
                    rx="1"
                  />
                </g>
              );
            })}
            {xTicks.map(({ point, index }, tickIndex) => {
              return (
                <text key={`${point.time}-${tickIndex}`} x={xFor(index)} y={xTickY} className="chart-axis-label" textAnchor={chartTickAnchor(tickIndex, xTicks.length)}>
                  {chartXLabel(point, range)}
                </text>
              );
            })}
            <text x={28} y={margin.top + innerHeight / 2} className="chart-axis-title" textAnchor="middle" transform={`rotate(-90 28 ${margin.top + innerHeight / 2})`}>
              Price
            </text>
            <text x={margin.left + innerWidth / 2} y={xTitleY} className="chart-axis-title" textAnchor="middle">
              Time
            </text>
          </svg>
          <div className="chart-legend">
            <span className="legend-box positive-box"></span>
            Up
            <span className="legend-box negative-box"></span>
            Down
          </div>
        </>
      ) : (
        <div className="empty-cell">Chart data is unavailable.</div>
      )}
    </div>
  );
}

function MacroPanel({ points }: { points: MacroPoint[] }) {
  const countries = Array.from(new Set(points.map((point) => point.country)));
  const [country, setCountry] = useState<MacroPoint["country"]>(countries[0] || "United States");
  const selectedPoints = points.filter((point) => point.country === country);
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Rates and M2</h2>
        </div>
        <select className="macro-country-select" value={country} onChange={(event) => setCountry(event.target.value as MacroPoint["country"])}>
          {countries.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </div>
      <div className="macro-chart-grid">
        <MacroLineChart points={selectedPoints} field="policyRatePct" title={`${country} Policy Rate (%)`} valueSuffix="%" />
        <MacroLineChart points={selectedPoints} field="m2" title={`${country} M2 Liquidity (USD bn)`} valueSuffix="" compact />
      </div>
    </section>
  );
}

function MacroLineChart({
  points,
  field,
  title,
  valueSuffix,
  compact = false
}: {
  points: MacroPoint[];
  field: "policyRatePct" | "m2";
  title: string;
  valueSuffix: string;
  compact?: boolean;
}) {
  const countries = Array.from(new Set(points.map((point) => point.country)));
  const colors = ["#2563eb", "#dc2626", "#16a34a", "#f59e0b", "#7c3aed"];
  const width = 520;
  const height = 250;
  const margin = { top: 18, right: 18, bottom: 42, left: 64 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const values = points.map((point) => point[field]).filter((value): value is number => value !== null && Number.isFinite(value));
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const span = max - min || 1;
  const yFor = (value: number) => margin.top + innerHeight - ((value - min) / span) * innerHeight;
  const years = Array.from(new Set(points.map((point) => point.date.slice(0, 4))));
  const xForYear = (year: string) => margin.left + (years.indexOf(year) / Math.max(years.length - 1, 1)) * innerWidth;
  const ticks = Array.from({ length: 5 }, (_, index) => max - (span / 4) * index);

  return (
    <article className="macro-card">
      <h3>{title}</h3>
      <svg viewBox={`0 0 ${width} ${height}`} role="img">
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={margin.left} x2={width - margin.right} y1={yFor(tick)} y2={yFor(tick)} className="chart-grid-line" />
            <text x={margin.left - 8} y={yFor(tick) + 4} className="chart-axis-label" textAnchor="end">
              {compact ? formatCompact(tick) : `${tick.toFixed(1)}${valueSuffix}`}
            </text>
          </g>
        ))}
        {years.map((year) => (
          <text key={year} x={xForYear(year)} y={height - 14} className="chart-axis-label" textAnchor="middle">
            {year}
          </text>
        ))}
        {countries.map((country, countryIndex) => {
          const countryPoints = points.filter((point) => point.country === country && point[field] !== null);
          const path = countryPoints
            .map((point, index) => `${index === 0 ? "M" : "L"}${xForYear(point.date.slice(0, 4)).toFixed(2)},${yFor(point[field] || 0).toFixed(2)}`)
            .join(" ");
          return <path key={country} d={path} fill="none" stroke={colors[countryIndex % colors.length]} strokeWidth="2.4" vectorEffect="non-scaling-stroke" />;
        })}
      </svg>
      <div className="macro-legend">
        {countries.map((country, index) => (
          <span key={country}>
            <i style={{ background: colors[index % colors.length] }}></i>
            {country}
          </span>
        ))}
      </div>
    </article>
  );
}

function MoverTable({
  title,
  rows,
  onOpenSymbol
}: {
  title: string;
  rows: MarketMoverRow[];
  onOpenSymbol: (symbol: string) => void;
}) {
  const usesKoreaNames = rows.some((row) => Boolean(KOREA_STOCK_NAMES[row.symbol.toUpperCase()]));
  return (
    <section className="panel mover-panel">
      <div className="panel-heading compact-heading">
        <h2>{title}</h2>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="text-cell">{usesKoreaNames ? "Name" : "Symbol"}</th>
              <th className="number-cell">Price</th>
              <th className="number-cell">Change</th>
              <th className="number-cell">Volume</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${title}-${row.symbol}`} onClick={() => onOpenSymbol(row.symbol)} className="click-row">
                <td className="text-cell strong" title={row.symbol}>
                  {displayMarketSymbol(row.symbol)}
                </td>
                <td className="number-cell">{formatMoney(row.price, row.currency)}</td>
                <td className={`number-cell ${signedClass(row.changePct)}`}>{formatPct(row.changePct)}</td>
                <td className="number-cell">{formatCompact(row.volume)}</td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={4} className="empty-cell">
                  No data.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function lineValue(line: FinancialLine | undefined, index: number) {
  return line?.values[index] ?? null;
}

function lineByKey(statement: FinancialStatement, key: string) {
  return statement.lines.find((line) => line.key === key);
}

function FinancialGrid({
  statement,
  children
}: {
  statement: FinancialStatement;
  children: ReactNode;
}) {
  const gridStyle = {
    "--financial-grid-template": `minmax(260px, 1.25fr) repeat(${Math.max(statement.columns.length, 1)}, minmax(132px, 1fr))`
  } as CSSProperties;

  return (
    <div className="financial-grid-wrap">
      <div className="financial-grid" style={gridStyle}>
        <div className="financial-grid-row financial-grid-header">
          <div className="financial-grid-cell financial-grid-label">Line Item</div>
          {statement.columns.map((column) => (
            <div key={column} className="financial-grid-cell">
              {column}
            </div>
          ))}
        </div>
        {children}
      </div>
    </div>
  );
}

function FinancialRow({
  statement,
  line,
  label,
  level = 0,
  className = ""
}: {
  statement: FinancialStatement;
  line?: FinancialLine;
  label?: string;
  level?: number;
  className?: string;
}) {
  return (
    <div className={`financial-grid-row ${className}`}>
      <div className={`financial-grid-cell financial-grid-label level-${level}`}>{label || line?.label || "N/A"}</div>
      {statement.columns.map((column, index) => (
        <div key={`${line?.key || label}-${column}`} className="financial-grid-cell">
          {formatFinancialValue(lineValue(line, index))}
        </div>
      ))}
    </div>
  );
}

function FinancialGroup({
  statement,
  lineKey,
  title,
  children,
  level = 0,
  className = "",
  open = false
}: {
  statement: FinancialStatement;
  lineKey?: string;
  title: string;
  children: ReactNode;
  level?: number;
  className?: string;
  open?: boolean;
}) {
  const line = lineKey ? lineByKey(statement, lineKey) : undefined;
  return (
    <details className={`financial-detail ${className}`} open={open}>
      <summary>
        <FinancialRow statement={statement} line={line} label={title} level={level} className="financial-summary-row" />
      </summary>
      <div className="financial-detail-body">{children}</div>
    </details>
  );
}

function formatFinancialValue(value: number | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "N/A";
  }
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}B`;
  }
  if (abs >= 1_000_000) {
    return `${(value / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}M`;
  }
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function FinancialPositionPanel({ statement }: { statement: FinancialStatement }) {
  return (
    <section className="panel">
      <div className="panel-heading compact-heading">
        <h2>Financial Position Statement</h2>
      </div>
      <FinancialGrid statement={statement}>
        <FinancialGroup statement={statement} lineKey="total_assets" title="Total Assets" className="financial-grand-total asset-total" open>
          <FinancialGroup statement={statement} lineKey="current_assets" title="Total Current Assets" level={1} open>
            {["cash_short_investments", "receivables", "inventory", "prepaid", "other_current_assets"].map((key) => (
              <FinancialRow key={key} statement={statement} line={lineByKey(statement, key)} level={2} />
            ))}
          </FinancialGroup>
          <FinancialGroup statement={statement} lineKey="noncurrent_assets" title="Total Non-current Assets" level={1}>
            {["long_term_investments", "ppe", "intangibles", "deferred_assets", "other_noncurrent_assets"].map((key) => (
              <FinancialRow key={key} statement={statement} line={lineByKey(statement, key)} level={2} />
            ))}
          </FinancialGroup>
        </FinancialGroup>
        <FinancialGroup statement={statement} lineKey="total_liabilities" title="Total Liabilities" className="financial-grand-total liability-total" open>
          <FinancialGroup statement={statement} lineKey="current_liabilities" title="Total Current Liabilities" level={1}>
            {["accounts_payable", "short_term_debt", "other_current_liabilities"].map((key) => (
              <FinancialRow key={key} statement={statement} line={lineByKey(statement, key)} level={2} />
            ))}
          </FinancialGroup>
          <FinancialGroup statement={statement} lineKey="noncurrent_liabilities" title="Total Non-current Liabilities" level={1}>
            {["long_term_debt", "other_liabilities"].map((key) => (
              <FinancialRow key={key} statement={statement} line={lineByKey(statement, key)} level={2} />
            ))}
          </FinancialGroup>
        </FinancialGroup>
        <FinancialGroup statement={statement} lineKey="total_equity" title="Total Equity" className="financial-grand-total equity-total" open>
          {["common_stock", "capital_surplus", "retained_earnings", "treasury_stock"].map((key) => (
            <FinancialRow key={key} statement={statement} line={lineByKey(statement, key)} level={1} />
          ))}
        </FinancialGroup>
      </FinancialGrid>
    </section>
  );
}

function IncomeStatementPanel({ statement }: { statement: FinancialStatement }) {
  const sgaChildren = ["salary", "rent", "depreciation", "advertising", "fees", "freight", "research", "bad_debt", "other_sga"];
  return (
    <section className="panel">
      <div className="panel-heading compact-heading">
        <h2>Income Statement</h2>
      </div>
      <FinancialGrid statement={statement}>
        <FinancialRow statement={statement} line={lineByKey(statement, "revenue")} className="financial-result-row" />
        <FinancialRow statement={statement} line={lineByKey(statement, "cost_of_revenue")} className="financial-expense-row" />
        <FinancialRow statement={statement} line={lineByKey(statement, "gross_profit")} className="financial-result-row" />
        <FinancialGroup statement={statement} lineKey="sga" title="Less: Selling, General & Administrative" className="financial-expense-group" open>
          {sgaChildren.map((key) => (
            <FinancialRow key={key} statement={statement} line={lineByKey(statement, key)} level={1} />
          ))}
        </FinancialGroup>
        <FinancialRow statement={statement} line={lineByKey(statement, "operating_income")} className="financial-result-row" />
        <FinancialGroup statement={statement} lineKey="non_operating" title="Add/Less: Non-operating Income and Expenses">
          <FinancialRow statement={statement} line={lineByKey(statement, "non_operating")} level={1} />
        </FinancialGroup>
        <FinancialRow statement={statement} line={lineByKey(statement, "pretax_income")} className="financial-result-row" />
        <FinancialRow statement={statement} line={lineByKey(statement, "tax")} className="financial-expense-row" />
        <FinancialRow statement={statement} line={lineByKey(statement, "net_income")} className="financial-result-row financial-grand-income" />
        <FinancialGroup statement={statement} lineKey="oci" title="Add/Less: Other Comprehensive Income">
          <FinancialRow statement={statement} line={lineByKey(statement, "oci")} level={1} />
        </FinancialGroup>
        <FinancialRow statement={statement} line={lineByKey(statement, "comprehensive_income")} className="financial-result-row financial-grand-income" />
      </FinancialGrid>
    </section>
  );
}

function CashflowPanel({ statement }: { statement: FinancialStatement }) {
  return (
    <section className="panel">
      <div className="panel-heading compact-heading">
        <h2>Cashflow Statement</h2>
      </div>
      <FinancialGrid statement={statement}>
        {statement.lines.map((line) => (
          <FinancialRow key={line.key} statement={statement} line={line} />
        ))}
      </FinancialGrid>
    </section>
  );
}

function FinancialRatioPanel({
  rows,
  industry,
  peerCount
}: {
  rows: Array<{ metric: string; company: string; industryAverage: string }>;
  industry: string;
  peerCount: number;
}) {
  return (
    <section className="panel">
      <div className="panel-heading compact-heading">
        <div>
          <h2>Financial Ratio</h2>
        </div>
      </div>
      <div className="table-wrap financial-ratio-wrap">
        <table className="financial-ratio-table">
          <thead>
            <tr>
              <th className="text-cell">Metric</th>
              <th className="number-cell">Company</th>
              <th className="number-cell">Industry Average</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.metric}>
                <td className="text-cell strong">{row.metric}</td>
                <td className="number-cell">{row.company}</td>
                <td className="number-cell">{row.industryAverage}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function InlineTradeForm({
  mode,
  symbol,
  currency,
  quantity,
  price,
  busy,
  onQuantity,
  onPrice,
  onCancel,
  onSubmit
}: {
  mode: TradeMode;
  symbol: string;
  currency: string;
  quantity: string;
  price: string;
  busy: boolean;
  onQuantity: (value: string) => void;
  onPrice: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="inline-trade">
      <span className={mode === "BUY" ? "trade-label buy" : "trade-label sell"}>{mode}</span>
      <input
        aria-label={`${symbol} ${mode} quantity`}
        type="number"
        min="0"
        step="any"
        placeholder="Quantity"
        value={quantity}
        onChange={(event) => onQuantity(event.target.value)}
      />
      <input
        aria-label={`${symbol} ${mode} price`}
        type="number"
        min="0"
        step="any"
        placeholder={`Price (${currency})`}
        value={price}
        onChange={(event) => onPrice(event.target.value)}
      />
      <button className={mode === "BUY" ? "buy-button" : "sell-button"} onClick={onSubmit} disabled={busy}>
        Save
      </button>
      <button className="mini-ghost" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

function TradeOnlyRow(props: Parameters<typeof InlineTradeForm>[0]) {
  return (
    <tr>
      <td className="text-cell strong">{props.symbol}</td>
      <td className="number-cell">0</td>
      <td className="number-cell">N/A</td>
      <td className="number-cell">N/A</td>
      <td className="number-cell">N/A</td>
      <td className="number-cell">N/A</td>
      <td className="number-cell">N/A</td>
      <td className="number-cell">N/A</td>
      <td className="action-cell">
        <InlineTradeForm {...props} />
      </td>
    </tr>
  );
}

function TransactionPanel({
  transactions,
  currency
}: {
  transactions: PortfolioTransaction[];
  currency: string;
}) {
  const realizedGain = transactions.reduce((sum, tx) => sum + (Number(tx.realized_gain_loss) || 0), 0);
  const totalBuy = transactions.filter((tx) => tx.type === "BUY").reduce((sum, tx) => sum + tx.value, 0);
  const realizedReturn = totalBuy > 0 ? (realizedGain / totalBuy) * 100 : null;

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Transaction History</h2>
        </div>
        <div className="history-highlight">
          <span>Recorded Realized P/L</span>
          <strong className={signedClass(realizedGain)}>{formatMoney(realizedGain, currency)}</strong>
          <span className={signedClass(realizedReturn)}>{formatPct(realizedReturn)}</span>
        </div>
      </div>

      <div className="table-wrap">
        <table className="history-table">
          <thead>
            <tr>
              <th className="text-cell">Time</th>
              <th className="text-cell">Symbol</th>
              <th className="text-cell">Type</th>
              <th className="number-cell">Quantity</th>
              <th className="number-cell">Price</th>
              <th className="number-cell">Value</th>
              <th className="number-cell">Trade P/L</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((tx) => (
              <tr key={tx.id}>
                <td className="text-cell">{new Date(tx.created_at).toLocaleString()}</td>
                <td className="text-cell strong">{tx.symbol}</td>
                <td className="text-cell">
                  <span className={tx.type === "BUY" ? "trade-label buy" : "trade-label sell"}>{tx.type}</span>
                </td>
                <td className="number-cell">{formatNumber(tx.quantity, 8)}</td>
                <td className="number-cell">{formatMoney(tx.price, tx.currency)}</td>
                <td className="number-cell">{formatMoney(tx.value, tx.currency)}</td>
                <td className={`number-cell ${signedClass(tx.realized_gain_loss)}`}>
                  {tx.type === "BUY" ? "Open" : formatMoney(tx.realized_gain_loss, tx.currency)}
                </td>
              </tr>
            ))}
            {!transactions.length ? (
              <tr>
                <td colSpan={7} className="empty-cell">
                  No transactions recorded yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
