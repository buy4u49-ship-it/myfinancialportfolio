"use client";

import { CSSProperties, FormEvent, ReactNode, useEffect, useState } from "react";
import type {
  ChartPoint,
  FinancialLine,
  FinancialStatement,
  MarketMoverRow,
  MarketPageResponse,
  PortfolioResponse,
  PortfolioRow,
  PortfolioTransaction,
  Quote,
  SymbolDetailResponse
} from "@/lib/types";

type User = {
  username: string;
  displayName: string;
};

type PageKey = "coin" | "us" | "korea" | "symbol" | "my";
type TradeMode = "BUY" | "SELL";

const PAGES: Array<{ key: PageKey; label: string }> = [
  { key: "coin", label: "Coin Main" },
  { key: "us", label: "US Stock Main" },
  { key: "korea", label: "Korea Stock Main" },
  { key: "symbol", label: "Symbol Detail" },
  { key: "my", label: "My Page" }
];

const moneyFormatters = new Map<string, Intl.NumberFormat>();
const numberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 8 });

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
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [activeTrade, setActiveTrade] = useState<{ symbol: string; mode: TradeMode } | null>(null);
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [newSymbol, setNewSymbol] = useState("");
  const [newCurrency, setNewCurrency] = useState("KRW");
  const [symbolTab, setSymbolTab] = useState<"overview" | "financials" | "price" | "provider">("overview");
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

  async function loadMarket(target: PageKey) {
    const market = target === "coin" ? "crypto" : target === "us" ? "us" : "korea";
    const data = await parseJsonResponse<MarketPageResponse>(await fetch(`/api/market?market=${market}`, { cache: "no-store" }));
    setMarketData((prev) => ({ ...prev, [target]: data }));
  }

  async function loadSymbol(targetSymbol = symbol) {
    const data = await parseJsonResponse<SymbolDetailResponse>(
      await fetch(`/api/symbol?symbol=${encodeURIComponent(targetSymbol)}`, { cache: "no-store" })
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
        await loadMarket(page);
      } else if (page === "symbol") {
        await loadSymbol();
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

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (page === "my" && user) {
        loadPortfolio(true);
      }
      if (page === "coin" || page === "us" || page === "korea") {
        loadMarket(page).catch(() => undefined);
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [page, user]);

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

  function openSymbol(target: string) {
    const next = target.trim().toUpperCase();
    if (!next) {
      return;
    }
    setSymbol(next);
    setSymbolDraft(next);
    setPage("symbol");
    setBusy(true);
    loadSymbol(next)
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
    <main className="app-shell">
      <header className="topbar app-topbar">
        <div>
          <p className="eyebrow">My Financial Portfolio</p>
          <h1>{pageTitle}</h1>
          <p className="muted">Supabase account data · Fly.io Upbit cache · Vercel Next.js interface</p>
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
          placeholder="Search symbol, e.g. BTC-KRW, AAPL, 005930.KS"
          onChange={(event) => setSymbolDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              openSymbol(symbolDraft);
            }
          }}
        />
        <button className="primary-button" onClick={() => openSymbol(symbolDraft)}>
          Open Symbol
        </button>
      </div>

      {error ? <div className="alert">{error}</div> : null}

      {page === "coin" || page === "us" || page === "korea" ? (
        <MarketPage data={marketData[page]} onOpenSymbol={openSymbol} />
      ) : null}

      {page === "symbol" ? (
        <SymbolDetail
          data={symbolDetail}
          activeTab={symbolTab}
          onTab={setSymbolTab}
          onOpenSymbol={openSymbol}
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
            setNewSymbol={setNewSymbol}
            setNewCurrency={setNewCurrency}
            setActiveTrade={setActiveTrade}
            setQuantity={setQuantity}
            setPrice={setPrice}
            submitTrade={submitTrade}
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
  );
}

function MarketPage({
  data,
  onOpenSymbol
}: {
  data?: MarketPageResponse;
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
            <p className="muted">Representative market chart</p>
          </div>
          <QuotePill quote={data.representative.quote} />
        </div>
        <MiniChart points={data.representative.chart} currency={data.representative.quote.currency} />
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Major Indices</h2>
            <p className="muted">Core market signals from the Streamlit dashboard.</p>
          </div>
        </div>
        <div className="quote-grid">
          {data.indices.map((quote) => (
            <button key={quote.symbol} className="quote-card" onClick={() => onOpenSymbol(quote.symbol)}>
              <span>{quote.symbol}</span>
              <strong>{formatMoney(quote.price, quote.currency)}</strong>
              <em className={signedClass(quote.changePct)}>{formatPct(quote.changePct)}</em>
            </button>
          ))}
        </div>
      </section>

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
  onTab,
  onOpenSymbol
}: {
  data: SymbolDetailResponse | null;
  activeTab: "overview" | "financials" | "price" | "provider";
  onTab: (tab: "overview" | "financials" | "price" | "provider") => void;
  onOpenSymbol: (symbol: string) => void;
}) {
  if (!data) {
    return <div className="loading-panel">Search a symbol to load detail.</div>;
  }

  return (
    <>
      <section className="summary-grid">
        <SummaryCard label="Current Price" value={formatMoney(data.quote.price, data.quote.currency)} tone={signedClass(data.quote.changePct)} />
        <SummaryCard label="Previous Close" value={formatMoney(data.quote.previousClose, data.quote.currency)} />
        <SummaryCard label="1M Return" value={formatPct(data.metrics.avgReturnPct)} tone={signedClass(data.metrics.avgReturnPct)} />
        <SummaryCard label="1M Volatility" value={formatPct(data.metrics.volatilityPct)} />
      </section>

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
        <MiniChart points={data.chart} currency={data.quote.currency} />
      </section>

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
                <p className="muted">{data.profile.website || "Website unavailable"}</p>
              </div>
            </div>
            <p className="profile-copy">{data.profile.summary || "Company profile data is unavailable for this symbol."}</p>
          </article>
          <article className="panel">
            <div className="panel-heading">
              <div>
                <h2>Sector Watchlist Candidates</h2>
                <p className="muted">Comparable watchlist, not investment advice.</p>
              </div>
            </div>
            <div className="peer-list">
              {data.peers.map((quote) => (
                <button key={quote.symbol} onClick={() => onOpenSymbol(quote.symbol)}>
                  <span>{quote.symbol}</span>
                  <strong>{formatMoney(quote.price, quote.currency)}</strong>
                  <em className={signedClass(quote.changePct)}>{formatPct(quote.changePct)}</em>
                </button>
              ))}
            </div>
          </article>
        </section>
      ) : null}

      {activeTab === "financials" ? (
        <section className="financial-panels">
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
              <p className="muted">Source: {data.quote.source || data.quote.exchange}</p>
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

function MyPage({
  user,
  portfolio,
  busy,
  newSymbol,
  newCurrency,
  activeTrade,
  quantity,
  price,
  setNewSymbol,
  setNewCurrency,
  setActiveTrade,
  setQuantity,
  setPrice,
  submitTrade
}: {
  user: User;
  portfolio: PortfolioResponse | null;
  busy: boolean;
  newSymbol: string;
  newCurrency: string;
  activeTrade: { symbol: string; mode: TradeMode } | null;
  quantity: string;
  price: string;
  setNewSymbol: (value: string) => void;
  setNewCurrency: (value: string) => void;
  setActiveTrade: (value: { symbol: string; mode: TradeMode } | null) => void;
  setQuantity: (value: string) => void;
  setPrice: (value: string) => void;
  submitTrade: (symbol: string, mode: TradeMode, currency: string) => void;
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
            <p className="muted">Signed in as {user.displayName}. Numbers are right-aligned; text is left-aligned.</p>
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

function QuotePill({ quote }: { quote: Quote }) {
  return (
    <div className="quote-pill">
      <span>{quote.symbol}</span>
      <strong>{formatMoney(quote.price, quote.currency)}</strong>
      <em className={signedClass(quote.changePct)}>{formatPct(quote.changePct)}</em>
    </div>
  );
}

function MiniChart({ points, currency }: { points: ChartPoint[]; currency: string }) {
  const width = 900;
  const height = 280;
  const values = points.map((point) => point.close).filter(Number.isFinite);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const span = max - min || 1;
  const path = points
    .map((point, index) => {
      const x = (index / Math.max(points.length - 1, 1)) * width;
      const y = height - ((point.close - min) / span) * (height - 20) - 10;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <div className="chart-shell">
      {points.length ? (
        <>
          <svg viewBox={`0 0 ${width} ${height}`} role="img">
            <path d={path} fill="none" stroke="#2563eb" strokeWidth="4" vectorEffect="non-scaling-stroke" />
            <line x1="0" x2={width} y1={height - 1} y2={height - 1} stroke="#e5e7eb" />
          </svg>
          <div className="chart-scale">
            <span>{formatMoney(max, currency)}</span>
            <span>{formatMoney(min, currency)}</span>
          </div>
        </>
      ) : (
        <div className="empty-cell">Chart data is unavailable.</div>
      )}
    </div>
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
  return (
    <section className="panel mover-panel">
      <div className="panel-heading compact-heading">
        <h2>{title}</h2>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="text-cell">Symbol</th>
              <th className="number-cell">Price</th>
              <th className="number-cell">Change</th>
              <th className="number-cell">Volume</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${title}-${row.symbol}`} onClick={() => onOpenSymbol(row.symbol)} className="click-row">
                <td className="text-cell strong">{row.symbol}</td>
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
    return "";
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
          <p className="muted">{peerCount ? `Industry average uses ${peerCount} comparable companies from ${industry}.` : `Industry average is unavailable for ${industry}.`}</p>
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
          <p className="muted">Every recorded Buy/Sell trade is listed here.</p>
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
