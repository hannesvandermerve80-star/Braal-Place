import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(SERVER_ROOT, ".env") });

const env = process.env;
const isProd = env.NODE_ENV === "production";

if (isProd && (!env.JWT_SECRET || env.JWT_SECRET.startsWith("change-me"))) {
  throw new Error("JWT_SECRET must be set to a strong random value in production");
}

export const config = {
  isProd,
  isTest: env.NODE_ENV === "test",
  port: Number(env.PORT || 4000),
  jwtSecret: env.JWT_SECRET || "dev-only-secret-do-not-use-in-production",
  jwtExpiresIn: "7d",
  webhookSecret: env.PAYMENT_WEBHOOK_SECRET || "dev-webhook-secret",
  clientOrigins: (env.CLIENT_ORIGIN || "http://localhost:5173").split(",").map((s) => s.trim()),
  databaseFile: env.DATABASE_FILE === ":memory:" ? ":memory:" : path.resolve(SERVER_ROOT, env.DATABASE_FILE || "data/bekies.db"),
  uploadDir: path.resolve(SERVER_ROOT, env.UPLOAD_DIR || "uploads"),
  demoMode: (env.DEMO_MODE ?? "true") === "true",
  clientDist: path.resolve(SERVER_ROOT, "../client/dist"),
  commerce: {
    freeDeliveryThresholdCents: 75000,
    deliveryFeeCents: 8500,
    commissionRate: 0.1, // blended 10% marketplace commission
    vatRate: 0.15, // prices are VAT inclusive
    maxQtyPerLine: 20,
  },
  brand: {
    name: "Bekies Braai Place",
    supportEmail: "support@bekiesbraaiplace.co.za",
    supportPhone: "+27 21 000 0000",
    serviceArea: "Johannesburg & Pretoria, South Africa",
  },
};
