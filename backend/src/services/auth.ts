import { randomUUID } from "node:crypto";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { PublicKey } from "@solana/web3.js";
import { config } from "../config.js";
import { generateNonce, sha256 } from "./crypto.js";

const NONCE_TTL_SECONDS = 300;

export async function issueNonce(app: any, wallet: string) {
  const nonce = generateNonce();
  const key = `auth:nonce:${wallet.toLowerCase()}`;
  await app.kv.set(key, nonce, "EX", NONCE_TTL_SECONDS);
  return {
    nonce,
    expiresAt: new Date(Date.now() + NONCE_TTL_SECONDS * 1000).toISOString()
  };
}

export async function verifySignature(
  wallet: string,
  signature: string,
  nonce: string
): Promise<boolean> {
  const pk = new PublicKey(wallet);
  const msg = new TextEncoder().encode(`sol-bet-auth:${nonce}`);
  return nacl.sign.detached.verify(msg, bs58.decode(signature), pk.toBytes());
}

export async function createSession(app: any, wallet: string, meta: { userAgent?: string; ip?: string }) {
  const sid = randomUUID();
  const accessToken = await app.signAccessToken({ wallet, sid });
  const refreshToken = await app.signRefreshToken({ wallet, sid });
  const refreshTokenHash = sha256(refreshToken);

  await app.pg.query(
    `
    INSERT INTO wallet_sessions (
      id, wallet, refresh_token_hash, user_agent, ip_address, created_at, last_used_at
    ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
    `,
    [sid, wallet, refreshTokenHash, meta.userAgent ?? null, meta.ip ?? null]
  );

  return {
    sid,
    accessToken,
    refreshToken,
    accessExpiresAt: new Date(Date.now() + config.jwtAccessTtlSeconds * 1000).toISOString(),
    refreshExpiresAt: new Date(Date.now() + config.jwtRefreshTtlSeconds * 1000).toISOString()
  };
}

export async function rotateRefresh(
  app: any,
  wallet: string,
  sid: string,
  refreshToken: string
) {
  const hash = sha256(refreshToken);
  const result = await app.pg.query(
    `
    SELECT id FROM wallet_sessions
    WHERE id = $1 AND wallet = $2 AND refresh_token_hash = $3 AND revoked_at IS NULL
    LIMIT 1
    `,
    [sid, wallet, hash]
  );

  if (result.rowCount !== 1) {
    return null;
  }

  const nextAccess = await app.signAccessToken({ wallet, sid });
  const nextRefresh = await app.signRefreshToken({ wallet, sid });
  const nextHash = sha256(nextRefresh);

  await app.pg.query(
    `
    UPDATE wallet_sessions
    SET refresh_token_hash = $1, last_used_at = NOW()
    WHERE id = $2
    `,
    [nextHash, sid]
  );

  return {
    accessToken: nextAccess,
    refreshToken: nextRefresh,
    accessExpiresAt: new Date(Date.now() + config.jwtAccessTtlSeconds * 1000).toISOString(),
    refreshExpiresAt: new Date(Date.now() + config.jwtRefreshTtlSeconds * 1000).toISOString()
  };
}

export async function revokeSession(app: any, sid: string) {
  await app.pg.query(
    `UPDATE wallet_sessions SET revoked_at = NOW() WHERE id = $1`,
    [sid]
  );
}
