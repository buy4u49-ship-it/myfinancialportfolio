import { NextRequest, NextResponse } from "next/server";
import { getStrategyUniverse } from "@/lib/strategyMetricCache";
import type { StrategyMarket } from "@/lib/types";

export const runtime = "nodejs";

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message || "");
  }
  return String(error || "");
}

function requireSecret(request: NextRequest) {
  const secret = process.env.STRATEGY_UNIVERSE_SECRET || process.env.STRATEGY_METRICS_SECRET || process.env.CRON_SECRET || "";
  if (!secret) {
    throw new Error("STRATEGY_UNIVERSE_SECRET, STRATEGY_METRICS_SECRET, or CRON_SECRET is not configured.");
  }
  if ((request.headers.get("authorization") || "") !== `Bearer ${secret}`) {
    throw new Error("Invalid strategy universe secret.");
  }
}

function parseMarkets(input: string | null): StrategyMarket[] {
  const markets = String(input || "us,korea")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item): item is StrategyMarket => item === "us" || item === "korea" || item === "crypto");
  return markets.length ? markets : ["us", "korea"];
}

export async function GET(request: NextRequest) {
  try {
    requireSecret(request);
    const markets = parseMarkets(request.nextUrl.searchParams.get("market"));
    const results = await Promise.all(markets.map(async (market) => ({ market, symbols: await getStrategyUniverse(market) })));
    return NextResponse.json({
      markets: results,
      symbols: Array.from(new Set(results.flatMap((item) => item.symbols))).sort(),
      refreshedAt: new Date().toISOString()
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) || "Strategy universe load failed." }, { status: 400 });
  }
}
