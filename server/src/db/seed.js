import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { all, one, run, tx } from "./index.js";
import { config } from "../config.js";
import { slugify } from "../lib/slug.js";
import { toCents } from "../lib/money.js";
import { DEFAULT_MANAGER_PERMISSIONS } from "../lib/permissions.js";
import { createOrder, transitionOrder } from "../services/orders.js";
import { handleProviderEvent, decideRefund, requestRefund } from "../services/payments.js";
import { runPayouts } from "../services/ledger.js";
import { processOutbox } from "../services/outbox.js";

const U = (id, w = 900) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&q=85`;
const IMG = {
  box: "1609534751961-f396ded2af99", steak: "1613244666139-b6629daf6b96", lamb: "1781941622559-17761ca02dd1",
  groceries: "1763062690254-be377d55dacf", chicken: "1621790404813-df280c2de418", sauce: "1613244529616-07c8d13826fa",
  veg: "1700135844688-597bb7bc6d53", wors: "1752154424142-86c9c633cec1",
};

export function seedBase() {
  const cats = ["Braai meat", "Chicken", "Groceries", "Produce", "Sauces"];
  cats.forEach((name, i) => run("INSERT OR IGNORE INTO categories (slug, name, sort_order) VALUES (?,?,?)", slugify(name), name, i));
  run("INSERT OR IGNORE INTO promo_codes (code, kind, value, min_subtotal_cents, description) VALUES ('BRAAI10','percent',10,30000,'10% off orders over R300')");
  run("INSERT OR IGNORE INTO promo_codes (code, kind, value, min_subtotal_cents, description) VALUES ('WELCOME50','fixed',5000,40000,'R50 off orders over R400')");
  run("INSERT OR IGNORE INTO promo_codes (code, kind, value, min_subtotal_cents, description) VALUES ('FREESHIP','free_delivery',0,0,'Free chilled delivery')");
  // Optional first admin for real deployments
  const { ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
  if (ADMIN_EMAIL && ADMIN_PASSWORD && !one("SELECT 1 FROM users WHERE email=?", ADMIN_EMAIL)) {
    run("INSERT INTO users (email, password_hash, first_name, last_name, mobile, role, email_verified) VALUES (?,?,?,?,?,?,1)", ADMIN_EMAIL, bcrypt.hashSync(ADMIN_PASSWORD, 10), "Platform", "Admin", "+27110000000", "admin");
  }
}

// small deterministic PRNG so demo data is repeatable
function rng(seed = 7) { return () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296); }

export function seedDemo() {
  const rand = rng(11);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const hash = (p) => bcrypt.hashSync(p, 8);
  const mkUser = (email, first, last, role, pw, extra = {}) =>
    Number(run("INSERT INTO users (email, password_hash, first_name, last_name, mobile, role, permissions, email_verified, popia_consent_at, rewards_points) VALUES (?,?,?,?,?,?,?,1,datetime('now'),?)",
      email, hash(pw), first, last, extra.mobile ?? "+27820000000", role, JSON.stringify(extra.permissions ?? []), extra.points ?? 0).lastInsertRowid);

  tx(() => {
    const admin = mkUser("admin@bekies.test", "Naledi", "Mokoena", "admin", "Admin123!");
    const manager = mkUser("manager@bekies.test", "Thabo", "Ndlovu", "manager", "Manager123!", { permissions: DEFAULT_MANAGER_PERMISSIONS });
    const sellerUser = mkUser("seller@bekies.test", "Themba", "Mazibuko", "seller", "Seller123!");
    const lerato = mkUser("lerato@bekies.test", "Lerato", "Khumalo", "buyer", "Buyer123!", { points: 1240, mobile: "+27821234567" });
    const buyers = [lerato,
      mkUser("sipho@bekies.test", "Sipho", "Dlamini", "buyer", "Buyer123!"),
      mkUser("amara@bekies.test", "Amara", "Jacobs", "buyer", "Buyer123!"),
      mkUser("johan@bekies.test", "Johan", "Botha", "buyer", "Buyer123!"),
      mkUser("zodwa@bekies.test", "Zodwa", "Nkosi", "buyer", "Buyer123!"),
    ];

    // ---- stores
    const storeDefs = [
      ["Mzanzi Prime Meats", "Johannesburg", 4.9, "Premium butcher cuts and braai boxes from the heart of Joburg.", sellerUser],
      ["Karoo Choice", "Pretoria", 4.8, "Karoo lamb and matured beef, cut to order.", null],
      ["Farm Table Foods", "Johannesburg", 4.7, "Free-range poultry from family farms.", null],
      ["Fresh Basket Co.", "Pretoria", 4.9, "Seasonal produce picked for the braai side.", null],
      ["Mama Nandi Foods", "Johannesburg", 4.6, "Small-batch braai sauces and marinades.", null],
      ["Braai Brothers", "Johannesburg", 4.9, "Traditional boerewors, droëwors and braai favourites.", null],
      ["Bekies Pantry", "Johannesburg", 4.7, "Pantry staples and braai-side essentials.", null],
    ];
    const store = {};
    for (const [name, city, rating, desc, owner] of storeDefs) {
      const slug = slugify(name);
      const id = Number(run("INSERT INTO stores (slug, name, description, city, support_email, status, verified, rating) VALUES (?,?,?,?,?, 'active', 1, ?)", slug, name, desc, city, `hello@${slug}.co.za`, rating).lastInsertRowid);
      const ownerId = owner ?? mkUser(`owner-${slug}@bekies.test`, name.split(" ")[0], "Owner", "seller", `Owner-${slug}1`);
      run("INSERT INTO store_members (store_id, user_id, role) VALUES (?,?, 'owner')", id, ownerId);
      store[name] = id;
    }
    const cat = Object.fromEntries(all("SELECT id, name FROM categories").map((c) => [c.name, c.id]));

    // ---- products: [store, category, name, price, oldPrice, rating, reviews, stock, imgKey, unit, featured, description]
    const P = [
      ["Mzanzi Prime Meats", "Braai meat", "Family Braai Box", 649, 729, 4.9, 128, 32, "box", "box", 1, "A generous selection of steak, boerewors, chops and chicken for six to eight people."],
      ["Karoo Choice", "Braai meat", "Butcher's Steak Selection", 289, 325, 4.8, 86, 18, "steak", "pack", 1, "Hand-cut premium steaks, matured for tenderness and packed fresh for chilled delivery."],
      ["Farm Table Foods", "Chicken", "Free-range Chicken Pack", 159, 185, 4.7, 64, 24, "chicken", "pack", 1, "Fresh free-range chicken portions, trimmed and ready for your favourite braai marinade."],
      ["Fresh Basket Co.", "Produce", "Braai-side Vegetable Basket", 179, 210, 4.9, 49, 15, "veg", "basket", 0, "A seasonal basket of crisp vegetables selected to serve alongside braaied meat."],
      ["Mama Nandi Foods", "Sauces", "Smoky Braai Sauce", 69, 79, 4.6, 112, 43, "sauce", "bottle", 0, "A rich tomato braai sauce with gentle smoke, warm spice and a touch of sweetness."],
      ["Braai Brothers", "Braai meat", "Traditional Boerewors 1kg", 139, null, 4.9, 204, 27, "wors", "kg", 1, "Traditional coiled boerewors made with a balanced coriander spice blend."],
      ["Bekies Pantry", "Groceries", "Weekend Braai Essentials", 399, 449, 4.7, 38, 12, "groceries", "crate", 0, "Kitchen staples, braai-side groceries and essentials in one convenient crate."],
      ["Karoo Choice", "Braai meat", "Premium Lamb Chops", 329, 365, 4.8, 73, 9, "lamb", "pack", 1, "Tender lamb loin chops, expertly cut and ready for the coals."],
      ["Mzanzi Prime Meats", "Braai meat", "Ribeye Steak Pack", 289, null, 4.8, 41, 4, "steak", "pack", 0, "Four thick-cut, well-marbled ribeye steaks, dry-aged for 21 days."],
      ["Mzanzi Prime Meats", "Chicken", "Chicken Braai Pack", 159, null, 4.6, 27, 0, "chicken", "pack", 0, "Marinated chicken sosaties and drumsticks, ready for the grid."],
      ["Braai Brothers", "Braai meat", "Pork Spare Ribs Rack", 219, 245, 4.7, 58, 20, "box", "rack", 0, "Slow-friendly pork ribs with a sticky, smoky finish when braaied low and slow."],
      ["Braai Brothers", "Braai meat", "Droëwors 500g", 169, null, 4.9, 96, 35, "wors", "pack", 0, "Air-dried droëwors with coriander and a hint of vinegar."],
      ["Karoo Choice", "Braai meat", "Rump Steak 1kg", 349, 389, 4.8, 52, 14, "steak", "kg", 0, "Flavourful rump, cut thick and trimmed by hand."],
      ["Mama Nandi Foods", "Sauces", "Peri-Peri Basting Sauce", 59, null, 4.7, 71, 60, "sauce", "bottle", 0, "A fiery basting sauce for chicken, ribs and prawns."],
      ["Mama Nandi Foods", "Sauces", "Garlic & Herb Marinade", 49, 55, 4.5, 33, 40, "sauce", "bottle", 0, "Overnight marinade for lamb and chicken."],
      ["Fresh Basket Co.", "Produce", "Braai Salad Bundle", 99, null, 4.8, 44, 22, "veg", "bundle", 0, "Everything for a crisp braai salad, washed and ready to toss."],
      ["Bekies Pantry", "Groceries", "Pap & Chakalaka Combo", 89, 99, 4.8, 62, 30, "groceries", "combo", 0, "Maize meal and spicy chakalaka — the classic braai companion."],
      ["Farm Table Foods", "Chicken", "Chicken Wings 2kg", 199, 225, 4.6, 39, 16, "chicken", "kg", 0, "Fresh wings, perfect for peri-peri or lemon & herb."],
    ];
    P.forEach(([sname, cname, name, price, old, rating, reviews, stock, img, unit, featured, desc], i) => {
      const sid = store[sname];
      const pid = Number(run(`INSERT INTO products (store_id, category_id, slug, sku, name, description, unit, price_cents, old_price_cents, image, status, featured, rating, review_count)
        VALUES (?,?,?,?,?,?,?,?,?,?, 'published', ?,?,?)`, sid, cat[cname], slugify(name), `${slugify(sname).slice(0, 3).toUpperCase()}-${String(100 + i)}`, name, desc, unit, toCents(price), old ? toCents(old) : null, U(IMG[img]), featured, rating, reviews).lastInsertRowid);
      run("INSERT INTO inventory (product_id, stock, low_stock_threshold) VALUES (?,?,?)", pid, 400, 10); // stock normalised after demo orders
    });
    // moderation queue + draft for the demo seller
    const sellerStore = store["Mzanzi Prime Meats"];
    const q = (name, price, status, note = null) => {
      const pid = Number(run(`INSERT INTO products (store_id, category_id, slug, sku, name, description, unit, price_cents, image, status, moderation_note) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        sellerStore, cat["Braai meat"], slugify(name), `MZA-${slugify(name).slice(0, 6).toUpperCase()}`, name, "Premium burger patties, hand-pressed and chilled.", "pack", toCents(price), U(IMG.steak), status, note).lastInsertRowid);
      run("INSERT INTO inventory (product_id, stock, low_stock_threshold) VALUES (?,?,?)", pid, 25, 10);
    };
    q("Wagyu Burger Patties 6pk", 259, "submitted");
    q("Lamb Sosaties 1kg", 189, "changes_requested", "Please add a clearer photo showing the packaging.");
    q("Braai Spice Rub Trio", 129, "draft");

    // ---- seller applications (from the design's moderation queue)
    fs.mkdirSync(config.uploadDir, { recursive: true });
    const pdf = "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n";
    const apps = [
      ["Ubuntu Butchery", "Kagiso", "Molefe", "-2 hours", "Low", 100, "under_review", 0, 0],
      ["Cape Pantry", "Zanele", "Adams", "-5 hours", "Low", 92, "under_review", 0, 0],
      ["Highveld Harvest", "Pieter", "Smit", "-1 day", "Medium", 76, "submitted", 1, 0],
      ["Nandi's Kitchen", "Nandi", "Zulu", "-1 day", "Low", 100, "under_review", 0, 1],
    ];
    apps.forEach(([biz, first, last, ago, risk, pct, status, needsDocs, esc], i) => {
      const uid = mkUser(`${first.toLowerCase()}@applicant.test`, first, last, "seller", "Applicant123!");
      const data = { businessName: biz, registrationNumber: `2021/00${i + 1}23/07`, businessAddress: "14 Market Street, Johannesburg", storeName: biz, primaryCategory: "Butchery", fulfilmentCity: "Johannesburg", supportEmail: `hello@${slugify(biz)}.co.za`, storeDescription: "" };
      if (pct < 100) delete data.taxNumber;
      const aid = Number(run("INSERT INTO seller_applications (user_id, business_name, status, data, step, risk, escalated, needs_documents, submitted_at) VALUES (?,?,?,?,5,?,?,?,datetime('now', ?))", uid, biz, status, JSON.stringify(data), risk, esc, needsDocs, ago).lastInsertRowid);
      const kinds = pct >= 100 ? ["identity", "business", "food_safety"] : ["identity", "business"];
      for (const kind of kinds.slice(0, pct < 90 ? 1 : kinds.length)) {
        const stored = `seed-${aid}-${kind}.pdf`;
        fs.writeFileSync(path.join(config.uploadDir, stored), pdf, { mode: 0o600 });
        run("INSERT INTO application_documents (application_id, kind, original_name, stored_name, mime, size) VALUES (?,?,?,?,?,?)", aid, kind, `${kind}-document.pdf`, stored, "application/pdf", pdf.length);
      }
      run("INSERT INTO application_history (application_id, from_status, to_status, actor_id, note) VALUES (?, 'draft','submitted',?, 'Application submitted')", aid, uid);
    });

    // ---- misc customer data
    run("INSERT INTO addresses (user_id, label, street, suburb, city, postal_code, is_default) VALUES (?,?,?,?,?,?,1)", lerato, "Home", "12 Vilakazi Street", "Orlando West", "Johannesburg", "1804");
    run("INSERT INTO support_tickets (user_id, name, email, subject, message, status, reply) VALUES (?,?,?,?,?, 'replied', ?)", lerato, "Lerato Khumalo", "lerato@bekies.test", "Delivery window question", "Can I change my delivery window to the afternoon?", "Hi Lerato, yes — we've moved your delivery to the 14:00–17:00 window.");
    run("INSERT INTO support_tickets (user_id, name, email, subject, message) VALUES (NULL,?,?,?,?)", "Pieter van Wyk", "pieter@example.co.za", "Bulk order enquiry", "We're hosting a 60-person event in December. Can you supply braai boxes in bulk?");

    return { admin, manager, buyers, store };
  });

  /* ------------------------------------------------------------ orders */
  const adminUser = one("SELECT * FROM users WHERE email='admin@bekies.test'");
  const sys = { user: adminUser, id: "seed" };
  const products = all("SELECT p.id, p.store_id, p.price_cents FROM products p WHERE p.status='published'");
  const buyers = all("SELECT * FROM users WHERE role='buyer'");
  const ts = (daysAgo, h = 10) => new Date(Date.now() - daysAgo * 86400000 + (h - 12) * 3600000).toISOString().replace("T", " ").slice(0, 19);

  const place = (buyer, items, daysAgo, { pay = true, advance = null } = {}) => {
    const addr = { street: `${Math.floor(rand() * 90 + 1)} Vilakazi Street`, suburb: "Orlando West", city: "Johannesburg", postalCode: "1804" };
    const { order } = createOrder({
      user: buyer, contact: { firstName: buyer.first_name, lastName: buyer.last_name, email: buyer.email, mobile: buyer.mobile || "+27820000000" },
      address: addr, items, promoCode: null, now: ts(daysAgo),
    });
    if (pay) {
      const pay = one("SELECT provider_ref, amount_cents FROM payments WHERE order_id=?", order.id);
      handleProviderEvent("demo", { id: `evt_seed_${order.number}`, type: "payment.succeeded", paymentRef: pay.provider_ref, amountCents: pay.amount_cents }, sys);
    }
    for (const step of advance ?? []) {
      const fresh = one("SELECT * FROM orders WHERE id=?", order.id);
      transitionOrder({ req: sys, order: fresh, scope: "staff", to: step });
    }
    run("UPDATE orders SET created_at=?, updated_at=? WHERE id=?", ts(daysAgo), ts(Math.max(0, daysAgo - 1)), order.id);
    return one("SELECT * FROM orders WHERE id=?", order.id);
  };
  const FULL = ["accepted", "packing", "ready", "dispatched", "delivered"];

  // ~12 weeks of history, all delivered
  for (let day = 84; day >= 9; day -= 2) {
    const n = 1 + Math.floor(rand() * 2);
    for (let k = 0; k < n; k++) {
      const lines = Array.from({ length: 1 + Math.floor(rand() * 3) }, () => ({ productId: pick(products).id, qty: 1 + Math.floor(rand() * 2) }));
      const uniq = [...new Map(lines.map((l) => [l.productId, l])).values()];
      place(pick(buyers), uniq, day + rand(), { advance: FULL });
    }
  }
  runPayouts(sys); // older settled funds are paid out; recent activity stays pending/available

  const by = (name) => all("SELECT id FROM products WHERE slug=?", slugify(name))[0].id;
  const lerato = buyers.find((b) => b.email === "lerato@bekies.test");
  const sipho = buyers.find((b) => b.email === "sipho@bekies.test");
  const amara = buyers.find((b) => b.email === "amara@bekies.test");
  const johan = buyers.find((b) => b.email === "johan@bekies.test");

  place(amara, [{ productId: by("Braai-side Vegetable Basket"), qty: 2 }, { productId: by("Braai Salad Bundle"), qty: 1 }], 3, { advance: FULL }); // delivered
  place(sipho, [{ productId: by("Traditional Boerewors 1kg"), qty: 2 }, { productId: by("Droëwors 500g"), qty: 2 }, { productId: by("Pork Spare Ribs Rack"), qty: 1 }], 1, { advance: ["accepted", "packing", "ready"] });
  place(lerato, [{ productId: by("Family Braai Box"), qty: 1 }, { productId: by("Ribeye Steak Pack"), qty: 1 }, { productId: by("Smoky Braai Sauce"), qty: 2 }], 1, { advance: ["accepted", "packing"] }); // multi-seller, packing
  place(lerato, [{ productId: by("Free-range Chicken Pack"), qty: 1 }, { productId: by("Chicken Wings 2kg"), qty: 1 }], 5, { advance: ["accepted", "packing", "ready", "dispatched"] }); // out for delivery
  place(lerato, [{ productId: by("Premium Lamb Chops"), qty: 1 }], 12, { advance: FULL }); // delivered; lets her review
  place(zodwaOr(buyers), [{ productId: by("Rump Steak 1kg"), qty: 1 }], 0.2, { advance: ["accepted"] });
  place(zodwaOr(buyers), [{ productId: by("Weekend Braai Essentials"), qty: 1 }], 0.1, {}); // confirmed, waiting for seller
  const review = place(johan, [{ productId: by("Premium Lamb Chops"), qty: 3 }, { productId: by("Butcher's Steak Selection"), qty: 3 }, { productId: by("Rump Steak 1kg"), qty: 2 }], 0.05, { pay: false });
  run("UPDATE orders SET payment_status='pending' WHERE id=?", review.id);
  run("UPDATE payments SET status='pending' WHERE order_id=?", review.id);

  // a refund request on a delivered order, awaiting approval
  const refundable = one("SELECT * FROM orders WHERE user_id=? AND status='delivered' ORDER BY id DESC LIMIT 1", amara.id);
  if (refundable) requestRefund({ req: { user: amara }, order: refundable, amountCents: 5000, reason: "Two vegetables arrived bruised." });

  // reviews + wishlist for the demo customer
  const rev = (pid, uid, rating, body) => run("INSERT OR IGNORE INTO reviews (product_id, user_id, rating, body) VALUES (?,?,?,?)", pid, uid, rating, body);
  rev(by("Premium Lamb Chops"), lerato.id, 5, "Beautifully cut and arrived perfectly cold.");
  rev(by("Family Braai Box"), sipho.id, 5, "Fed eight people with leftovers. Brilliant value.");
  rev(by("Traditional Boerewors 1kg"), amara.id, 4, "Great flavour, a touch more coriander next time!");
  for (const n of ["Premium Lamb Chops", "Droëwors 500g", "Family Braai Box", "Pap & Chakalaka Combo", "Smoky Braai Sauce"]) run("INSERT OR IGNORE INTO wishlist (user_id, product_id) VALUES (?,?)", lerato.id, by(n));

  // Normalise stock to the demo's intended levels (on-hand excludes anything reserved by open orders)
  const setStock = (name, onHand, threshold = 10) => run("UPDATE inventory SET stock = ? + reserved, low_stock_threshold=? WHERE product_id=?", onHand, threshold, by(name));
  for (const [n, s] of [["Family Braai Box", 32], ["Butcher's Steak Selection", 18], ["Free-range Chicken Pack", 24], ["Braai-side Vegetable Basket", 15], ["Smoky Braai Sauce", 43], ["Traditional Boerewors 1kg", 27], ["Weekend Braai Essentials", 12], ["Premium Lamb Chops", 9], ["Ribeye Steak Pack", 4], ["Chicken Braai Pack", 0], ["Pork Spare Ribs Rack", 20], ["Droëwors 500g", 35], ["Rump Steak 1kg", 14], ["Peri-Peri Basting Sauce", 60], ["Garlic & Herb Marinade", 40], ["Braai Salad Bundle", 22], ["Pap & Chakalaka Combo", 30], ["Chicken Wings 2kg", 16]]) setStock(n, s);
  run("UPDATE inventory SET low_stock_threshold=8 WHERE product_id=?", by("Traditional Boerewors 1kg"));

  // History timestamps follow the order's created_at so trend charts and "30 day" figures are realistic
  run("UPDATE seller_orders SET updated_at = (SELECT created_at FROM orders o WHERE o.id = seller_orders.order_id)");
  run("UPDATE order_events SET created_at = (SELECT created_at FROM orders o WHERE o.id = order_events.order_id)");
  run("UPDATE ledger_entries SET created_at = (SELECT created_at FROM orders o WHERE o.id = ledger_entries.order_id)");
  processOutbox(500);
  run("DELETE FROM emails"); // seeded history must never be emailed (demo addresses)
  // Seeded notifications shouldn't all show as unread
  run("UPDATE notifications SET read=1 WHERE id % 3 != 0");
}
const zodwaOr = (buyers) => buyers.find((b) => b.email === "zodwa@bekies.test") ?? buyers[0];

export function seedIfEmpty() {
  seedBase();
  if (config.demoMode && !one("SELECT 1 FROM users LIMIT 1")) seedDemo();
}
