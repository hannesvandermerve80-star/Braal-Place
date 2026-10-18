import fs from "node:fs";
import { config } from "../config.js";
import { db } from "./index.js";
import { seedBase, seedDemo } from "./seed.js";

// `npm run seed` wipes the database and loads the demo dataset.
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((t) => t.name);
db.exec("PRAGMA foreign_keys = OFF");
db.exec("DROP TRIGGER IF EXISTS audit_no_update; DROP TRIGGER IF EXISTS audit_no_delete;");
for (const t of tables) db.exec(`DELETE FROM ${t}`);
db.exec("DELETE FROM sqlite_sequence");
db.exec("PRAGMA foreign_keys = ON");
db.exec(`CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_logs BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_logs BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;`);
fs.rmSync(config.uploadDir, { recursive: true, force: true });
seedBase();
seedDemo();
console.log("Database reset and demo data loaded.");
