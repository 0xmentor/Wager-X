
import { z } from "zod";

const listSessionsQuery = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20), offset: z.coerce.number().int().min(0).default(0), wallet: z.string().min(32).max(64) });

const sessionRoutes = async (app: any) => {
  app.get("/sessions", async (req, reply) => {
    const parsed = listSessionsQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.badRequest(parsed.error.message);
    }

    const { wallet, limit, offset } = parsed.data;
    const result = await app.pg.query(
      `
      SELECT id, wallet, user_agent, ip_address, created_at, last_used_at, revoked_at
      FROM wallet_sessions
      WHERE wallet = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
      `,
      [wallet, limit, offset]
    );

    return {
      items: result.rows,
      limit,
      offset
    };
  });

  app.delete("/sessions/:id", async (req, reply) => {
    const schema = z.object({ id: z.string().uuid() });
    const parsed = schema.safeParse(req.params);
    if (!parsed.success) {
      return reply.badRequest(parsed.error.message);
    }

    await app.pg.query(`UPDATE wallet_sessions SET revoked_at = NOW() WHERE id = $1`, [parsed.data.id]);
    return { ok: true };
  });
};

export default sessionRoutes;
