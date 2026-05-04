import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminRecord } from "@/lib/admin";
import { buildPortfolioResponse } from "@/lib/portfolio";
import { inferCurrency, normalizeSymbol } from "@/lib/symbols";
import { getUserRecord, listUserRecords, saveUserRecord } from "@/lib/userStore";
import type { AdminManagedPosition, AdminResponse, AdminUserSummary, PortfolioTransaction, Position, UserRecord } from "@/lib/types";

export const runtime = "nodejs";

function numberOrNull(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function numberOrZero(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function adminSummary(record: UserRecord): AdminUserSummary {
  return {
    username: record.username,
    displayName: record.profile?.display_name || record.username,
    email: record.profile?.email || "",
    createdAt: record.created_at || "",
    positionCount: Array.isArray(record.portfolio) ? record.portfolio.length : 0,
    transactionCount: Array.isArray(record.transactions) ? record.transactions.length : 0,
    alertCount: Array.isArray(record.alerts) ? record.alerts.length : 0
  };
}

function adminPositions(record: UserRecord | null): AdminManagedPosition[] {
  if (!record || !Array.isArray(record.portfolio)) {
    return [];
  }
  return record.portfolio.map((position, index) => ({
    index,
    symbol: String(position.symbol || ""),
    quantity: numberOrZero(position.quantity),
    avgCost: numberOrZero(position.avg_cost),
    currency: String(position.cost_currency || position.currency || inferCurrency(String(position.symbol || ""))).toUpperCase()
  }));
}

async function buildAdminResponse(selectedUsername?: string | null): Promise<AdminResponse> {
  const records = await listUserRecords();
  const users = records.map(adminSummary);
  const selected = selectedUsername || users[0]?.username || null;
  const selectedRecord = selected ? await getUserRecord(selected) : null;
  return {
    isAdmin: true,
    users,
    selectedUsername: selectedRecord?.username || selected,
    selectedUser: selectedRecord ? await buildPortfolioResponse(selectedRecord) : null,
    selectedPositions: adminPositions(selectedRecord),
    refreshedAt: new Date().toISOString()
  };
}

function normalizePositions(record: UserRecord) {
  record.portfolio = Array.isArray(record.portfolio) ? record.portfolio : [];
  return record.portfolio as Position[];
}

function normalizeTransactions(record: UserRecord) {
  record.transactions = Array.isArray(record.transactions) ? record.transactions : [];
  return record.transactions as PortfolioTransaction[];
}

function updatePosition(record: UserRecord, body: Record<string, unknown>) {
  const positions = normalizePositions(record);
  const index = Math.trunc(Number(body.index));
  if (!Number.isInteger(index) || index < 0 || index >= positions.length) {
    throw new Error("Position not found.");
  }
  const currency = String(body.currency || positions[index].cost_currency || positions[index].currency || inferCurrency(String(body.symbol || positions[index].symbol))).toUpperCase();
  const symbol = normalizeSymbol(String(body.symbol || positions[index].symbol), currency);
  const quantity = numberOrZero(body.quantity);
  const avgCost = numberOrZero(body.avgCost);
  if (!symbol || quantity <= 0 || avgCost <= 0) {
    throw new Error("Symbol, quantity, and average cost are required.");
  }
  positions[index] = {
    ...positions[index],
    symbol,
    quantity,
    avg_cost: avgCost,
    cost_currency: currency,
    currency,
    updated_at: new Date().toISOString()
  };
}

function addPosition(record: UserRecord, body: Record<string, unknown>) {
  const currency = String(body.currency || inferCurrency(String(body.symbol || ""))).toUpperCase();
  const symbol = normalizeSymbol(String(body.symbol || ""), currency);
  const quantity = numberOrZero(body.quantity);
  const avgCost = numberOrZero(body.avgCost);
  if (!symbol || quantity <= 0 || avgCost <= 0) {
    throw new Error("Symbol, quantity, and average cost are required.");
  }
  normalizePositions(record).push({
    symbol,
    quantity,
    avg_cost: avgCost,
    cost_currency: currency,
    currency,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  });
}

function deletePosition(record: UserRecord, body: Record<string, unknown>) {
  const positions = normalizePositions(record);
  const index = Math.trunc(Number(body.index));
  if (!Number.isInteger(index) || index < 0 || index >= positions.length) {
    throw new Error("Position not found.");
  }
  record.portfolio = positions.filter((_, itemIndex) => itemIndex !== index);
}

function transactionFromBody(body: Record<string, unknown>, existing?: PortfolioTransaction): PortfolioTransaction {
  const type = body.type === "SELL" ? "SELL" : "BUY";
  const currency = String(body.currency || existing?.currency || inferCurrency(String(body.symbol || existing?.symbol || ""))).toUpperCase();
  const symbol = normalizeSymbol(String(body.symbol || existing?.symbol || ""), currency);
  const quantity = numberOrZero(body.quantity ?? existing?.quantity);
  const price = numberOrZero(body.price ?? existing?.price);
  const costBasis = numberOrNull(body.costBasis ?? existing?.cost_basis);
  const realizedGainLoss = numberOrNull(body.realizedGainLoss ?? existing?.realized_gain_loss);
  if (!symbol || quantity <= 0 || price <= 0) {
    throw new Error("Transaction symbol, quantity, and price are required.");
  }
  return {
    id: existing?.id || crypto.randomUUID(),
    type,
    symbol,
    quantity,
    price,
    currency,
    value: quantity * price,
    cost_basis: costBasis ?? undefined,
    realized_gain_loss: realizedGainLoss,
    created_at: String(body.createdAt || existing?.created_at || new Date().toISOString())
  };
}

function updateTransaction(record: UserRecord, body: Record<string, unknown>) {
  const transactions = normalizeTransactions(record);
  const id = String(body.transactionId || "");
  const index = transactions.findIndex((tx) => tx.id === id);
  if (index < 0) {
    throw new Error("Transaction not found.");
  }
  transactions[index] = transactionFromBody(body, transactions[index]);
}

function addTransaction(record: UserRecord, body: Record<string, unknown>) {
  normalizeTransactions(record).push(transactionFromBody(body));
}

function deleteTransaction(record: UserRecord, body: Record<string, unknown>) {
  const id = String(body.transactionId || "");
  const transactions = normalizeTransactions(record);
  record.transactions = transactions.filter((tx) => tx.id !== id);
}

export async function GET(request: NextRequest) {
  try {
    await requireAdminRecord(request);
    const username = request.nextUrl.searchParams.get("username");
    return NextResponse.json(await buildAdminResponse(username));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Admin load failed." }, { status: 403 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    await requireAdminRecord(request);
    const body = (await request.json()) as Record<string, unknown>;
    const targetUsername = String(body.targetUsername || "");
    const target = await getUserRecord(targetUsername);
    if (!target) {
      throw new Error("Target user not found.");
    }
    const action = String(body.action || "");
    if (action === "update_profile") {
      target.profile = {
        display_name: String(body.displayName || target.profile?.display_name || target.username).trim(),
        email: String(body.email || "").trim()
      };
    } else if (action === "add_position") {
      addPosition(target, body);
    } else if (action === "update_position") {
      updatePosition(target, body);
    } else if (action === "delete_position") {
      deletePosition(target, body);
    } else if (action === "add_transaction") {
      addTransaction(target, body);
    } else if (action === "update_transaction") {
      updateTransaction(target, body);
    } else if (action === "delete_transaction") {
      deleteTransaction(target, body);
    } else {
      throw new Error("Unsupported admin action.");
    }
    await saveUserRecord(target.username, target);
    return NextResponse.json(await buildAdminResponse(target.username));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Admin update failed." }, { status: 400 });
  }
}
