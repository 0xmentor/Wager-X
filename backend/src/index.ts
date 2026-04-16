import { buildApp } from "./app.js";
import { config } from "./config.js";

const app = buildApp();

app.listen({ host: config.host, port: config.port }).catch((error: unknown) => {
  app.log.error(error);
  process.exit(1);
});
