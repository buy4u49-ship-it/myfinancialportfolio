import { NextRequest } from "next/server";
import { refreshStrategyMetricsRequest } from "../route";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  return refreshStrategyMetricsRequest(request, { scope: "metrics", limit: 5000 });
}
