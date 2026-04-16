import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, "../.env") });

const nodeEnv = process.env.NODE_ENV ?? "development";
const required = ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"] as const;

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required env var: ${key}`);
  }
}

if (nodeEnv === "production" && !process.env.DATABASE_URL) {
  throw new Error("Missing required env var: DATABASE_URL");
}

export const config = {
  nodeEnv,
  host: process.env.HOST ?? "0.0.0.0",
  port: Number(process.env.PORT ?? 4000),
  corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:3000").split(",").filter(Boolean),
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET!,
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET!,
  jwtAccessTtlSeconds: Number(process.env.JWT_ACCESS_TTL ?? 900),
  jwtRefreshTtlSeconds: Number(process.env.JWT_REFRESH_TTL ?? 604800),
  accessCookieName: process.env.ACCESS_COOKIE_NAME ?? "wagerx_access",
  refreshCookieName: process.env.REFRESH_COOKIE_NAME ?? "wagerx_refresh",
  cookieDomain: process.env.AUTH_COOKIE_DOMAIN || undefined,
  cookieSameSite: (
    process.env.AUTH_COOKIE_SAME_SITE ?? (nodeEnv === "production" ? "none" : "lax")
  ) as "lax" | "strict" | "none",
  cookieSecure: nodeEnv === "production",
  databaseUrl: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/solbet",
  useRedis: process.env.USE_REDIS === "true",
  redisUrl: process.env.REDIS_URL
};
