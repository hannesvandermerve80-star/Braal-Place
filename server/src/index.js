import { createApp } from "./app.js";
import { config } from "./config.js";
import { seedIfEmpty } from "./db/seed.js";
import { startOutboxWorker } from "./services/outbox.js";
import { emailProvider, startEmailWorker } from "./services/mailer.js";
import { expireStaleOrders } from "./services/orders.js";

seedIfEmpty();
const app = createApp();
startOutboxWorker();
startEmailWorker();
console.log(`[email] provider: ${emailProvider()}`);
if (!config.resend && !config.smtp) console.warn("[email] No RESEND_API_KEY or SMTP_HOST set — emails are logged, not delivered. Set one before going live.");
setInterval(() => { try { expireStaleOrders(30); } catch (e) { console.error("[expire]", e); } }, 60_000).unref();

const server = app.listen(config.port, "0.0.0.0", () => {
  console.log(`Bekies Braai Place API listening on 0.0.0.0:${config.port}  (${config.isProd ? "production" : "development"})`);
  if (config.demoMode) console.log("Demo mode ON — demo logins are listed on the sign-in page.");
});
const shutdown = () => server.close(() => process.exit(0));
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
