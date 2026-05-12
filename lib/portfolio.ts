import crypto from "node:crypto";
import { publicUserPayload } from "./admin";
import { getQuotes } from "./prices";
import { normalizePushTokens, sendPushToUser } from "./push";
import { inferCurrency, normalizeSymbol } from "./symbols";
import { normalizeStrategy, normalizeStrategies } from "./strategies";
import type {
  PortfolioCashSettings,
  PortfolioProjection,
  PortfolioResponse,
  PortfolioImportPosition,
  PortfolioRow,
  PortfolioSummary,
  PortfolioTransaction,
  Position,
  PriceAlert,
  StrategyDefinition,
  TradeInput,
  TriggeredAlert,
  UserRecord
} from "./types";

function numberOrZero(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function normalizeCashSettings(record: UserRecord): PortfolioCashSettings {
  const raw = record.portfolio_calculation && typeof record.portfolio_calculation === "object" ? record.portfolio_calculation : {};
  const settings = raw as Partial<PortfolioCashSettings>;
  return {
    includeCash: settings.includeCash === true,
    cashBalance: numberOrZero(settings.cashBalance),
    cashCurrency: String(settings.cashCurrency || "KRW").toUpperCase()
  };
}

function saveCashSettings(record: UserRecord, settings: PortfolioCashSettings) {
  record.portfolio_calculation = {
    includeCash: settings.includeCash,
    cashBalance: Number(settings.cashBalance.toFixed(8)),
    cashCurrency: settings.cashCurrency || "KRW"
  };
}

export function updateCashSettings(record: UserRecord, input: { includeCash?: unknown; cashBalance?: unknown; cashCurrency?: unknown }) {
  const current = normalizeCashSettings(record);
  saveCashSettings(record, {
    includeCash: input.includeCash === undefined ? current.includeCash : input.includeCash === true,
    cashBalance: input.cashBalance === undefined ? current.cashBalance : numberOrZero(input.cashBalance),
    cashCurrency: String(input.cashCurrency || current.cashCurrency || "KRW").toUpperCase()
  });
  return record;
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

function serializePositions(portfolio: Position[]) {
  return portfolio
    .filter((position) => position.symbol && position.quantity > 0.000000001)
    .map((position) => ({
      ...position,
      quantity: Number(position.quantity.toFixed(12)),
      avg_cost: Number(position.avg_cost.toFixed(8)),
      cost_currency: String(position.cost_currency || position.currency || inferCurrency(position.symbol)).toUpperCase(),
      updated_at: position.updated_at || new Date().toISOString()
    }));
}

function normalizeTransaction(tx: PortfolioTransaction): PortfolioTransaction {
  const type = tx.type === "SELL" ? "SELL" : "BUY";
  const quantity = numberOrZero(tx.quantity);
  const price = numberOrZero(tx.price);
  const value = numberOrZero(tx.value) || quantity * price;
  return {
    ...tx,
    id: String(tx.id || crypto.randomUUID()),
    type,
    symbol: normalizeSymbol(String(tx.symbol || ""), String(tx.currency || "")),
    quantity,
    price,
    currency: String(tx.currency || inferCurrency(String(tx.symbol || ""))).toUpperCase(),
    value,
    cost_basis: tx.cost_basis === undefined ? undefined : numberOrZero(tx.cost_basis),
    realized_gain_loss: tx.realized_gain_loss === undefined ? null : numberOrZero(tx.realized_gain_loss),
    created_at: String(tx.created_at || new Date().toISOString())
  };
}

function normalizedTransactions(record: UserRecord) {
  return (Array.isArray(record.transactions) ? record.transactions : [])
    .filter((tx): tx is PortfolioTransaction => Boolean(tx && typeof tx === "object" && tx.id))
    .map(normalizeTransaction)
    .filter((tx) => tx.symbol && tx.quantity > 0 && tx.price > 0);
}

function mergePosition(portfolio: Position[], symbol: string, quantity: number, avgCost: number, currency: string) {
  if (quantity <= 0) {
    return;
  }
  const existing = portfolio.find((position) => position.symbol === symbol);
  if (existing) {
    const previousCost = existing.quantity * existing.avg_cost;
    const additionalCost = quantity * avgCost;
    existing.quantity += quantity;
    existing.avg_cost = existing.quantity > 0 ? (previousCost + additionalCost) / existing.quantity : avgCost;
    existing.cost_currency = currency;
    existing.updated_at = new Date().toISOString();
  } else {
    portfolio.push({
      symbol,
      quantity,
      avg_cost: avgCost,
      cost_currency: currency,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
  }
}

function removeBuyFromPosition(portfolio: Position[], tx: PortfolioTransaction) {
  const existing = portfolio.find((position) => position.symbol === tx.symbol);
  if (!existing) {
    return;
  }
  const remainingQuantity = existing.quantity - tx.quantity;
  const remainingCost = existing.quantity * existing.avg_cost - tx.value;
  if (remainingQuantity <= 0.000000001) {
    portfolio.splice(portfolio.indexOf(existing), 1);
    return;
  }
  existing.quantity = remainingQuantity;
  existing.avg_cost = Math.max(0, remainingCost) / remainingQuantity;
  existing.updated_at = new Date().toISOString();
}

function reverseTransactionFromPortfolio(portfolio: Position[], tx: PortfolioTransaction) {
  if (tx.type === "BUY") {
    removeBuyFromPosition(portfolio, tx);
    return;
  }
  const restoredAvgCost = tx.quantity > 0 ? (numberOrZero(tx.cost_basis) || tx.quantity * tx.price) / tx.quantity : tx.price;
  mergePosition(portfolio, tx.symbol, tx.quantity, restoredAvgCost, tx.currency);
}

function applyTransactionToPortfolio(portfolio: Position[], tx: PortfolioTransaction) {
  if (tx.type === "BUY") {
    mergePosition(portfolio, tx.symbol, tx.quantity, tx.price, tx.currency);
    return { costBasis: undefined as number | undefined, realizedGainLoss: null as number | null };
  }
  const existing = portfolio.find((position) => position.symbol === tx.symbol);
  if (!existing) {
    throw new Error("Sell quantity cannot exceed current holdings.");
  }
  const sellTolerance = Math.max(0.000000001, existing.quantity * 0.000001);
  if (tx.quantity - existing.quantity > sellTolerance) {
    throw new Error("Sell quantity cannot exceed current holdings.");
  }
  const executedQuantity = existing.quantity - tx.quantity <= sellTolerance ? existing.quantity : tx.quantity;
  const costBasis = existing.avg_cost * executedQuantity;
  const realizedGainLoss = executedQuantity * tx.price - costBasis;
  existing.quantity = Math.max(0, existing.quantity - executedQuantity);
  existing.updated_at = new Date().toISOString();
  tx.quantity = executedQuantity;
  tx.value = executedQuantity * tx.price;
  return { costBasis, realizedGainLoss };
}

function transactionCashImpact(tx: PortfolioTransaction) {
  return tx.type === "BUY" ? -tx.value : tx.value;
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

function buildProjection(rows: PortfolioRow[], cashSettings: PortfolioCashSettings): PortfolioProjection {
  const securitiesValue = rows.reduce((sum, row) => sum + (row.marketValue ?? 0), 0);
  const includedCash = cashSettings.includeCash ? cashSettings.cashBalance : 0;
  const currentValue = securitiesValue + includedCash;
  if (currentValue <= 0) {
    return {
      portfolioBeta: null,
      betaCoveragePct: null,
      expectedMonthlyLogReturnPct: null,
      expectedPortfolioValue: null,
      expectedGainLoss: null,
      calculatedAt: new Date().toISOString()
    };
  }
  const portfolioBeta = rows.reduce((sum, row) => sum + ((row.marketValue ?? 0) / currentValue) * betaEstimate(row.symbol), 0);
  const expectedMonthlyLogReturnPct = 0.35 + portfolioBeta * 0.55;
  const expectedPortfolioValue = currentValue * Math.exp(expectedMonthlyLogReturnPct / 100);
  return {
    portfolioBeta,
    betaCoveragePct: 100,
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
      const shouldNotify = !alert.last_triggered_at;
      alert.last_triggered_at = alert.last_triggered_at || new Date().toISOString();
      triggered.push({
        id: alert.id,
        symbol: alert.symbol,
        direction: alert.direction,
        target_price: alert.target_price,
        price,
        currency: quote?.currency || alert.currency || inferCurrency(alert.symbol)
      });
      if (shouldNotify) {
        await sendPushToUser(record, {
          title: "Price alert triggered",
          body: `${alert.symbol} is ${alert.direction === "above" ? "at or above" : "at or below"} ${alert.target_price}. Current price: ${price}.`,
          data: {
            type: "price_alert",
            alertId: alert.id,
            symbol: alert.symbol
          }
        });
      }
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

  const transactions = normalizedTransactions(record);
  record.transactions = transactions;
  const cashSettings = normalizeCashSettings(record);
  const summary = buildPortfolioSummary(rows, transactions, cashSettings);
  const triggeredAlerts = await evaluatePriceAlerts(record);
  const pushTokens = normalizePushTokens(record);
  return {
    user: publicUserPayload(record),
    rows,
    transactions: [...transactions].reverse(),
    alerts: normalizeAlerts(record),
    triggeredAlerts,
    pushEnabled: pushTokens.some((token) => token.enabled),
    pushTokenCount: pushTokens.filter((token) => token.enabled).length,
    strategies: normalizeStrategies(record),
    cashSettings,
    summary,
    projection: buildProjection(rows, cashSettings),
    refreshedAt: new Date().toISOString()
  };
}

function buildPortfolioSummary(rows: PortfolioRow[], transactions: PortfolioTransaction[], cashSettings: PortfolioCashSettings): PortfolioSummary {
  const securitiesCurrentValue = rows.reduce((sum, row) => sum + (row.marketValue ?? 0), 0);
  const includedCash = cashSettings.includeCash ? cashSettings.cashBalance : 0;
  const currentValue = securitiesCurrentValue + includedCash;
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
    securitiesCurrentValue,
    cashBalance: cashSettings.cashBalance,
    cashIncluded: cashSettings.includeCash,
    cashCurrency: cashSettings.cashCurrency,
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
  const requestedQuantity = numberOrZero(input.quantity);
  const price = numberOrZero(input.price);
  const sellAll = type === "SELL" && input.sellAll === true;
  const currency = String(input.currency || inferCurrency(input.symbol)).toUpperCase();
  const symbol = normalizeSymbol(input.symbol, currency);

  if (!symbol) {
    throw new Error("Symbol is required.");
  }
  if (!["BUY", "SELL"].includes(type)) {
    throw new Error("Trade type must be BUY or SELL.");
  }
  if ((!sellAll && requestedQuantity <= 0) || price <= 0) {
    throw new Error("Quantity and price must be greater than 0.");
  }

  const portfolio = activePositions(record);
  const existing = portfolio.find((position) => position.symbol === symbol);
  let executedQuantity = requestedQuantity;
  let realizedGainLoss: number | null = null;
  let costBasis: number | undefined;

  if (type === "BUY") {
    const tradeValue = executedQuantity * price;
    if (existing) {
      const previousCost = existing.quantity * existing.avg_cost;
      const additionalCost = tradeValue;
      existing.quantity += executedQuantity;
      existing.avg_cost = (previousCost + additionalCost) / existing.quantity;
      existing.updated_at = new Date().toISOString();
    } else {
      portfolio.push({
        symbol,
        quantity: executedQuantity,
        avg_cost: price,
        cost_currency: currency,
        created_at: new Date().toISOString()
      });
    }
  } else {
    if (!existing) {
      throw new Error("Sell quantity cannot exceed current holdings.");
    }
    const sellTolerance = Math.max(0.000000001, existing.quantity * 0.000001);
    if (sellAll) {
      executedQuantity = existing.quantity;
    } else {
      const overSoldBy = requestedQuantity - existing.quantity;
      if (overSoldBy > sellTolerance) {
        throw new Error("Sell quantity cannot exceed current holdings.");
      }
      const remainingAfterRequestedSell = existing.quantity - requestedQuantity;
      if (overSoldBy >= 0 || remainingAfterRequestedSell <= sellTolerance) {
        executedQuantity = existing.quantity;
      }
    }
    costBasis = existing.avg_cost * executedQuantity;
    realizedGainLoss = executedQuantity * price - costBasis;
    existing.quantity = Math.max(0, existing.quantity - executedQuantity);
    existing.updated_at = new Date().toISOString();
  }

  const tradeValue = executedQuantity * price;
  const cashSettings = normalizeCashSettings(record);
  const cashCurrency = cashSettings.cashCurrency || currency;
  saveCashSettings(record, {
    ...cashSettings,
    cashCurrency,
    cashBalance: cashSettings.cashBalance + (type === "BUY" ? -tradeValue : tradeValue)
  });

  record.portfolio = serializePositions(portfolio);

  const transaction: PortfolioTransaction = {
    id: crypto.randomUUID(),
    type,
    symbol,
    quantity: executedQuantity,
    price,
    currency,
    value: tradeValue,
    cost_basis: costBasis,
    realized_gain_loss: realizedGainLoss,
    created_at: new Date().toISOString()
  };
  record.transactions = [...(Array.isArray(record.transactions) ? record.transactions : []), transaction];
  return record;
}

export function updatePosition(record: UserRecord, input: { symbol?: unknown; quantity?: unknown; avgCost?: unknown; currency?: unknown }) {
  const currency = String(input.currency || inferCurrency(String(input.symbol || ""))).toUpperCase();
  const symbol = normalizeSymbol(String(input.symbol || ""), currency);
  const quantity = numberOrZero(input.quantity);
  const avgCost = numberOrZero(input.avgCost);
  if (!symbol) {
    throw new Error("Symbol is required.");
  }
  if (quantity < 0 || avgCost < 0) {
    throw new Error("Quantity and average cost cannot be negative.");
  }
  const portfolio = activePositions(record).filter((position) => position.symbol !== symbol);
  if (quantity > 0) {
    portfolio.push({
      symbol,
      quantity,
      avg_cost: avgCost,
      cost_currency: currency,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
  }
  record.portfolio = serializePositions(portfolio);
  return record;
}

function normalizeImportPosition(input: unknown): PortfolioImportPosition | null {
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const currency = String(raw.currency || inferCurrency(String(raw.symbol || ""))).toUpperCase();
  const symbol = normalizeSymbol(String(raw.symbol || ""), currency);
  const quantity = numberOrZero(raw.quantity);
  const avgCost = numberOrZero(raw.avgCost);
  if (!symbol || quantity <= 0 || avgCost < 0) {
    return null;
  }
  return {
    symbol,
    name: raw.name ? String(raw.name) : "",
    quantity,
    avgCost,
    currency,
    marketValue: Number.isFinite(Number(raw.marketValue)) ? Number(raw.marketValue) : null,
    confidence: Number.isFinite(Number(raw.confidence)) ? Number(raw.confidence) : null,
    note: raw.note ? String(raw.note) : ""
  };
}

export function importPositions(
  record: UserRecord,
  input: {
    positions?: unknown;
    mode?: unknown;
    cashBalance?: unknown;
    cashCurrency?: unknown;
    includeCash?: unknown;
  }
) {
  const candidates = Array.isArray(input.positions) ? input.positions.map(normalizeImportPosition).filter((item): item is PortfolioImportPosition => Boolean(item)) : [];
  if (!candidates.length && input.cashBalance === undefined) {
    throw new Error("No importable positions were provided.");
  }

  let portfolio = activePositions(record);
  const mode = input.mode === "add" ? "add" : "replace";
  for (const candidate of candidates) {
    const existing = portfolio.find((position) => position.symbol === candidate.symbol);
    if (mode === "add" && existing) {
      const previousCost = existing.quantity * existing.avg_cost;
      const additionalCost = candidate.quantity * candidate.avgCost;
      existing.quantity += candidate.quantity;
      existing.avg_cost = existing.quantity > 0 ? (previousCost + additionalCost) / existing.quantity : candidate.avgCost;
      existing.cost_currency = candidate.currency;
      existing.updated_at = new Date().toISOString();
    } else {
      portfolio = portfolio.filter((position) => position.symbol !== candidate.symbol);
      portfolio.push({
        symbol: candidate.symbol,
        quantity: candidate.quantity,
        avg_cost: candidate.avgCost,
        cost_currency: candidate.currency,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    }
  }
  record.portfolio = serializePositions(portfolio);

  if (input.cashBalance !== undefined) {
    const current = normalizeCashSettings(record);
    saveCashSettings(record, {
      includeCash: input.includeCash === undefined ? true : input.includeCash === true,
      cashBalance: numberOrZero(input.cashBalance),
      cashCurrency: String(input.cashCurrency || current.cashCurrency || "KRW").toUpperCase()
    });
  }

  return record;
}

export function updateTransaction(record: UserRecord, input: { transactionId?: unknown; type?: unknown; symbol?: unknown; quantity?: unknown; price?: unknown; currency?: unknown; createdAt?: unknown }) {
  const transactions = normalizedTransactions(record);
  const transactionId = String(input.transactionId || "");
  const index = transactions.findIndex((tx) => tx.id === transactionId);
  if (index < 0) {
    throw new Error("Transaction not found.");
  }

  const oldTransaction = transactions[index];
  const type = input.type === "SELL" ? "SELL" : "BUY";
  const currency = String(input.currency || oldTransaction.currency || inferCurrency(String(input.symbol || oldTransaction.symbol))).toUpperCase();
  const symbol = normalizeSymbol(String(input.symbol || oldTransaction.symbol), currency);
  const quantity = numberOrZero(input.quantity);
  const price = numberOrZero(input.price);
  if (!symbol || quantity <= 0 || price <= 0) {
    throw new Error("Transaction symbol, quantity, and price are required.");
  }

  const portfolio = activePositions(record);
  reverseTransactionFromPortfolio(portfolio, oldTransaction);
  const nextTransaction: PortfolioTransaction = {
    id: oldTransaction.id,
    type,
    symbol,
    quantity,
    price,
    currency,
    value: quantity * price,
    cost_basis: undefined,
    realized_gain_loss: null,
    created_at: input.createdAt ? String(input.createdAt) : oldTransaction.created_at
  };
  const realized = applyTransactionToPortfolio(portfolio, nextTransaction);
  nextTransaction.cost_basis = realized.costBasis;
  nextTransaction.realized_gain_loss = realized.realizedGainLoss;

  const cashSettings = normalizeCashSettings(record);
  saveCashSettings(record, {
    ...cashSettings,
    cashBalance: cashSettings.cashBalance + transactionCashImpact(nextTransaction) - transactionCashImpact(oldTransaction)
  });

  transactions[index] = nextTransaction;
  record.transactions = transactions;
  record.portfolio = serializePositions(portfolio);
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

export function saveStrategy(record: UserRecord, input: unknown) {
  const strategies = normalizeStrategies(record);
  const candidate = input && typeof input === "object" ? (input as Partial<StrategyDefinition>) : {};
  const existing = strategies.find((strategy) => strategy.id === candidate.id);
  const next = normalizeStrategy(input, existing);
  record.strategies = existing ? strategies.map((strategy) => (strategy.id === next.id ? next : strategy)) : [...strategies, next];
  return record;
}

export function deleteStrategy(record: UserRecord, strategyId: string) {
  record.strategies = normalizeStrategies(record).filter((strategy) => strategy.id !== strategyId);
  record.strategy_snapshots = (Array.isArray(record.strategy_snapshots) ? record.strategy_snapshots : []).filter(
    (snapshot) => snapshot.strategy_id !== strategyId
  );
  return record;
}

export function updateProfile(record: UserRecord, input: { displayName?: string; email?: string }) {
  record.profile = {
    display_name: input.displayName?.trim() || record.profile?.display_name || record.username,
    email: input.email?.trim() || ""
  };
  return record;
}
