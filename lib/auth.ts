import crypto from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { sessionSecret } from "./env";

export const SESSION_COOKIE = "portfolio_session";
const PASSWORD_HASH_ITERATIONS = 200_000;
const SESSION_DAYS = 30;

function base64UrlEncode(input: Buffer | string) {
  return Buffer.from(input).toString("base64url");
}

function base64UrlDecode(input: string) {
  return Buffer.from(input, "base64url").toString("utf-8");
}

function sign(value: string) {
  return crypto.createHmac("sha256", sessionSecret()).update(value).digest("base64url");
}

export function hashPassword(password: string, salt?: string) {
  const passwordSalt = salt || crypto.randomBytes(16).toString("hex");
  const digest = crypto
    .pbkdf2Sync(password, Buffer.from(passwordSalt, "hex"), PASSWORD_HASH_ITERATIONS, 32, "sha256")
    .toString("hex");
  return { salt: passwordSalt, digest };
}

export function verifyPassword(password: string, salt: string, digest: string) {
  const candidate = hashPassword(password, salt).digest;
  try {
    return crypto.timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(digest, "hex"));
  } catch {
    return false;
  }
}

export function createSessionToken(username: string) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 24 * 60 * 60;
  const payload = base64UrlEncode(JSON.stringify({ username, exp }));
  return `${payload}.${sign(payload)}`;
}

export function readSessionUsername(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value || "";
  const [payload, signature] = token.split(".");
  if (!payload || !signature || sign(payload) !== signature) {
    return "";
  }

  try {
    const parsed = JSON.parse(base64UrlDecode(payload)) as { username?: string; exp?: number };
    if (!parsed.username || !parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) {
      return "";
    }
    return parsed.username;
  } catch {
    return "";
  }
}

export function setSessionCookie(response: NextResponse, username: string) {
  response.cookies.set(SESSION_COOKIE, createSessionToken(username), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60
  });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0
  });
}
