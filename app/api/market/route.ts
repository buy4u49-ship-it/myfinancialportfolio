import { NextRequest, NextResponse } from "next/server";
import { buildMarketPage, marketKeys } from "@/lib/marketData";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const market = request.nextUrl.searchParams.get("market") || "crypto";
  if (!marketKeys().includes(market as never)) {
    return NextResponse.json({ error: "Unsupported market." }, { status: 400 });
  }
  try {
    return NextResponse.json(await buildMarketPage(market as "crypto" | "us" | "korea"));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Market page failed." }, { status: 500 });
  }
}
