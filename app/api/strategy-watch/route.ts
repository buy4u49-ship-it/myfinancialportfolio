import { NextRequest, NextResponse } from "next/server";
import { evaluateStrategyNotifications } from "@/lib/strategyWatch";
import { listUserRecords, saveUserRecord } from "@/lib/userStore";

export const runtime = "nodejs";

function requireSecret(request: NextRequest) {
  const secret = process.env.STRATEGY_WATCH_SECRET || process.env.CRON_SECRET || "";
  if (!secret) {
    throw new Error("STRATEGY_WATCH_SECRET or CRON_SECRET is not configured.");
  }
  const header = request.headers.get("authorization") || "";
  if (header !== `Bearer ${secret}`) {
    throw new Error("Invalid strategy watch secret.");
  }
}

async function runStrategyWatch(request: NextRequest) {
  try {
    requireSecret(request);
    const records = await listUserRecords();
    const results: Array<{ username: string; notificationCount: number }> = [];
    for (const record of records) {
      const notifications = await evaluateStrategyNotifications(record);
      await saveUserRecord(record.username, record);
      results.push({ username: record.username, notificationCount: notifications.length });
    }
    return NextResponse.json({ ok: true, results, checkedAt: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Strategy watch failed." }, { status: 400 });
  }
}

export async function GET(request: NextRequest) {
  return runStrategyWatch(request);
}

export async function POST(request: NextRequest) {
  return runStrategyWatch(request);
}
