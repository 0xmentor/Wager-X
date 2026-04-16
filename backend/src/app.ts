import fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import sensible from "@fastify/sensible";
import websocket from "@fastify/websocket";
import { config } from "./config.js";
import storagePlugin from "./plugins/storage.js";
import authPlugin from "./plugins/auth.js";
import rateLimitPlugin from "./plugins/rateLimit.js";
import authRoutes from "./routes/auth.js";
import gameRoutes from "./routes/games.js";
import sessionRoutes from "./routes/sessions.js";
import wsRoutes from "./routes/ws.js";
import { isBlockedCountry } from "./services/compliance.js";

export function buildApp() {
  const app = fastify({ logger: true, trustProxy: true });

  app.register(sensible);
  app.register(cookie);
  app.register(cors, {
    origin: (origin: string | undefined, cb: (err: Error | null, allow: boolean) => void) => {
      const localLoopbackOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin ?? "");
      const allowLocalLoopback = config.nodeEnv !== "production" && localLoopbackOrigin;
      if (!origin || config.corsOrigins.includes(origin) || allowLocalLoopback) {
        cb(null, true);
        return;
      }
      cb(new Error("Origin not allowed"), false);
    },
    credentials: true
  });

  app.register(websocket);
  app.register(rateLimitPlugin);
  app.register(storagePlugin);
  app.register(authPlugin);

  app.addHook("preHandler", async (req: any, reply: any) => {
    const country = req.headers["x-country-code"];
    if (typeof country === "string" && isBlockedCountry(country)) {
      return reply.forbidden("Region restricted");
    }
  });

  app.get("/health", async () => ({ ok: true }));
  app.register(authRoutes, { prefix: "/auth" });
  app.register(gameRoutes, { prefix: "/games" });
  app.register(sessionRoutes, { prefix: "/me" });
  app.register(wsRoutes, { prefix: "/ws" });

  return app;
}
