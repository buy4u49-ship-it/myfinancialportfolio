import { NextRequest, NextResponse } from "next/server";
import { buildSymbolDetail, type ChartRange } from "@/lib/marketData";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol") || "AAPL";
  const range = (request.nextUrl.searchParams.get("range") || "1M").toUpperCase() as ChartRange;
  const benchmark = request.nextUrl.searchParams.get("benchmark") || "SPY";
  const historyYears = Number(request.nextUrl.searchParams.get("historyYears") || 20);
  const rollingWindow = Number(request.nextUrl.searchParams.get("rollingWindow") || 36);
  try {
    return NextResponse.json(await buildSymbolDetail(symbol, range, { benchmark, historyYears, rollingWindow }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Symbol detail failed." }, { status: 500 });
  }
}
