import { NextRequest, NextResponse } from "next/server";
import { setSessionCookie } from "@/lib/auth";
import { createAccount } from "@/lib/userStore";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      username?: string;
      password?: string;
      displayName?: string;
      email?: string;
    };
    const record = await createAccount({
      username: String(body.username || ""),
      password: String(body.password || ""),
      displayName: String(body.displayName || ""),
      email: String(body.email || "")
    });
    const response = NextResponse.json({
      user: {
        username: record.username,
        displayName: record.profile?.display_name || record.username
      }
    });
    setSessionCookie(response, record.username);
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Registration failed." }, { status: 400 });
  }
}
