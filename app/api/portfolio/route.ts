import { NextRequest, NextResponse } from "next/server";
import { readSessionUsername } from "@/lib/auth";
import { applyTrade, buildPortfolioResponse } from "@/lib/portfolio";
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
    return NextResponse.json(await buildPortfolioResponse(record));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Portfolio load failed." }, { status: 401 });
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
