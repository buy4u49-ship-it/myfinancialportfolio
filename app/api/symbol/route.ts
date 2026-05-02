import { NextRequest, NextResponse } from "next/server";
import { buildSymbolDetail } from "@/lib/marketData";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol") || "AAPL";
  try {
    return NextResponse.json(await buildSymbolDetail(symbol));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Symbol detail failed." }, { status: 500 });
  }
}
