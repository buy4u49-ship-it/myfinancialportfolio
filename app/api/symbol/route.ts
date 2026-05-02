import { NextRequest, NextResponse } from "next/server";
import { buildSymbolDetail, type ChartRange } from "@/lib/marketData";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol") || "AAPL";
  const range = (request.nextUrl.searchParams.get("range") || "1M").toUpperCase() as ChartRange;
  try {
    return NextResponse.json(await buildSymbolDetail(symbol, range));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Symbol detail failed." }, { status: 500 });
  }
}
