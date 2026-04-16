
import { z } from "zod";

const createGameSchema = z.object({
  id: z.string().uuid(),
  creatorWallet: z.string().min(32).max(64),
  stakeSol: z.number().positive(),
  expiresAt: z.string().datetime()
});

const joinIntentSchema = z.object({
  wallet: z.string().min(32).max(64),
  intentNonce: z.string().min(8)
});

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0)
});

const gamesRoutes = async (app: any) => {
  app.post("/", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const parsed = createGameSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.badRequest(parsed.error.message);
    }

    const g = parsed.data;
    await app.pg.query(
      `
      INSERT INTO game_listings (id, creator_wallet, stake_sol, state, created_at, expires_at)
      VALUES ($1, $2, $3, 'waiting', NOW(), $4)
      ON CONFLICT (id) DO NOTHING
      `,
      [g.id, g.creatorWallet, g.stakeSol, g.expiresAt]
    );

    (app as any).websocketServer?.clients.forEach((client: any) => {
      client.send(JSON.stringify({ type: "lobby.updated" }));
    });

    return { ok: true, id: g.id };
  });

  app.post("/:id/join-intent", { config: { rateLimit: { max: 40, timeWindow: "1 minute" } } }, async (req, reply) => {
    const paramsParsed = z.object({ id: z.string().uuid() }).safeParse(req.params);
    const bodyParsed = joinIntentSchema.safeParse(req.body);
    if (!paramsParsed.success || !bodyParsed.success) {
      return reply.badRequest("Invalid payload");
    }

    const { id } = paramsParsed.data;
    const { wallet, intentNonce } = bodyParsed.data;

    const result = await app.pg.query(
      `
      INSERT INTO join_intents (game_id, wallet, intent_nonce, created_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (game_id, wallet) DO UPDATE SET intent_nonce = EXCLUDED.intent_nonce
      RETURNING game_id, wallet
      `,
      [id, wallet, intentNonce]
    );

    (app as any).websocketServer?.clients.forEach((client: any) => {
      client.send(JSON.stringify({ type: "game.intent", gameId: id }));
    });

    return { ok: true, item: result.rows[0] };
  });

  app.get("/open", async (req, reply) => {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.badRequest(parsed.error.message);
    }

    const { limit, offset } = parsed.data;
    const result = await app.pg.query(
      `
      SELECT id, stake_sol, state, created_at, expires_at
      FROM game_listings
      WHERE state IN ('waiting', 'joined', 'reveal')
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2
      `,
      [limit, offset]
    );

    return {
      items: result.rows.map((row: any) => ({
        id: row.id,
        stakeSol: Number(row.stake_sol),
        state: row.state,
        createdAt: row.created_at,
        expiresAt: row.expires_at
      })),
      limit,
      offset
    };
  });

  app.get("/:id", async (req, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!params.success) {
      return reply.badRequest(params.error.message);
    }

    const result = await app.pg.query(
      `
      SELECT id, stake_sol, state, created_at, expires_at, reveal_deadline, winner_wallet, tx_status
      FROM game_listings
      WHERE id = $1
      LIMIT 1
      `,
      [params.data.id]
    );

    if (result.rowCount !== 1) {
      return reply.notFound("Game not found");
    }

    const row = result.rows[0];
    return {
      id: row.id,
      stakeSol: Number(row.stake_sol),
      state: row.state,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      txStatus: row.tx_status,
      revealDeadline: row.reveal_deadline,
      winnerWallet: row.winner_wallet
    };
  });
};

export default gamesRoutes;
