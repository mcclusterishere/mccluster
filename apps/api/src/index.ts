import { buildServer } from "./server.js";
import { loadConfig } from "./config.js";

const cfg = loadConfig();
const app = buildServer(cfg);

app.listen({ port: cfg.PORT, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    app.close().then(() => process.exit(0));
  });
}
