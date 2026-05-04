import { NextRequest, NextResponse } from "next/server";
import { publicUserPayload } from "@/lib/admin";
import { authenticate } from "@/lib/userStore";
import { setSessionCookie } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { username?: string; password?: string };
    const record = await authenticate(String(body.username || ""), String(body.password || ""));
    const response = NextResponse.json({ user: publicUserPayload(record) });
    setSessionCookie(response, record.username);
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Login failed." }, { status: 401 });
  }
}
