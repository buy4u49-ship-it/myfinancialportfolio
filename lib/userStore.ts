import crypto from "node:crypto";
import { hashPassword, verifyPassword } from "./auth";
import { normalizeUsername } from "./symbols";
import { supabaseAdmin } from "./supabaseAdmin";
import type { UserRecord } from "./types";

const USER_TABLE = "app_user_records";

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function tokenHash(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function safeEqualHex(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function requireDisplayName(displayName: string) {
  const normalized = displayName.trim();
  if (!normalized) {
    throw new Error("Display name is required.");
  }
  return normalized;
}

function requireEmail(email: string) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    throw new Error("Email address is required.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error("Enter a valid email address.");
  }
  return normalized;
}

export function validateAccountProfile(input: { displayName?: string; email?: string }) {
  return {
    displayName: requireDisplayName(String(input.displayName || "")),
    email: requireEmail(String(input.email || ""))
  };
}

export function utcNowIso() {
  return new Date().toISOString();
}

export function defaultUserRecord(username: string): UserRecord {
  return {
    username,
    created_at: utcNowIso(),
    profile: {
      display_name: username,
      email: ""
    },
    portfolio: [],
    transactions: [],
    alerts: [],
    push_tokens: [],
    strategies: [],
    strategy_snapshots: [],
    remember_tokens: []
  };
}

export async function getUserRecord(username: string) {
  const normalized = normalizeUsername(username);
  if (!normalized) {
    return null;
  }

  const { data, error } = await supabaseAdmin()
    .from(USER_TABLE)
    .select("username,record")
    .eq("username", normalized)
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data || typeof data.record !== "object" || data.record === null) {
    return null;
  }

  const record = data.record as UserRecord;
  record.username = normalized;
  record.portfolio = Array.isArray(record.portfolio) ? record.portfolio : [];
  record.transactions = Array.isArray(record.transactions) ? record.transactions : [];
  record.alerts = Array.isArray(record.alerts) ? record.alerts : [];
  record.push_tokens = Array.isArray(record.push_tokens) ? record.push_tokens : [];
  record.strategies = Array.isArray(record.strategies) ? record.strategies : [];
  record.strategy_snapshots = Array.isArray(record.strategy_snapshots) ? record.strategy_snapshots : [];
  return record;
}

export async function listUserRecords() {
  const { data, error } = await supabaseAdmin()
    .from(USER_TABLE)
    .select("username,record")
    .order("username", { ascending: true });

  if (error) {
    throw error;
  }

  return (data || [])
    .map((row) => {
      if (!row || typeof row.record !== "object" || row.record === null) {
        return null;
      }
      const record = row.record as UserRecord;
      record.username = normalizeUsername(String(row.username || record.username || ""));
      record.portfolio = Array.isArray(record.portfolio) ? record.portfolio : [];
      record.transactions = Array.isArray(record.transactions) ? record.transactions : [];
      record.alerts = Array.isArray(record.alerts) ? record.alerts : [];
      record.push_tokens = Array.isArray(record.push_tokens) ? record.push_tokens : [];
      record.strategies = Array.isArray(record.strategies) ? record.strategies : [];
      record.strategy_snapshots = Array.isArray(record.strategy_snapshots) ? record.strategy_snapshots : [];
      return record.username ? record : null;
    })
    .filter((record): record is UserRecord => record !== null);
}

export async function saveUserRecord(username: string, record: UserRecord) {
  const normalized = normalizeUsername(username);
  record.username = normalized;
  const { error } = await supabaseAdmin()
    .from(USER_TABLE)
    .upsert({ username: normalized, record }, { onConflict: "username" });

  if (error) {
    throw error;
  }
}

export async function deleteUserRecord(username: string) {
  const normalized = normalizeUsername(username);
  if (!normalized) {
    throw new Error("User record not found.");
  }
  const { error } = await supabaseAdmin().from(USER_TABLE).delete().eq("username", normalized);
  if (error) {
    throw error;
  }
}

export async function assertEmailAvailable(email: string, currentUsername = "") {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return;
  }
  const normalizedCurrentUsername = normalizeUsername(currentUsername);
  const records = await listUserRecords();
  const existing = records.find((record) => {
    const recordEmail = normalizeEmail(record.profile?.email || "");
    return recordEmail === normalizedEmail && normalizeUsername(record.username) !== normalizedCurrentUsername;
  });
  if (existing) {
    throw new Error("\uC774\uBBF8 \uACC4\uC815\uC774 \uC788\uB294 \uBA54\uC77C \uC8FC\uC18C\uC785\uB2C8\uB2E4.");
  }
}

export async function findUserByEmail(email: string) {
  const normalizedEmail = requireEmail(email);
  const records = await listUserRecords();
  return (
    records.find((record) => normalizeEmail(record.profile?.email || "") === normalizedEmail) || null
  );
}

export async function createAccount(input: {
  username: string;
  password: string;
  displayName?: string;
  email?: string;
}) {
  const username = normalizeUsername(input.username);
  if (username.length < 3 || !/^[a-z0-9_-]+$/.test(username)) {
    throw new Error("Use at least 3 letters, numbers, underscores, or hyphens for the username.");
  }
  if (input.password.length < 8) {
    throw new Error("Use at least 8 characters for the password.");
  }
  const profile = validateAccountProfile(input);
  const existing = await getUserRecord(username);
  if (existing) {
    throw new Error("That username already exists.");
  }
  await assertEmailAvailable(profile.email, username);

  const { salt, digest } = hashPassword(input.password);
  const record = defaultUserRecord(username);
  record.password_salt = salt;
  record.password_hash = digest;
  record.profile = {
    display_name: profile.displayName,
    email: profile.email
  };
  await saveUserRecord(username, record);
  return record;
}

export async function authenticate(username: string, password: string) {
  const record = await getUserRecord(username);
  if (!record || !record.password_salt || !record.password_hash) {
    throw new Error("No account exists for that username.");
  }
  if (!verifyPassword(password, record.password_salt, record.password_hash)) {
    throw new Error("Password does not match.");
  }
  return record;
}

export async function createPasswordResetToken(email: string) {
  const record = await findUserByEmail(email);
  if (!record) {
    throw new Error("No account exists for that email address.");
  }
  const token = crypto.randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  record.password_reset = {
    token_hash: tokenHash(token),
    created_at: utcNowIso(),
    expires_at: expiresAt
  };
  await saveUserRecord(record.username, record);
  return {
    username: record.username,
    displayName: record.profile?.display_name || record.username,
    email: normalizeEmail(record.profile?.email || ""),
    token,
    expiresAt
  };
}

export async function resetPasswordWithToken(email: string, token: string, password: string) {
  if (password.length < 8) {
    throw new Error("Use at least 8 characters for the password.");
  }
  const record = await findUserByEmail(email);
  if (!record || !record.password_reset) {
    throw new Error("Password reset request was not found.");
  }
  const reset = record.password_reset;
  const expires = Date.parse(reset.expires_at);
  if (!Number.isFinite(expires) || expires < Date.now()) {
    record.password_reset = undefined;
    await saveUserRecord(record.username, record);
    throw new Error("Password reset code has expired.");
  }
  const submittedHash = tokenHash(token.trim());
  if (!safeEqualHex(reset.token_hash, submittedHash)) {
    throw new Error("Password reset code is invalid.");
  }
  const { salt, digest } = hashPassword(password);
  record.password_salt = salt;
  record.password_hash = digest;
  record.password_reset = undefined;
  await saveUserRecord(record.username, record);
  return record;
}
