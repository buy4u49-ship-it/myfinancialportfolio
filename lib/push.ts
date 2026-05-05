import crypto from "node:crypto";
import type { PushToken, UserRecord } from "./types";

function utcNowIso() {
  return new Date().toISOString();
}

export function normalizePushTokens(record: UserRecord): PushToken[] {
  return (Array.isArray(record.push_tokens) ? record.push_tokens : [])
    .filter((item): item is PushToken => Boolean(item && typeof item === "object" && item.token))
    .map((item) => ({
      id: String(item.id || crypto.randomUUID()),
      provider: "fcm_web",
      token: String(item.token),
      enabled: item.enabled !== false,
      created_at: String(item.created_at || utcNowIso()),
      updated_at: String(item.updated_at || utcNowIso()),
      user_agent: item.user_agent ? String(item.user_agent) : "",
      last_used_at: item.last_used_at ? String(item.last_used_at) : ""
    }));
}

export function registerPushToken(record: UserRecord, input: { token: string; userAgent?: string }) {
  const token = String(input.token || "").trim();
  if (!token) {
    throw new Error("Push token is required.");
  }
  const now = utcNowIso();
  const tokens = normalizePushTokens(record);
  const existing = tokens.find((item) => item.token === token);
  if (existing) {
    existing.enabled = true;
    existing.updated_at = now;
    existing.user_agent = input.userAgent || existing.user_agent || "";
  } else {
    tokens.push({
      id: crypto.randomUUID(),
      provider: "fcm_web",
      token,
      enabled: true,
      created_at: now,
      updated_at: now,
      user_agent: input.userAgent || ""
    });
  }
  record.push_tokens = tokens;
  return record;
}

export function deletePushToken(record: UserRecord, tokenOrId: string) {
  const needle = String(tokenOrId || "").trim();
  record.push_tokens = normalizePushTokens(record).filter((item) => item.id !== needle && item.token !== needle);
  return record;
}

function firebaseServerKey() {
  return process.env.FCM_SERVER_KEY || process.env.FIREBASE_SERVER_KEY || "";
}

function firebaseProjectId() {
  return process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "";
}

function firebaseClientEmail() {
  return process.env.FIREBASE_CLIENT_EMAIL || "";
}

function firebasePrivateKey() {
  return (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
}

function base64Url(input: string) {
  return Buffer.from(input).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

let cachedAccessToken = "";
let cachedAccessTokenExpiresAt = 0;

async function firebaseAccessToken() {
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (cachedAccessToken && cachedAccessTokenExpiresAt - 60 > nowSeconds) {
    return cachedAccessToken;
  }

  const clientEmail = firebaseClientEmail();
  const privateKey = firebasePrivateKey();
  if (!clientEmail || !privateKey) {
    return "";
  }

  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(
    JSON.stringify({
      iss: clientEmail,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: nowSeconds,
      exp: nowSeconds + 3600
    })
  );
  const unsigned = `${header}.${claim}`;
  const signature = crypto.createSign("RSA-SHA256").update(unsigned).sign(privateKey, "base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const assertion = `${unsigned}.${signature}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    }).toString()
  });
  if (!response.ok) {
    return "";
  }
  const payload = (await response.json()) as { access_token?: string; expires_in?: number };
  cachedAccessToken = payload.access_token || "";
  cachedAccessTokenExpiresAt = nowSeconds + Number(payload.expires_in || 3600);
  return cachedAccessToken;
}

async function sendFcmV1Message(token: string, payload: { title: string; body: string; data?: Record<string, string> }) {
  const projectId = firebaseProjectId();
  const accessToken = await firebaseAccessToken();
  if (!projectId || !accessToken) {
    return { ok: false, reason: "Firebase HTTP v1 credentials are not configured." };
  }
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify({
      message: {
        token,
        notification: {
          title: payload.title,
          body: payload.body
        },
        webpush: {
          notification: {
            icon: "/brand/mfp-icon.svg"
          }
        },
        data: payload.data || {}
      }
    })
  });
  return { ok: response.ok, reason: response.ok ? "" : `FCM v1 request failed with ${response.status}.` };
}

async function sendFcmLegacy(tokens: PushToken[], payload: { title: string; body: string; data?: Record<string, string> }) {
  const serverKey = firebaseServerKey();
  if (!serverKey) {
    return { sent: false, reason: "Firebase HTTP v1 credentials or FCM_SERVER_KEY are not configured." };
  }
  const response = await fetch("https://fcm.googleapis.com/fcm/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `key=${serverKey}`
    },
    body: JSON.stringify({
      registration_ids: tokens.slice(0, 500).map((item) => item.token),
      notification: {
        title: payload.title,
        body: payload.body,
        icon: "/brand/mfp-icon.svg"
      },
      data: payload.data || {}
    })
  });

  if (!response.ok) {
    return { sent: false, reason: `FCM request failed with ${response.status}.` };
  }
  return { sent: true, reason: "" };
}

export async function sendPushToUser(
  record: UserRecord,
  payload: { title: string; body: string; data?: Record<string, string> }
) {
  const tokens = normalizePushTokens(record).filter((item) => item.enabled);
  record.push_tokens = tokens;
  if (!tokens.length) {
    return { sent: false, reason: "No push tokens registered." };
  }
  const v1Results = await Promise.all(tokens.map((token) => sendFcmV1Message(token.token, payload)));
  const sentByV1 = v1Results.some((result) => result.ok);
  if (!sentByV1) {
    const legacy = await sendFcmLegacy(tokens, payload);
    if (!legacy.sent) {
      return legacy;
    }
  }

  const now = utcNowIso();
  tokens.forEach((token) => {
    token.last_used_at = now;
  });
  record.push_tokens = tokens;
  return { sent: true, reason: "" };
}
