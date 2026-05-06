import { NextRequest, NextResponse } from "next/server";
import { publicUserPayload } from "@/lib/admin";
import { setSessionCookie } from "@/lib/auth";
import { createPasswordResetToken, findUserByEmail, resetPasswordWithToken } from "@/lib/userStore";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      action?: string;
      email?: string;
      token?: string;
      password?: string;
    };
    const action = String(body.action || "");
    if (action === "find_username") {
      const record = await findUserByEmail(String(body.email || ""));
      if (!record) {
        throw new Error("No account exists for that email address.");
      }
      return NextResponse.json({
        username: record.username,
        displayName: record.profile?.display_name || record.username
      });
    }

    if (action === "request_password_reset") {
      const reset = await createPasswordResetToken(String(body.email || ""));
      return NextResponse.json({
        username: reset.username,
        displayName: reset.displayName,
        expiresAt: reset.expiresAt,
        resetToken: reset.token
      });
    }

    if (action === "reset_password") {
      const record = await resetPasswordWithToken(
        String(body.email || ""),
        String(body.token || ""),
        String(body.password || "")
      );
      const response = NextResponse.json({ user: publicUserPayload(record) });
      setSessionCookie(response, record.username);
      return response;
    }

    throw new Error("Unsupported recovery action.");
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Account recovery failed." }, { status: 400 });
  }
}
