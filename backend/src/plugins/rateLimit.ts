import fp from "fastify-plugin";
import rateLimit from "@fastify/rate-limit";

export default fp(async (app: any) => {
  await app.register(rateLimit, {
    global: true,
    max: 120,
    timeWindow: "1 minute",
    keyGenerator: (req: any) => req.ip
  });
});
