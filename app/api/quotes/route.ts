import { NextRequest, NextResponse } from "next/server";
import { getQuotes } from "@/lib/prices";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const symbols = (request.nextUrl.searchParams.get("symbols") || "")
    .split(",")
    .map((symbol) => symbol.trim())
    .filter(Boolean);
  const quotes = await getQuotes(symbols);
  return NextResponse.json({
    quotes: Array.from(quotes.values()),
    refreshedAt: new Date().toISOString()
  });
}
