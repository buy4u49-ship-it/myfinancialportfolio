import { NextRequest, NextResponse } from "next/server";
import { readSessionUsername } from "@/lib/auth";
import { addPriceAlert, applyTrade, buildPortfolioResponse, deletePriceAlert, togglePriceAlert, updateProfile } from "@/lib/portfolio";
import { getUserRecord, saveUserRecord } from "@/lib/userStore";
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
    } else if (action === "update_profile") {
      updateProfile(record, {
        displayName: String(body.displayName || ""),
        email: String(body.email || "")
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
      currency: body.currency ? String(body.currency) : undefined
    });
    await saveUserRecord(updatedRecord.username, updatedRecord);
    return NextResponse.json(await buildPortfolioResponse(updatedRecord));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Trade failed." }, { status: 400 });
  }
}
