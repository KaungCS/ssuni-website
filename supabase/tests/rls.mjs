// RLS verification against the live database. Run: npm run db:verify
//
// This is the schema's test suite. CLAUDE.md scopes TDD to cart, reservation and
// webhook logic; database policies are verified by asking the real database
// instead, because what matters is what PostgREST actually returns to an
// anonymous caller, which no unit test can tell you.
//
// Hits PostgREST directly with fetch rather than @supabase/supabase-js, so it
// exercises exactly the path a browser client takes, with no imports to resolve.
//
// Issue #24's RLS audit is a hard launch gate -- extend this file as tables are
// added (orders and order_items in #17, hero_stories in #22, the Storage bucket
// in #11) so that audit is a re-run rather than a fresh manual walk.
//
// Writes nothing permanent: the Reservation it creates is deleted and the
// is_hidden flag it toggles is reverted.

import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    })
);

// Publishable key (sb_publishable_...) stands in for the old anon key, secret
// key (sb_secret_...) for service_role. Note both are sent as `apikey` AND as
// `Authorization: Bearer` below with an identical value -- that equality is
// required, the new keys are rejected in a Bearer header that differs from the
// apikey header.
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SERVICE = env.SUPABASE_SECRET_KEY;

if (!URL_ || !ANON) throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY missing from .env.local");
if (!SERVICE) throw new Error("SUPABASE_SECRET_KEY missing from .env.local (Dashboard -> Settings -> API Keys -> Secret keys)");

async function req(key, method, path, { body, prefer } = {}) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-json body */ }
  return { status: res.status, json, text };
}

const anon = (m, p, o) => req(ANON, m, p, o);
const svc = (m, p, o) => req(SERVICE, m, p, o);

let failures = 0;
function check(label, pass, detail) {
  console.log(`${pass ? "  PASS" : "  FAIL"}  ${label}${detail ? `  -- ${detail}` : ""}`);
  if (!pass) failures++;
}
const section = (s) => console.log(`\n${s}`);

// -- 1. anon reads -----------------------------------------------------------
section("1. Anonymous reads");

// Row counts are floors, not equalities. The seeded catalog is placeholder data
// (#5); the client adds real Products in Supabase Studio, and an exact count
// would turn every one of those into a red test suite.
const products = await anon("GET", "products?select=slug,name,price,department,category,collections,is_new&order=slug");
check("anon can select products", products.status === 200 && products.json?.length >= 2,
  `status ${products.status}, ${products.json?.length ?? 0} rows (expected >= 2)`);
if (products.json?.length) console.log("        ", JSON.stringify(products.json));

const variants = await anon("GET", "variants?select=color,size,stock");
check("anon can select variants", variants.status === 200 && variants.json?.length >= 6,
  `status ${variants.status}, ${variants.json?.length ?? 0} rows (expected >= 6)`);

// Baselines, read from the database rather than hardcoded. Every later check
// that needs "how many" compares against these. The floors above are the only
// literals in this file on purpose: a Product the client adds in Supabase Studio
// must never turn this suite red. (It did, on 2026-08-30, when a third Product
// appeared and six exact-count assertions failed at once.)
const productCount = products.json?.length ?? 0;
const variantCount = variants.json?.length ?? 0;

// -- 2. anon writes are refused ---------------------------------------------
section("2. Anonymous writes are refused (ADR 0004)");

const ins = await anon("POST", "products", {
  body: { slug: "rls-probe", name: "RLS probe", price: 1 },
});
check("anon INSERT on products rejected", ins.status === 401 || ins.status === 403,
  `status ${ins.status} ${ins.json?.code ?? ""}`);

const upd = await anon("PATCH", "products?slug=eq.rabbit-hole-hoodie", {
  body: { price: 0.01 },
  prefer: "return=representation",
});
check("anon UPDATE on products affects 0 rows", Array.isArray(upd.json) && upd.json.length === 0,
  `status ${upd.status}, ${Array.isArray(upd.json) ? upd.json.length : "?"} rows returned`);

const del = await anon("DELETE", "products?slug=eq.signature-canvas-tote", { prefer: "return=representation" });
check("anon DELETE on products affects 0 rows", Array.isArray(del.json) && del.json.length === 0,
  `status ${del.status}, ${Array.isArray(del.json) ? del.json.length : "?"} rows returned`);

const vIns = await anon("POST", "variants", { body: { product_id: null, color: "x", size: "x", stock: 1 } });
check("anon INSERT on variants rejected", vIns.status === 401 || vIns.status === 403,
  `status ${vIns.status} ${vIns.json?.code ?? ""}`);

const still = await anon("GET", "products?select=slug,price&order=slug");
check("catalog survived the write attempts unchanged",
  still.json?.length === productCount &&
    Number(still.json.find((p) => p.slug === "rabbit-hole-hoodie")?.price) === 65,
  JSON.stringify(still.json));

// -- 3. reservations are invisible ------------------------------------------
section("3. Reservations are server-only");

const resv = await anon("GET", "reservations?select=*");
check("anon SELECT on reservations denied (not just empty)",
  resv.status === 401 || resv.status === 403,
  `status ${resv.status} ${resv.json?.code ?? ""} ${resv.json?.message ?? ""}`);

const resvIns = await anon("POST", "reservations", {
  body: { variant_id: "00000000-0000-0000-0000-000000000000", quantity: 1, stripe_session_id: "probe", expires_at: new Date(Date.now() + 6e5).toISOString() },
});
check("anon INSERT on reservations denied", resvIns.status === 401 || resvIns.status === 403,
  `status ${resvIns.status} ${resvIns.json?.code ?? ""}`);

// -- 4. Available Stock with no reservations ---------------------------------
section("4. Available Stock (issue #3 done-when)");

const avail = await anon("GET", "variants_available?select=color,size,stock,available_stock&order=color,size");
check("anon can select variants_available",
  avail.status === 200 && avail.json?.length === variantCount,
  `status ${avail.status}, ${avail.json?.length ?? 0} rows (expected ${variantCount})`);
check("available_stock === stock when nothing is reserved",
  avail.json?.every((v) => v.available_stock === v.stock),
  JSON.stringify(avail.json));

// -- 5. a live Reservation reduces Available Stock ---------------------------
section("5. A held Reservation reduces Available Stock (ADR 0010)");

const target = (await svc("GET", "variants?select=id,color,size,stock&color=eq.Espresso&size=eq.M")).json?.[0];
check("found target variant Espresso/M with stock 12", target?.stock === 12, JSON.stringify(target));

const held = await svc("POST", "reservations", {
  body: {
    variant_id: target.id,
    quantity: 2,
    stripe_session_id: "cs_test_verification_probe",
    expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
  },
  prefer: "return=representation",
});
check("service role can insert a Reservation", held.status === 201, `status ${held.status} ${held.text.slice(0, 120)}`);
const heldId = held.json?.[0]?.id;

const afterHold = (await anon("GET", `variants_available?select=stock,available_stock&id=eq.${target.id}`)).json?.[0];
check("anon sees available_stock 10 while 2 are held",
  afterHold?.stock === 12 && afterHold?.available_stock === 10, JSON.stringify(afterHold));

// -- 6. expiry is computed, not scheduled ------------------------------------
section("6. Expiry is computed, not scheduled (ADR 0010)");

await svc("PATCH", `reservations?id=eq.${heldId}`, {
  body: { expires_at: new Date(Date.now() - 60_000).toISOString() },
});
const afterExpiry = (await anon("GET", `variants_available?select=available_stock&id=eq.${target.id}`)).json?.[0];
check("a lapsed Reservation stops holding stock without being released",
  afterExpiry?.available_stock === 12, JSON.stringify(afterExpiry));

await svc("DELETE", `reservations?id=eq.${heldId}`);
const cleaned = (await svc("GET", "reservations?select=id")).json;
check("test Reservation cleaned up", cleaned?.length === 0, `${cleaned?.length ?? "?"} rows remain`);

// -- 7. Hidden hides the Product and its Variants ----------------------------
section("7. Hidden excludes a Product and its Variants");

// These assert on the Hidden Product itself, not on what is left over. Counting
// the remainder only works while the catalog is a known size; "did the hoodie
// and its Variants disappear" is the property CONTEXT.md actually claims, and it
// holds at any catalog size.
const hoodieId = (await svc("GET", "products?select=id&slug=eq.rabbit-hole-hoodie")).json?.[0]?.id;

await svc("PATCH", "products?slug=eq.rabbit-hole-hoodie", { body: { is_hidden: true } });

const hiddenProducts = (await anon("GET", "products?select=slug")).json;
check("the Hidden Product vanishes from anon's catalog",
  Array.isArray(hiddenProducts) &&
    !hiddenProducts.some((p) => p.slug === "rabbit-hole-hoodie") &&
    hiddenProducts.length === productCount - 1,
  JSON.stringify(hiddenProducts));

const hiddenAvail = (await anon("GET", `variants_available?select=color,size&product_id=eq.${hoodieId}`)).json;
check("its Variants vanish from variants_available too",
  hiddenAvail?.length === 0, `${hiddenAvail?.length ?? "?"} rows`);

const hiddenVariants = (await anon("GET", `variants?select=color,size&product_id=eq.${hoodieId}`)).json;
check("and from variants", hiddenVariants?.length === 0, `${hiddenVariants?.length ?? "?"} rows`);

await svc("PATCH", "products?slug=eq.rabbit-hole-hoodie", { body: { is_hidden: false } });
const restored = (await anon("GET", "products?select=slug")).json;
check("reverted: the Product is visible again",
  Array.isArray(restored) &&
    restored.some((p) => p.slug === "rabbit-hole-hoodie") &&
    restored.length === productCount,
  JSON.stringify(restored));

// -- 8. seed is idempotent ---------------------------------------------------
section("8. Seed idempotency (issue #4)");
const ids = (await svc("GET", "products?select=id,slug&order=slug")).json;
console.log("        ", JSON.stringify(ids));
console.log("         Idempotency is not provable from here: `db push` skips already-applied");
console.log("         migrations. To check it, re-execute the seed directly --");
console.log("           npx supabase db query --linked -f supabase/migrations/20260825120200_seed_initial_products.sql");
console.log("         -- then confirm the ids above are unchanged. They must be updated in place;");
console.log("         a delete-and-reinsert would issue new UUIDs and orphan future foreign keys.");

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
