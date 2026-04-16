import fp from "fastify-plugin";
import jwt from "@fastify/jwt";
import jsonwebtoken from "jsonwebtoken";
import { config } from "../config.js";
export default fp(async (app: any) => {
  await app.register(jwt, { secret: config.jwtAccessSecret });

  app.decorate("signAccessToken", async (payload: { wallet: string; sid: string }) => {
    return app.jwt.sign(payload, { expiresIn: config.jwtAccessTtlSeconds });
  });

  app.decorate("signRefreshToken", async (payload: { wallet: string; sid: string }) => {
    return jsonwebtoken.sign(payload, config.jwtRefreshSecret, {
      expiresIn: config.jwtRefreshTtlSeconds
    });
  });
});
