import { createApp } from "./app.js";
import { config } from "./config.js";
import { seedIfEmpty } from "./db/seed.js";
import { startOutboxWorker } from "./services/outbox.js";
import { expireStaleOrders } from "./services/orders.js";

seedIfEmpty();
const app = createApp();
startOutboxWorker();
setInterval(() => { try { expireStaleOrders(30); } catch (e) { console.error("[expire]", e); } }, 60_000).unref();

const server = app.listen(config.port, () => {
  console.log(`Bekies Braai Place API listening on http://localhost:${config.port}  (${config.isProd ? "production" : "development"})`);
  if (config.demoMode) console.log("Demo mode ON — demo logins are listed on the sign-in page.");
});
const shutdown = () => server.close(() => process.exit(0));
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
