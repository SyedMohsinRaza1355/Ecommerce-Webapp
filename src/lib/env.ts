export function env() {
  return {
    mongoUri: process.env.MONGODB_URI ?? "",
    platformDb: process.env.PLATFORM_DB_NAME ?? "platform",
    sessionSecret: process.env.SESSION_SECRET ?? "",
    baseDomain: (process.env.PLATFORM_BASE_DOMAIN ?? "localhost:3000").toLowerCase(),
  };
}

export function requireEnv(name: "mongoUri" | "sessionSecret"): string {
  const v = env()[name];
  if (!v) throw new Error(`Missing required configuration: ${name}`);
  return v;
}
