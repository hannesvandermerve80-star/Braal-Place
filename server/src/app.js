import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { config } from "./config.js";
import { attachUser } from "./middleware/auth.js";
import { errorHandler, notFoundHandler } from "./middleware/error.js";
import { db } from "./db/index.js";
import authRoutes from "./routes/auth.js";
import catalogRoutes, { storesRouter } from "./routes/catalog.js";
import cartRoutes from "./routes/cart.js";
import checkoutRoutes from "./routes/checkout.js";
import orderRoutes from "./routes/orders.js";
import paymentRoutes from "./routes/payments.js";
import applicationRoutes from "./routes/sellerApplications.js";
import sellerRoutes from "./routes/seller.js";
import productRoutes from "./routes/products.js";
import adminRoutes from "./routes/admin.js";
import meRoutes from "./routes/me.js";
import supportRoutes from "./routes/support.js";
import portalRoutes from "./routes/portal.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use((req, res, next) => { req.id = crypto.randomUUID().slice(0, 8); res.setHeader("X-Request-Id", req.id); next(); });
  if (!config.isTest) app.use(morgan(config.isProd ? "combined" : "dev"));

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "img-src": ["'self'", "data:", "https://images.unsplash.com"],
        "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        "font-src": ["'self'", "https://fonts.gstatic.com"],
        "script-src": ["'self'"],
        "upgrade-insecure-requests": config.isProd ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
  }));
  app.use(cors({ origin: config.clientOrigins, credentials: true }));
  // keep the raw body for webhook HMAC verification
  app.use(express.json({ limit: "100kb", verify: (req, _res, buf) => { req.rawBody = buf.toString("utf8"); } }));
  app.use(cookieParser());
  app.use(attachUser);

  app.use("/api", rateLimit({ windowMs: 60 * 1000, limit: config.isTest ? 100000 : 300, standardHeaders: true, legacyHeaders: false, message: { error: { status: 429, message: "Too many requests. Please slow down." } } }));

  app.get("/api/health", (_req, res) => {
    db.prepare("SELECT 1").get();
    res.json({ status: "ok", uptime: Math.round(process.uptime()), time: new Date().toISOString() });
  });

  app.use("/api/auth", authRoutes);
  app.use("/api/catalog", catalogRoutes);
  app.use("/api/stores", storesRouter);
  app.use("/api/cart", cartRoutes);
  app.use("/api/checkout", checkoutRoutes);
  app.use("/api/orders", orderRoutes);
  app.use("/api/payments", paymentRoutes);
  app.use("/api/seller-applications", applicationRoutes);
  app.use("/api/seller", sellerRoutes);
  app.use("/api/products", productRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/me", meRoutes);
  app.use("/api/portal", portalRoutes);
  app.use("/api", supportRoutes);
  app.use("/api", notFoundHandler);

  // Serve the built React app (production) with SPA fallback
  if (fs.existsSync(path.join(config.clientDist, "index.html"))) {
    app.use(express.static(config.clientDist, { maxAge: config.isProd ? "1h" : 0, index: false }));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(config.clientDist, "index.html")));
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
