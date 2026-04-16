import { describe, expect, it } from "vitest";
describe("config", () => {
  it("loads required environment defaults", async () => {
    process.env.JWT_ACCESS_SECRET = "test-access";
    process.env.JWT_REFRESH_SECRET = "test-refresh";
    process.env.DATABASE_URL = "postgres://localhost/test";
    process.env.REDIS_URL = "redis://localhost:6379";
    const { config } = await import("./config.js");

    expect(config.port).toBeGreaterThan(0);
    expect(config.jwtAccessTtlSeconds).toBeGreaterThan(0);
  });
});
