import { NextRequest, NextResponse } from "next/server";
import { readSessionUsername } from "@/lib/auth";
import { publicUserPayload } from "@/lib/admin";
import { getUserRecord } from "@/lib/userStore";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const username = readSessionUsername(request);
    if (!username) {
      return NextResponse.json({ user: null });
    }
    const record = await getUserRecord(username);
    if (!record) {
      return NextResponse.json({ user: null });
    }
    return NextResponse.json({ user: publicUserPayload(record) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Session check failed." }, { status: 500 });
  }
}
