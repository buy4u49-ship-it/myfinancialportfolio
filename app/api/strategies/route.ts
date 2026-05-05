import { NextRequest, NextResponse } from "next/server";
import { readSessionUsername } from "@/lib/auth";
import { evaluateStrategy } from "@/lib/strategies";
import { getUserRecord } from "@/lib/userStore";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const username = readSessionUsername(request);
    if (!username) {
      throw new Error("Authentication required.");
    }
    const record = await getUserRecord(username);
    if (!record) {
      throw new Error("User record not found.");
    }
    const body = (await request.json()) as Record<string, unknown>;
    const evaluation = await evaluateStrategy(body.strategy);
    return NextResponse.json(evaluation);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Strategy evaluation failed." }, { status: 400 });
  }
}
