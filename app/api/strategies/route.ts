import { NextRequest, NextResponse } from "next/server";
import { readSessionUsername } from "@/lib/auth";
import { evaluateStrategy } from "@/lib/strategies";
import { getUserRecord } from "@/lib/userStore";

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
    const evaluation = await evaluateStrategy(body.strategy, {
      offset: Number(body.offset ?? 0),
      limit: Number(body.limit ?? 400)
    });
    return NextResponse.json(evaluation);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) || "Strategy evaluation failed." }, { status: 400 });
  }
}
