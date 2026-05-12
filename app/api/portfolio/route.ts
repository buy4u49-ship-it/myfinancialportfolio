import { NextRequest, NextResponse } from "next/server";
import { readSessionUsername } from "@/lib/auth";
import {
  addPriceAlert,
  applyTrade,
  buildPortfolioResponse,
  deletePriceAlert,
  deleteStrategy,
  importPositions,
  saveStrategy,
  togglePriceAlert,
  updateCashSettings,
  updatePosition,
  updateProfile,
  updateTransaction
} from "@/lib/portfolio";
import { deletePushToken, registerPushToken } from "@/lib/push";
import { assertEmailAvailable, getUserRecord, saveUserRecord, validateAccountProfile } from "@/lib/userStore";
import type { TradeInput } from "@/lib/types";

export const runtime = "nodejs";

async function requireRecord(request: NextRequest) {
  const username = readSessionUsername(request);
  if (!username) {
    throw new Error("Authentication required.");
  }
  const record = await getUserRecord(username);
  if (!record) {
    throw new Error("User record not found.");
  }
  return record;
}

export async function GET(request: NextRequest) {
  try {
    const record = await requireRecord(request);
    const response = await buildPortfolioResponse(record);
    await saveUserRecord(record.username, record);
    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Portfolio load failed." }, { status: 401 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const record = await requireRecord(request);
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action || "");

    if (action === "add_alert") {
      addPriceAlert(record, {
        symbol: String(body.symbol || ""),
        direction: String(body.direction || "above"),
        targetPrice: Number(body.targetPrice)
      });
    } else if (action === "toggle_alert") {
      togglePriceAlert(record, String(body.alertId || ""));
    } else if (action === "delete_alert") {
      deletePriceAlert(record, String(body.alertId || ""));
    } else if (action === "register_push_token") {
      registerPushToken(record, {
        token: String(body.token || ""),
        userAgent: String(body.userAgent || request.headers.get("user-agent") || "")
      });
    } else if (action === "delete_push_token") {
      deletePushToken(record, String(body.tokenOrId || ""));
    } else if (action === "save_strategy") {
      saveStrategy(record, body.strategy);
    } else if (action === "delete_strategy") {
      deleteStrategy(record, String(body.strategyId || ""));
    } else if (action === "update_cash_settings") {
      updateCashSettings(record, {
        includeCash: body.includeCash,
        cashBalance: body.cashBalance,
        cashCurrency: body.cashCurrency
      });
    } else if (action === "update_position") {
      updatePosition(record, {
        symbol: body.symbol,
        quantity: body.quantity,
        avgCost: body.avgCost,
        currency: body.currency
      });
    } else if (action === "import_positions") {
      importPositions(record, {
        positions: body.positions,
        mode: body.mode,
        cashBalance: body.cashBalance,
        cashCurrency: body.cashCurrency,
        includeCash: body.includeCash
      });
    } else if (action === "update_transaction") {
      updateTransaction(record, {
        transactionId: body.transactionId,
        type: body.type,
        symbol: body.symbol,
        quantity: body.quantity,
        price: body.price,
        currency: body.currency,
        createdAt: body.createdAt
      });
    } else if (action === "update_profile") {
      const profile = validateAccountProfile({
        displayName: String(body.displayName || ""),
        email: String(body.email || "")
      });
      await assertEmailAvailable(profile.email, record.username);
      updateProfile(record, {
        displayName: profile.displayName,
        email: profile.email
      });
    } else {
      throw new Error("Unsupported portfolio action.");
    }

    await saveUserRecord(record.username, record);
    return NextResponse.json(await buildPortfolioResponse(record));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Portfolio update failed." }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const record = await requireRecord(request);
    const body = (await request.json()) as Partial<TradeInput>;
    const updatedRecord = applyTrade(record, {
      type: body.type === "SELL" ? "SELL" : "BUY",
      symbol: String(body.symbol || ""),
      quantity: Number(body.quantity),
      price: Number(body.price),
      currency: body.currency ? String(body.currency) : undefined,
      sellAll: body.sellAll === true
    });
    await saveUserRecord(updatedRecord.username, updatedRecord);
    return NextResponse.json(await buildPortfolioResponse(updatedRecord));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Trade failed." }, { status: 400 });
  }
}
