import { NextRequest, NextResponse } from "next/server";
import { requireAdminRecord } from "@/lib/admin";
import { refreshFinancialFundamentalsCache } from "@/lib/financialFundamentalsCache";
import { refreshMarketMetricSnapshot } from "@/lib/marketMetricSnapshot";
import type { StrategyMarket } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

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

function parseScope(input: unknown) {
  const scope = String(input || "all").trim().toLowerCase();
  return scope === "fundamentals" || scope === "metrics" ? scope : "all";
}

function emptyResult(markets: StrategyMarket[] | undefined) {
  return {
    markets: markets || [],
    universeCount: 0,
    cachedCount: 0,
    staleCount: 0,
    refreshedCount: 0,
    errors: [],
    refreshedAt: new Date().toISOString(),
    timeBudgetReached: false
  };
}

export async function refreshStrategyMetricsRequest(request: NextRequest, body: Record<string, unknown> = {}) {
  try {
    await requireRefreshAccess(request);
    const params = request.nextUrl.searchParams;
    const markets = parseMarkets(body.markets ?? body.market ?? params.get("market"));
    const scope = parseScope(body.scope ?? params.get("scope"));
    const routeStartedAt = Date.now();
    const routeBudgetMs = 45_000;
    const remainingBudgetMs = () => Math.max(5_000, routeBudgetMs - (Date.now() - routeStartedAt));
    const requestedLimit = Math.max(1, Math.min(5_000, Math.round(Number(body.limit ?? params.get("limit") ?? 20))));
    const force = body.force === true || params.get("force") === "true";
    const fundamentalLimit = Math.min(50, requestedLimit);
    const metricLimit = requestedLimit;
    const fundamentalResult =
      scope === "metrics"
        ? emptyResult(markets)
        : await refreshFinancialFundamentalsCache({
            markets,
            limit: fundamentalLimit,
            force,
            deadlineMs: scope === "all" ? 20_000 : remainingBudgetMs()
          });
    const metricResult =
      scope === "fundamentals"
        ? emptyResult(markets)
        : await refreshMarketMetricSnapshot({
            markets,
            limit: metricLimit,
            force,
            deadlineMs: remainingBudgetMs()
          });
    return NextResponse.json({
      ok: true,
      scope,
      ...fundamentalResult,
      universeCount: Math.max(fundamentalResult.universeCount, metricResult.universeCount),
      metricRefreshedCount: metricResult.refreshedCount,
      metricCachedCount: metricResult.cachedCount,
      metricStaleCount: metricResult.staleCount,
      metricErrors: metricResult.errors,
      timeBudgetReached: Boolean(fundamentalResult.timeBudgetReached || metricResult.timeBudgetReached),
      errors: [...fundamentalResult.errors, ...metricResult.errors]
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) || "Strategy metrics refresh failed." }, { status: 400 });
  }
}

export async function GET(request: NextRequest) {
  return refreshStrategyMetricsRequest(request);
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  return refreshStrategyMetricsRequest(request, body);
}
