"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { PortfolioResponse, PortfolioRow, PortfolioTransaction } from "@/lib/types";

type User = {
  username: string;
  displayName: string;
};

type TradeMode = "BUY" | "SELL";

type ActiveTrade = {
  symbol: string;
  mode: TradeMode;
};

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 8
});

function currencyFormatter(currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: currency === "KRW" ? 0 : 2
  });
}

function formatNumber(value: number | null | undefined, digits = 4) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "N/A";
  }
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits
  }).format(value);
}

function formatMoney(value: number | null | undefined, currency: string) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "N/A";
  }
  return currencyFormatter(currency).format(value);
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

export default function PortfolioApp() {
  const [user, setUser] = useState<User | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [activeTrade, setActiveTrade] = useState<ActiveTrade | null>(null);
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [newSymbol, setNewSymbol] = useState("");
  const [newCurrency, setNewCurrency] = useState("KRW");
  const [credentials, setCredentials] = useState({
    username: "",
    password: "",
    displayName: "",
    email: ""
  });

  async function loadPortfolio(silent = false) {
    if (!silent) {
      setLoading(true);
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
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    let mounted = true;
    async function checkSession() {
      try {
        const data = await parseJsonResponse<{ user: User | null }>(await fetch("/api/auth/me", { cache: "no-store" }));
        if (!mounted) {
          return;
        }
        setUser(data.user);
        if (data.user) {
          await loadPortfolio();
        } else {
          setLoading(false);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : "Session check failed.");
          setLoading(false);
        }
      }
    }
    checkSession();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!user) {
      return;
    }
    const timer = window.setInterval(() => {
      loadPortfolio(true);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [user]);

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
      await loadPortfolio();
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

  function startTrade(row: PortfolioRow, mode: TradeMode) {
    setActiveTrade({ symbol: row.symbol, mode });
    setQuantity("");
    setPrice(row.price ? String(row.price) : "");
  }

  async function submitTrade(symbol: string, mode: TradeMode, currency: string) {
    setBusy(true);
    setError("");
    try {
      const data = await parseJsonResponse<PortfolioResponse>(
        await fetch("/api/portfolio", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: mode,
            symbol,
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
      if (newSymbol.toUpperCase() === symbol.toUpperCase()) {
        setNewSymbol("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Trade failed.");
    } finally {
      setBusy(false);
    }
  }

  const summaryCurrency = portfolio?.summary.currency || "KRW";
  const rows = portfolio?.rows || [];
  const transactions = portfolio?.transactions || [];
  const newSymbolNormalized = newSymbol.trim().toUpperCase();

  const activeRow = useMemo(
    () => rows.find((row) => row.symbol === activeTrade?.symbol),
    [activeTrade?.symbol, rows]
  );

  if (loading) {
    return (
      <main className="app-shell">
        <div className="loading-panel">Loading portfolio...</div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="auth-shell">
        <section className="auth-panel">
          <div>
            <p className="eyebrow">My Financial Portfolio</p>
            <h1>Realtime portfolio tracking</h1>
            <p className="muted">Supabase 계정과 Fly.io 가격 캐시를 사용하는 Next.js 버전입니다.</p>
          </div>
          <form onSubmit={submitAuth} className="auth-form">
            <label>
              Username
              <input
                value={credentials.username}
                onChange={(event) => setCredentials((prev) => ({ ...prev, username: event.target.value }))}
                autoComplete="username"
                required
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={credentials.password}
                onChange={(event) => setCredentials((prev) => ({ ...prev, password: event.target.value }))}
                autoComplete={authMode === "login" ? "current-password" : "new-password"}
                required
              />
            </label>
            {authMode === "register" ? (
              <>
                <label>
                  Display name
                  <input
                    value={credentials.displayName}
                    onChange={(event) => setCredentials((prev) => ({ ...prev, displayName: event.target.value }))}
                  />
                </label>
                <label>
                  Email
                  <input
                    type="email"
                    value={credentials.email}
                    onChange={(event) => setCredentials((prev) => ({ ...prev, email: event.target.value }))}
                  />
                </label>
              </>
            ) : null}
            {error ? <p className="form-error">{error}</p> : null}
            <button className="primary-button" disabled={busy}>
              {busy ? "Working..." : authMode === "login" ? "Login" : "Create account"}
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => setAuthMode((prev) => (prev === "login" ? "register" : "login"))}
            >
              {authMode === "login" ? "Create a new account" : "Use existing account"}
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Portfolio</p>
          <h1>{portfolio?.user.displayName || user.displayName}</h1>
          <p className="muted">
            Live refresh every 3s · Last update{" "}
            {portfolio?.refreshedAt ? new Date(portfolio.refreshedAt).toLocaleTimeString() : "N/A"}
          </p>
        </div>
        <div className="topbar-actions">
          <button className="ghost-button" onClick={() => loadPortfolio()} disabled={busy}>
            Refresh
          </button>
          <button className="ghost-button" onClick={logout}>
            Logout
          </button>
        </div>
      </header>

      {error ? <div className="alert">{error}</div> : null}

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
            <p className="muted">숫자는 우측 정렬, 텍스트는 좌측 정렬됩니다.</p>
          </div>
          <div className="add-position">
            <input
              placeholder="Symbol, e.g. BTC-KRW"
              value={newSymbol}
              onChange={(event) => setNewSymbol(event.target.value)}
            />
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
                  onQuantity={setQuantity}
                  onPrice={setPrice}
                  onCancel={() => setActiveTrade(null)}
                  onSubmit={() => {
                    if (activeTrade) {
                      submitTrade(activeTrade.symbol, activeTrade.mode, newCurrency);
                    }
                  }}
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
                        onQuantity={setQuantity}
                        onPrice={setPrice}
                        onCancel={() => setActiveTrade(null)}
                        onSubmit={() => submitTrade(row.symbol, activeTrade.mode, row.currency)}
                      />
                    ) : (
                      <div className="trade-buttons">
                        <button className="buy-button" onClick={() => startTrade(row, "BUY")}>
                          Buy
                        </button>
                        <button className="sell-button" onClick={() => startTrade(row, "SELL")}>
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
        {activeRow ? <p className="muted source-note">Active price source: {activeRow.source}</p> : null}
      </section>

      <TransactionPanel transactions={transactions} currency={summaryCurrency} />
    </main>
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
          <p className="muted">Buy/Sell을 기록하면 이곳에 손익과 함께 누적됩니다.</p>
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
