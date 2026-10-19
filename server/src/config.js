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
  get paymentProvider() { return this.payfast ? "payfast" : (this.demoMode || !this.isProd) ? "demo" : "none"; },
  demoMode: (env.DEMO_MODE ?? "true") === "true",
  publicUrl: (env.PUBLIC_URL || (env.CLIENT_ORIGIN || "http://localhost:5173").split(",")[0]).trim().replace(/\/$/, ""),
  smtp: env.SMTP_HOST ? {
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT || 587),
    secure: (env.SMTP_SECURE ?? "false") === "true",
    user: env.SMTP_USER || undefined,
    pass: env.SMTP_PASS || undefined,
    from: env.MAIL_FROM || env.SMTP_USER || "Bekies Braai Place <no-reply@bekiesbraaiplace.co.za>",
  } : null,
  payfast: env.PAYFAST_MERCHANT_ID ? {
    merchantId: env.PAYFAST_MERCHANT_ID,
    merchantKey: env.PAYFAST_MERCHANT_KEY,
    passphrase: env.PAYFAST_PASSPHRASE || "",
    sandbox: (env.PAYFAST_SANDBOX ?? "true") === "true",
  } : null,
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
