import RedisLib from "ioredis";
import { Pool } from "pg";
import fp from "fastify-plugin";
import { config } from "../config.js";

type QueryResult<T = any> = {
  rows: T[];
  rowCount: number;
};

type PgLike = {
  query: (sql: string, params?: any[]) => Promise<QueryResult>;
  end: () => Promise<void>;
};

type KeyValueStore = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, mode?: "EX", ttlSeconds?: number) => Promise<void>;
  del: (key: string) => Promise<void>;
  close: () => Promise<void>;
};

class InMemoryStore implements KeyValueStore {
  private readonly map = new Map<string, { value: string; expiresAt?: number }>();

  async get(key: string) {
    const item = this.map.get(key);
    if (!item) {
      return null;
    }

    if (item.expiresAt && Date.now() >= item.expiresAt) {
      this.map.delete(key);
      return null;
    }

    return item.value;
  }

  async set(key: string, value: string, mode?: "EX", ttlSeconds?: number) {
    const expiresAt = mode === "EX" && ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined;
    this.map.set(key, { value, expiresAt });
  }

  async del(key: string) {
    this.map.delete(key);
  }

  async close() {
    this.map.clear();
  }
}

class InMemoryPg implements PgLike {
  private readonly localUsers = new Map<string, { id: string; username: string; email: string; password_hash: string; created_at: string }>();
  private readonly walletSessions = new Map<string, {
    id: string;
    wallet: string;
    refresh_token_hash: string;
    user_agent: string | null;
    ip_address: string | null;
    created_at: string;
    last_used_at: string;
    revoked_at: string | null;
  }>();
  private readonly gameListings = new Map<string, {
    id: string;
    creator_wallet: string;
    stake_sol: number;
    state: string;
    tx_status: string;
    winner_wallet: string | null;
    reveal_deadline: string | null;
    created_at: string;
    expires_at: string;
  }>();
  private readonly joinIntents = new Map<string, { game_id: string; wallet: string; intent_nonce: string; created_at: string }>();

  private normalize(sql: string) {
    return sql.replace(/\s+/g, " ").trim().toLowerCase();
  }

  private nowIso() {
    return new Date().toISOString();
  }

  async query(sql: string, params: any[] = []): Promise<QueryResult> {
    const q = this.normalize(sql);

    if (q.startsWith("create table if not exists")) {
      return { rows: [], rowCount: 0 };
    }

    if (q.startsWith("select id from local_users where username = $1 or email = $2")) {
      const [username, email] = params;
      const found = Array.from(this.localUsers.values()).find((u) => u.username === username || u.email === email);
      return { rows: found ? [{ id: found.id }] : [], rowCount: found ? 1 : 0 };
    }

    if (q.startsWith("insert into local_users")) {
      const [id, username, email, passwordHash] = params;
      const created_at = this.nowIso();
      this.localUsers.set(id, { id, username, email, password_hash: passwordHash, created_at });
      return { rows: [], rowCount: 1 };
    }

    if (q.startsWith("select id, username, email, password_hash from local_users")) {
      const [identifier] = params;
      const ident = String(identifier).toLowerCase();
      const found = Array.from(this.localUsers.values()).find(
        (u) => u.username.toLowerCase() === ident || u.email.toLowerCase() === ident
      );
      return { rows: found ? [found] : [], rowCount: found ? 1 : 0 };
    }

    if (q.startsWith("select username, email from local_users where id = $1")) {
      const [id] = params;
      const found = this.localUsers.get(id);
      return {
        rows: found ? [{ username: found.username, email: found.email }] : [],
        rowCount: found ? 1 : 0
      };
    }

    if (q.startsWith("insert into wallet_sessions")) {
      const [id, wallet, refreshTokenHash, userAgent, ip] = params;
      const now = this.nowIso();
      this.walletSessions.set(id, {
        id,
        wallet,
        refresh_token_hash: refreshTokenHash,
        user_agent: userAgent,
        ip_address: ip,
        created_at: now,
        last_used_at: now,
        revoked_at: null
      });
      return { rows: [], rowCount: 1 };
    }

    if (q.startsWith("select id from wallet_sessions where id = $1 and wallet = $2 and refresh_token_hash = $3 and revoked_at is null")) {
      const [id, wallet, refreshHash] = params;
      const found = this.walletSessions.get(id);
      const ok = Boolean(found && found.wallet === wallet && found.refresh_token_hash === refreshHash && !found.revoked_at);
      return { rows: ok ? [{ id }] : [], rowCount: ok ? 1 : 0 };
    }

    if (q.startsWith("update wallet_sessions set refresh_token_hash = $1, last_used_at = now() where id = $2")) {
      const [nextHash, id] = params;
      const found = this.walletSessions.get(id);
      if (!found) {
        return { rows: [], rowCount: 0 };
      }
      found.refresh_token_hash = nextHash;
      found.last_used_at = this.nowIso();
      return { rows: [], rowCount: 1 };
    }

    if (q.startsWith("update wallet_sessions set revoked_at = now() where id = $1")) {
      const [id] = params;
      const found = this.walletSessions.get(id);
      if (!found) {
        return { rows: [], rowCount: 0 };
      }
      found.revoked_at = this.nowIso();
      return { rows: [], rowCount: 1 };
    }

    if (q.startsWith("select id, wallet, user_agent, ip_address, created_at, last_used_at, revoked_at from wallet_sessions where wallet = $1")) {
      const [wallet, limit, offset] = params;
      const items = Array.from(this.walletSessions.values())
        .filter((s) => s.wallet === wallet)
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
        .slice(offset, offset + limit);
      return { rows: items, rowCount: items.length };
    }

    if (q.startsWith("insert into game_listings")) {
      const [id, creatorWallet, stakeSol, expiresAt] = params;
      if (this.gameListings.has(id)) {
        return { rows: [], rowCount: 0 };
      }
      this.gameListings.set(id, {
        id,
        creator_wallet: creatorWallet,
        stake_sol: Number(stakeSol),
        state: "waiting",
        tx_status: "idle",
        winner_wallet: null,
        reveal_deadline: null,
        created_at: this.nowIso(),
        expires_at: expiresAt
      });
      return { rows: [], rowCount: 1 };
    }

    if (q.startsWith("insert into join_intents")) {
      const [gameId, wallet, intentNonce] = params;
      const created_at = this.nowIso();
      const key = `${gameId}:${wallet.toLowerCase()}`;
      this.joinIntents.set(key, { game_id: gameId, wallet, intent_nonce: intentNonce, created_at });
      return { rows: [{ game_id: gameId, wallet }], rowCount: 1 };
    }

    if (q.startsWith("select id, stake_sol, state, created_at, expires_at from game_listings")) {
      const [limit, offset] = params;
      const items = Array.from(this.gameListings.values())
        .filter((g) => g.state === "waiting" || g.state === "joined" || g.state === "reveal")
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
        .slice(offset, offset + limit);
      return { rows: items, rowCount: items.length };
    }

    if (q.startsWith("select id, stake_sol, state, created_at, expires_at, reveal_deadline, winner_wallet, tx_status from game_listings where id = $1")) {
      const [id] = params;
      const item = this.gameListings.get(id);
      return { rows: item ? [item] : [], rowCount: item ? 1 : 0 };
    }

    throw new Error(`InMemoryPg does not support query: ${sql}`);
  }

  async end() {
    this.localUsers.clear();
    this.walletSessions.clear();
    this.gameListings.clear();
    this.joinIntents.clear();
  }
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function createPg(app: any): Promise<PgLike> {
  let lastError: unknown;
  const retries = Math.max(1, config.pgConnectRetries);

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const pool = new Pool({ connectionString: config.databaseUrl });
    try {
      await pool.query("SELECT 1");
      if (attempt > 1) {
        app.log.info({ attempt }, "PostgreSQL connection recovered");
      }
      return pool;
    } catch (error) {
      lastError = error;
      await pool.end().catch(() => {});
      app.log.warn(
        { err: error, attempt, retries },
        "PostgreSQL connection check failed"
      );
      if (attempt < retries) {
        await sleep(config.pgConnectRetryDelayMs);
      }
    }
  }

  if (config.nodeEnv === "production" && !config.allowInMemoryDbInProduction) {
    app.log.error(
      {
        retries,
        retryDelayMs: config.pgConnectRetryDelayMs
      },
      "Failed to connect to PostgreSQL in production. Set DATABASE_URL correctly or enable ALLOW_INMEMORY_DB_IN_PROD=true only for temporary emergency fallback."
    );
    throw lastError instanceof Error ? lastError : new Error("Failed to connect to PostgreSQL");
  }

  if (config.nodeEnv === "production" && config.allowInMemoryDbInProduction) {
    app.log.warn("Using in-memory database in production fallback mode");
    return new InMemoryPg();
  }

  app.log.warn({ err: lastError }, "PostgreSQL unavailable, using in-memory database for local development");
  return new InMemoryPg();
}

export default fp(async (app: any) => {
  const pg = await createPg(app);
  await pg.query(`
    CREATE TABLE IF NOT EXISTS local_users (
      id UUID PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pg.query(`
    CREATE TABLE IF NOT EXISTS wallet_sessions (
      id UUID PRIMARY KEY,
      wallet TEXT NOT NULL,
      refresh_token_hash TEXT NOT NULL,
      user_agent TEXT,
      ip_address TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      revoked_at TIMESTAMPTZ
    );
  `);
  await pg.query(`
    CREATE TABLE IF NOT EXISTS game_listings (
      id UUID PRIMARY KEY,
      creator_wallet TEXT NOT NULL,
      stake_sol NUMERIC(20,9) NOT NULL,
      state TEXT NOT NULL,
      tx_status TEXT NOT NULL DEFAULT 'idle',
      winner_wallet TEXT,
      reveal_deadline TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    );
  `);
  await pg.query(`
    CREATE TABLE IF NOT EXISTS join_intents (
      game_id UUID NOT NULL REFERENCES game_listings(id) ON DELETE CASCADE,
      wallet TEXT NOT NULL,
      intent_nonce TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (game_id, wallet)
    );
  `);
  let kv: KeyValueStore = new InMemoryStore();

  if (config.useRedis && config.redisUrl) {
    try {
      const RedisCtor = (RedisLib as any).default ?? RedisLib;
      const redis = new RedisCtor(config.redisUrl, { lazyConnect: false, maxRetriesPerRequest: 1 });
      kv = {
        get: async (key) => redis.get(key),
        set: async (key, value, mode, ttlSeconds) => {
          if (mode === "EX" && ttlSeconds) {
            await redis.set(key, value, "EX", ttlSeconds);
            return;
          }
          await redis.set(key, value);
        },
        del: async (key) => {
          await redis.del(key);
        },
        close: async () => {
          await redis.quit();
        }
      };
      app.log.info("Using Redis key-value store");
    } catch (error) {
      app.log.warn({ err: error }, "Redis unavailable, falling back to in-memory key-value store");
    }
  } else {
    app.log.info("Using in-memory key-value store");
  }

  app.decorate("pg", pg);
  app.decorate("kv", kv);

  app.addHook("onClose", async () => {
    await Promise.all([pg.end(), kv.close()]);
  });
});
