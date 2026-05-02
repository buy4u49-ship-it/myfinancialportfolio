export function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured.`);
  }
  return value;
}

export function supabaseUrl() {
  return requireEnv("SUPABASE_URL").replace(/\/+$/, "");
}

export function supabaseServiceRoleKey() {
  return requireEnv("SUPABASE_SERVICE_ROLE_KEY");
}

export function sessionSecret() {
  return process.env.SESSION_SECRET || supabaseServiceRoleKey();
}
