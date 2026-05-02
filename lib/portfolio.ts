import crypto from "node:crypto";
import { getQuotes } from "./prices";
import { inferCurrency, normalizeSymbol } from "./symbols";
import type { PortfolioResponse, PortfolioRow, PortfolioSummary, PortfolioTransaction, Position, TradeInput, UserRecord } from "./types";

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
  return {
    user: {
      username: record.username,
      displayName: record.profile?.display_name || record.username
    },
    rows,
    transactions: [...transactions].reverse(),
    summary,
    refreshedAt: new Date().toISOString()
  };
}

function buildPortfolioSummary(rows: PortfolioRow[], transactions: PortfolioTransaction[]): PortfolioSummary {
  const currentValue = rows.reduce((sum, row) => sum + (row.marketValue ?? 0), 0);
  const costBasis = rows.reduce((sum, row) => sum + row.costBasis, 0);
  const unrealizedGainLoss = rows.reduce((sum, row) => sum + (row.gainLoss ?? 0), 0);
  const realizedGainLoss = transactions.reduce((sum, tx) => sum + numberOrZero(tx.realized_gain_loss), 0);
  const totalBuyAmount = transactions
    .filter((tx) => tx.type === "BUY")
    .reduce((sum, tx) => sum + numberOrZero(tx.value), 0);
  const cumulativeGainLoss = realizedGainLoss + unrealizedGainLoss;
  return {
    currentValue,
    costBasis,
    unrealizedGainLoss,
    realizedGainLoss,
    cumulativeGainLoss,
    cumulativeReturnPct: totalBuyAmount > 0 ? (cumulativeGainLoss / totalBuyAmount) * 100 : null,
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
