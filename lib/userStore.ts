import { hashPassword, verifyPassword } from "./auth";
import { normalizeUsername } from "./symbols";
import { supabaseAdmin } from "./supabaseAdmin";
import type { UserRecord } from "./types";

const USER_TABLE = "app_user_records";

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
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
    throw new Error("That email is already used by another account.");
  }
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
  const existing = await getUserRecord(username);
  if (existing) {
    throw new Error("That username already exists.");
  }
  await assertEmailAvailable(input.email || "", username);

  const { salt, digest } = hashPassword(input.password);
  const record = defaultUserRecord(username);
  record.password_salt = salt;
  record.password_hash = digest;
  record.profile = {
    display_name: input.displayName?.trim() || username,
    email: normalizeEmail(input.email || "")
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
