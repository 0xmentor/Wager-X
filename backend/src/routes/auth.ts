import { randomUUID } from "node:crypto";

import jwt from "jsonwebtoken";
import { z } from "zod";
import { config } from "../config.js";
import { createSession, issueNonce, revokeSession, rotateRefresh, verifySignature } from "../services/auth.js";
import { hashPassword, verifyPassword } from "../services/password.js";

const nonceSchema = z.object({ wallet: z.string().min(32).max(64) });
const verifySchema = z.object({
  wallet: z.string().min(32).max(64),
  signature: z.string().min(32),
  nonce: z.string().min(32)
});

const localSignupSchema = z.object({
  username: z.string().min(3).max(40),
  email: z.string().email().max(120),
  password: z.string().min(8).max(128)
});

const localSigninSchema = z.object({
  identifier: z.string().min(3).max(120),
  password: z.string().min(8).max(128)
});

const cookieOptions = {
  httpOnly: true,
  secure: config.cookieSecure,
  sameSite: config.cookieSameSite,
  domain: config.cookieDomain,
  path: "/"
} as const;

function setSessionCookies(reply: any, tokens: { accessToken: string; refreshToken: string }) {
  reply.setCookie(config.accessCookieName, tokens.accessToken, {
    ...cookieOptions,
    maxAge: config.jwtAccessTtlSeconds
  });

  reply.setCookie(config.refreshCookieName, tokens.refreshToken, {
    ...cookieOptions,
    maxAge: config.jwtRefreshTtlSeconds
  });
}

function clearSessionCookies(reply: any) {
  reply.clearCookie(config.accessCookieName, { ...cookieOptions });
  reply.clearCookie(config.refreshCookieName, { ...cookieOptions });
}

function safeUser(sessionId: string, username: string, email: string) {
  return {
    sessionId,
    user: { username, email, provider: "local" as const }
  };
}

const authRoutes = async (app: any) => {
  app.post("/nonce", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const parsed = nonceSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.badRequest(parsed.error.message);
    }
    return issueNonce(app, parsed.data.wallet);
  });

  app.post("/verify", { config: { rateLimit: { max: 15, timeWindow: "1 minute" } } }, async (req, reply) => {
    const parsed = verifySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.badRequest(parsed.error.message);
    }

    const wallet = parsed.data.wallet;
    const nonceKey = `auth:nonce:${wallet.toLowerCase()}`;
    const nonce = await app.kv.get(nonceKey);
    if (!nonce || nonce !== parsed.data.nonce) {
      return reply.unauthorized("Invalid nonce");
    }

    const valid = await verifySignature(wallet, parsed.data.signature, parsed.data.nonce);
    if (!valid) {
      return reply.unauthorized("Invalid wallet signature");
    }

    await app.kv.del(nonceKey);

    const session = await createSession(app, wallet, {
      userAgent: req.headers["user-agent"],
      ip: req.ip
    });
    setSessionCookies(reply, session);

    return {
      sessionId: session.sid,
      user: { wallet, provider: "wallet" as const }
    };
  });

  app.post("/local/signup", { config: { rateLimit: { max: 6, timeWindow: "1 minute" } } }, async (req, reply) => {
    const parsed = localSignupSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.badRequest(parsed.error.message);
    }

    const { username, email, password } = parsed.data;

    const exists = await app.pg.query(
      `SELECT id FROM local_users WHERE username = $1 OR email = $2 LIMIT 1`,
      [username, email]
    );
    if (exists.rowCount) {
      return reply.conflict("User already exists");
    }

    const userId = randomUUID();
    const passwordHash = hashPassword(password);

    await app.pg.query(
      `
      INSERT INTO local_users (id, username, email, password_hash, created_at)
      VALUES ($1, $2, $3, $4, NOW())
      `,
      [userId, username, email, passwordHash]
    );

    const session = await createSession(app, `local:${userId}`, {
      userAgent: req.headers["user-agent"],
      ip: req.ip
    });

    setSessionCookies(reply, session);
    return safeUser(session.sid, username, email);
  });

  app.post("/local/signin", { config: { rateLimit: { max: 8, timeWindow: "1 minute" } } }, async (req, reply) => {
    const parsed = localSigninSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.badRequest(parsed.error.message);
    }

    const { identifier, password } = parsed.data;

    const result = await app.pg.query(
      `
      SELECT id, username, email, password_hash
      FROM local_users
      WHERE lower(username) = lower($1) OR lower(email) = lower($1)
      LIMIT 1
      `,
      [identifier]
    );

    if (result.rowCount !== 1) {
      return reply.unauthorized("Invalid credentials");
    }

    const user = result.rows[0];
    if (!verifyPassword(password, user.password_hash)) {
      return reply.unauthorized("Invalid credentials");
    }

    const session = await createSession(app, `local:${user.id}`, {
      userAgent: req.headers["user-agent"],
      ip: req.ip
    });

    setSessionCookies(reply, session);
    return safeUser(session.sid, user.username, user.email);
  });

  app.post("/session/refresh", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const refreshToken = req.cookies[config.refreshCookieName];
    if (!refreshToken) {
      return reply.unauthorized("Missing refresh token");
    }

    let payload: { wallet: string; sid: string; iat?: number; exp?: number };
    try {
      payload = jwt.verify(refreshToken, config.jwtRefreshSecret) as { wallet: string; sid: string; iat?: number; exp?: number };
    } catch {
      clearSessionCookies(reply);
      return reply.unauthorized("Invalid refresh token");
    }

    const tokens = await rotateRefresh(app, payload.wallet, payload.sid, refreshToken);
    if (!tokens) {
      clearSessionCookies(reply);
      return reply.unauthorized("Invalid refresh token");
    }

    setSessionCookies(reply, tokens);
    return { ok: true };
  });

  app.get("/me", async (req, reply) => {
    const accessToken = req.cookies[config.accessCookieName];
    if (!accessToken) {
      return reply.unauthorized("Missing access token");
    }

    let payload: { wallet: string; sid: string; iat?: number; exp?: number };
    try {
      payload = app.jwt.verify(accessToken) as { wallet: string; sid: string; iat?: number; exp?: number };
    } catch {
      return reply.unauthorized("Invalid access token");
    }

    if (payload.wallet.startsWith("local:")) {
      const userId = payload.wallet.replace("local:", "");
      const result = await app.pg.query(
        `SELECT username, email FROM local_users WHERE id = $1 LIMIT 1`,
        [userId]
      );

      if (result.rowCount !== 1) {
        clearSessionCookies(reply);
        return reply.unauthorized("Session user not found");
      }

      return {
        sessionId: payload.sid,
        user: {
          username: result.rows[0].username,
          email: result.rows[0].email,
          provider: "local"
        }
      };
    }

    return {
      sessionId: payload.sid,
      user: {
        wallet: payload.wallet,
        provider: "wallet"
      }
    };
  });

  app.post("/logout", async (req, reply) => {
    const accessToken = req.cookies[config.accessCookieName];
    if (accessToken) {
      try {
        const payload = app.jwt.verify(accessToken) as { wallet: string; sid: string };
        await revokeSession(app, payload.sid);
      } catch {
        // ignore invalid token and still clear cookies
      }
    }

    clearSessionCookies(reply);
    return { ok: true };
  });
};

export default authRoutes;
