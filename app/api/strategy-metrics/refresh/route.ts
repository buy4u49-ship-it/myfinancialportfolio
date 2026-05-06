import { NextRequest, NextResponse } from "next/server";
import { requireAdminRecord } from "@/lib/admin";
import { refreshFinancialFundamentalsCache } from "@/lib/financialFundamentalsCache";
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

function configuredSecret() {
  return process.env.STRATEGY_METRICS_SECRET || process.env.STRATEGY_WATCH_SECRET || process.env.CRON_SECRET || "";
}

function hasValidSecret(request: NextRequest) {
  const secret = configuredSecret();
  const header = request.headers.get("authorization") || "";
  return Boolean(secret && header === `Bearer ${secret}`);
}

function requireSecret(request: NextRequest) {
  const secret = configuredSecret();
  if (!secret) {
    throw new Error("STRATEGY_METRICS_SECRET, STRATEGY_WATCH_SECRET, or CRON_SECRET is not configured.");
  }
  const header = request.headers.get("authorization") || "";
  if (header !== `Bearer ${secret}`) {
    throw new Error("Invalid strategy metrics refresh secret.");
  }
}

async function requireRefreshAccess(request: NextRequest) {
  if (hasValidSecret(request)) {
    return;
  }
  if (request.method === "POST") {
    await requireAdminRecord(request);
    return;
  }
  requireSecret(request);
}

function parseMarkets(input: unknown): StrategyMarket[] | undefined {
  const raw = Array.isArray(input) ? input : String(input || "all").split(",");
  const markets = raw
    .map((item) => String(item).trim().toLowerCase())
    .filter((item): item is StrategyMarket => item === "us" || item === "korea" || item === "crypto");
  return markets.length ? markets : undefined;
}

async function refresh(request: NextRequest, body: Record<string, unknown> = {}) {
  try {
    await requireRefreshAccess(request);
    const params = request.nextUrl.searchParams;
    const result = await refreshFinancialFundamentalsCache({
      markets: parseMarkets(body.markets ?? body.market ?? params.get("market")),
      limit: Number(body.limit ?? params.get("limit") ?? 50),
      force: body.force === true || params.get("force") === "true"
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) || "Strategy metrics refresh failed." }, { status: 400 });
  }
}

export async function GET(request: NextRequest) {
  return refresh(request);
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  return refresh(request, body);
}
