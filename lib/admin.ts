import { NextRequest } from "next/server";
import { readSessionUsername } from "./auth";
import { normalizeUsername } from "./symbols";
import { getUserRecord } from "./userStore";
import type { UserRecord } from "./types";

function configuredAdminUsernames() {
  return (process.env.ADMIN_USERNAMES || process.env.ADMIN_USERNAME || "")
    .split(",")
    .map((item) => normalizeUsername(item))
    .filter(Boolean);
}

export function isAdminRecord(record: UserRecord | null) {
  if (!record) {
    return false;
  }
  const admins = configuredAdminUsernames();
  if (!admins.length) {
    return false;
  }
  return admins.includes(normalizeUsername(record.username));
}

export function publicUserPayload(record: UserRecord) {
  return {
    username: record.username,
    displayName: record.profile?.display_name || record.username,
    email: record.profile?.email || "",
    isAdmin: isAdminRecord(record)
  };
}

export async function requireAdminRecord(request: NextRequest) {
  const username = readSessionUsername(request);
  if (!username) {
    throw new Error("Authentication required.");
  }
  const record = await getUserRecord(username);
  if (!record) {
    throw new Error("User record not found.");
  }
  if (!isAdminRecord(record)) {
    throw new Error("Admin permission required.");
  }
  return record;
}

