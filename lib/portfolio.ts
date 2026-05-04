import crypto from "node:crypto";
import { publicUserPayload } from "./admin";
import { getQuotes } from "./prices";
import { inferCurrency, normalizeSymbol } from "./symbols";
import type {
  PortfolioProjection,
  PortfolioResponse,
  PortfolioRow,
  PortfolioSummary,
  PortfolioTransaction,
  Position,
  PriceAlert,
  TradeInput,
  TriggeredAlert,
  UserRecord
} from "./types";

function numberOrZero(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function pctChange(current: number | null, previous: number | null) {
  if (current === null || previous === null || previous === 0) {
    return null;
  }
  return (current / previous - 1) * 100;
}

function activePositions(record: UserRecord) {
  return (Array.isArray(record.portfolio) ? record.portfolio : [])
    .filter((position): position is Position => Boolean(position && typeof position === "object" && position.symbol))
    .map((position) => ({
      ...position,
      symbol: normalizeSymbol(String(position.symbol), String(position.cost_currency || position.currency || "")),
      quantity: numberOrZero(position.quantity),
      avg_cost: numberOrZero(position.avg_cost),
      cost_currency: String(position.cost_currency || position.currency || inferCurrency(String(position.symbol))).toUpperCase()
    }))
    .filter((position) => position.symbol && position.quantity > 0);
}

function normalizeAlerts(record: UserRecord): PriceAlert[] {
  return (Array.isArray(record.alerts) ? record.alerts : [])
    .filter((alert): alert is PriceAlert => Boolean(alert && typeof alert === "object" && alert.id && alert.symbol))
    .map((alert): PriceAlert => ({
      id: String(alert.id),
      symbol: normalizeSymbol(String(alert.symbol)),
      direction: alert.direction === "below" ? "below" : "above",
      target_price: numberOrZero(alert.target_price),
      active: alert.active !== false,
      created_at: String(alert.created_at || new Date().toISOString()),
      last_checked_at: alert.last_checked_at ? String(alert.last_checked_at) : "",
      last_triggered_at: alert.last_triggered_at ? String(alert.last_triggered_at) : "",
      last_price: Number.isFinite(Number(alert.last_price)) ? Number(alert.last_price) : null,
      currency: alert.currency ? String(alert.currency).toUpperCase() : inferCurrency(String(alert.symbol))
    }))
    .filter((alert) => alert.symbol && alert.target_price > 0);
}

function betaEstimate(symbol: string) {
  const base = symbol.split("-", 1)[0];
  const estimates: Record<string, number> = {
    BTC: 1.45,
    ETH: 2.35,
    SOL: 2.15,
    XRP: 1.2,
    ONDO: 1.9,
    OP: 2.05,
    WLD: 2.1,
    RENDER: 2.0,
    AAPL: 1.15,
    MSFT: 0.95,
    NVDA: 1.7,
    TSLA: 1.9,
    SPY: 1,
    QQQ: 1.15
  };
  return estimates[base] ?? (symbol.endsWith(".KS") || symbol.endsWith(".KQ") ? 1.05 : 1);
}

function buildProjection(rows: PortfolioRow[]): PortfolioProjection {
  const currentValue = rows.reduce((sum, row) => sum + (row.marketValue ?? 0), 0);
  const coveredValue = rows.reduce((sum, row) => sum + (row.marketValue ?? 0), 0);
  if (currentValue <= 0 || coveredValue <= 0) {
    return {
      portfolioBeta: null,
      betaCoveragePct: null,
      expectedMonthlyLogReturnPct: null,
      expectedPortfolioValue: null,
      expectedGainLoss: null,
      calculatedAt: new Date().toISOString()
    };
  }
  const portfolioBeta = rows.reduce((sum, row) => sum + ((row.marketValue ?? 0) / coveredValue) * betaEstimate(row.symbol), 0);
  const expectedMonthlyLogReturnPct = 0.35 + portfolioBeta * 0.55;
  const expectedPortfolioValue = currentValue * Math.exp(expectedMonthlyLogReturnPct / 100);
  return {
    portfolioBeta,
    betaCoveragePct: (coveredValue / currentValue) * 100,
    expectedMonthlyLogReturnPct,
    expectedPortfolioValue,
    expectedGainLoss: expectedPortfolioValue - currentValue,
    calculatedAt: new Date().toISOString()
  };
}

export async function evaluatePriceAlerts(record: UserRecord): Promise<TriggeredAlert[]> {
  const alerts = normalizeAlerts(record);
  record.alerts = alerts;
  const activeSymbols = alerts.filter((alert) => alert.active).map((alert) => alert.symbol);
  const quotes = await getQuotes(activeSymbols);
  const triggered: TriggeredAlert[] = [];
  for (const alert of alerts) {
    if (!alert.active) {
      continue;
    }
    const quote = quotes.get(alert.symbol);
    const price = quote?.price ?? null;
    alert.last_checked_at = new Date().toISOString();
    alert.last_price = price;
    alert.currency = quote?.currency || alert.currency || inferCurrency(alert.symbol);
    if (price === null) {
      continue;
    }
    const isTriggered = alert.direction === "above" ? price >= alert.target_price : price <= alert.target_price;
    if (isTriggered) {
      alert.last_triggered_at = alert.last_triggered_at || new Date().toISOString();
      triggered.push({
        id: alert.id,
        symbol: alert.symbol,
        direction: alert.direction,
        target_price: alert.target_price,
        price,
        currency: quote?.currency || alert.currency || inferCurrency(alert.symbol)
      });
    }
  }
  return triggered;
}

export async function buildPortfolioResponse(record: UserRecord): Promise<PortfolioResponse> {
  const positions = activePositions(record);
  const quotes = await getQuotes(positions.map((position) => position.symbol));
  const grossValue = positions.reduce((sum, position) => {
    const quote = quotes.get(position.symbol);
    const price = quote?.price ?? null;
    return sum + (price === null ? 0 : price * position.quantity);
  }, 0);

  const rows: PortfolioRow[] = positions.map((position) => {
    const quote = quotes.get(position.symbol);
    const price = quote?.price ?? null;
    const marketValue = price === null ? null : price * position.quantity;
    const costBasis = position.avg_cost * position.quantity;
    const gainLoss = marketValue === null ? null : marketValue - costBasis;
    return {
      symbol: position.symbol,
      quantity: position.quantity,
      avgCost: position.avg_cost,
      currency: position.cost_currency || inferCurrency(position.symbol),
      price,
      previousClose: quote?.previousClose ?? null,
      changePct: quote?.changePct ?? null,
      marketValue,
      costBasis,
      gainLoss,
      gainLossPct: marketValue === null ? null : pctChange(marketValue, costBasis),
      allocationPct: marketValue === null || grossValue <= 0 ? null : (marketValue / grossValue) * 100,
      source: quote?.source || "unavailable",
      updatedAt: quote?.updatedAt || new Date().toISOString()
    };
  });

  rows.sort((a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0));

  const transactions = Array.isArray(record.transactions) ? record.transactions : [];
  const summary = buildPortfolioSummary(rows, transactions);
  const triggeredAlerts = await evaluatePriceAlerts(record);
  return {
    user: publicUserPayload(record),
    rows,
    transactions: [...transactions].reverse(),
    alerts: normalizeAlerts(record),
    triggeredAlerts,
    summary,
    projection: buildProjection(rows),
    refreshedAt: new Date().toISOString()
  };
}

function buildPortfolioSummary(rows: PortfolioRow[], transactions: PortfolioTransaction[]): PortfolioSummary {
  const currentValue = rows.reduce((sum, row) => sum + (row.marketValue ?? 0), 0);
  const costBasis = rows.reduce((sum, row) => sum + row.costBasis, 0);
  const unrealizedGainLoss = rows.reduce((sum, row) => sum + (row.gainLoss ?? 0), 0);
  const realizedGainLoss = transactions.reduce((sum, tx) => sum + numberOrZero(tx.realized_gain_loss), 0);
  const realizedCostBasis = transactions
    .filter((tx) => tx.type === "SELL")
    .reduce((sum, tx) => sum + numberOrZero(tx.cost_basis), 0);
  const totalBuyAmount = transactions
    .filter((tx) => tx.type === "BUY")
    .reduce((sum, tx) => sum + numberOrZero(tx.value), 0);
  const cumulativeGainLoss = realizedGainLoss + unrealizedGainLoss;
  const cumulativeInvestmentValue = Math.max(costBasis + realizedCostBasis, totalBuyAmount, costBasis);
  return {
    currentValue,
    costBasis,
    unrealizedGainLoss,
    totalReturnPct: costBasis > 0 ? (unrealizedGainLoss / costBasis) * 100 : null,
    realizedGainLoss,
    cumulativeGainLoss,
    cumulativeReturnPct: cumulativeInvestmentValue > 0 ? (cumulativeGainLoss / cumulativeInvestmentValue) * 100 : null,
    cumulativeInvestmentValue,
    totalBuyAmount,
    currency: rows.find((row) => row.currency)?.currency || "KRW"
  };
}

export function applyTrade(record: UserRecord, input: TradeInput) {
  const type = input.type;
  const quantity = numberOrZero(input.quantity);
  const price = numberOrZero(input.price);
  const currency = String(input.currency || inferCurrency(input.symbol)).toUpperCase();
  const symbol = normalizeSymbol(input.symbol, currency);

  if (!symbol) {
    throw new Error("Symbol is required.");
  }
  if (!["BUY", "SELL"].includes(type)) {
    throw new Error("Trade type must be BUY or SELL.");
  }
  if (quantity <= 0 || price <= 0) {
    throw new Error("Quantity and price must be greater than 0.");
  }

  const portfolio = activePositions(record);
  const existing = portfolio.find((position) => position.symbol === symbol);
  let realizedGainLoss: number | null = null;
  let costBasis: number | undefined;

  if (type === "BUY") {
    if (existing) {
      const previousCost = existing.quantity * existing.avg_cost;
      const additionalCost = quantity * price;
      existing.quantity += quantity;
      existing.avg_cost = (previousCost + additionalCost) / existing.quantity;
      existing.updated_at = new Date().toISOString();
    } else {
      portfolio.push({
        symbol,
        quantity,
        avg_cost: price,
        cost_currency: currency,
        created_at: new Date().toISOString()
      });
    }
  } else {
    if (!existing || existing.quantity < quantity) {
      throw new Error("Sell quantity cannot exceed current holdings.");
    }
    costBasis = existing.avg_cost * quantity;
    realizedGainLoss = quantity * price - costBasis;
    existing.quantity -= quantity;
    existing.updated_at = new Date().toISOString();
  }

  record.portfolio = portfolio
    .filter((position) => position.quantity > 0.000000001)
    .map((position) => ({
      ...position,
      quantity: Number(position.quantity.toFixed(12)),
      avg_cost: Number(position.avg_cost.toFixed(8))
    }));

  const transaction: PortfolioTransaction = {
    id: crypto.randomUUID(),
    type,
    symbol,
    quantity,
    price,
    currency,
    value: quantity * price,
    cost_basis: costBasis,
    realized_gain_loss: realizedGainLoss,
    created_at: new Date().toISOString()
  };
  record.transactions = [...(Array.isArray(record.transactions) ? record.transactions : []), transaction];
  return record;
}

export function addPriceAlert(record: UserRecord, input: { symbol: string; direction: string; targetPrice: number }) {
  const alerts = normalizeAlerts(record);
  const symbol = normalizeSymbol(input.symbol);
  const target = Number(input.targetPrice);
  if (!symbol || !Number.isFinite(target) || target <= 0) {
    throw new Error("Alert symbol and target price are required.");
  }
  alerts.push({
    id: crypto.randomUUID(),
    symbol,
    direction: input.direction === "below" ? "below" : "above",
    target_price: target,
    active: true,
    created_at: new Date().toISOString(),
    last_price: null,
    currency: inferCurrency(symbol)
  });
  record.alerts = alerts;
  return record;
}

export function togglePriceAlert(record: UserRecord, alertId: string) {
  const alerts = normalizeAlerts(record);
  record.alerts = alerts.map((alert) => (alert.id === alertId ? { ...alert, active: !alert.active } : alert));
  return record;
}

export function deletePriceAlert(record: UserRecord, alertId: string) {
  record.alerts = normalizeAlerts(record).filter((alert) => alert.id !== alertId);
  return record;
}

export function updateProfile(record: UserRecord, input: { displayName?: string; email?: string }) {
  record.profile = {
    display_name: input.displayName?.trim() || record.profile?.display_name || record.username,
    email: input.email?.trim() || ""
  };
  return record;
}
