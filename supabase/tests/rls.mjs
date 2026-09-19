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

const avail = await anon("GET", "variants_available?select=id,color,size,stock,available_stock&order=color,size");
check("anon can select variants_available",
  avail.status === 200 && avail.json?.length === variantCount,
  `status ${avail.status}, ${avail.json?.length ?? 0} rows (expected ${variantCount})`);
// Not "available_stock === stock". Reservations are real rows left by real
// checkouts: a sandbox purchase holds stock for thirty minutes, and until #18
// consumes it the row simply sits there. Asserting an empty reservations table
// turns someone else's ordinary test purchase into a red suite -- the same
// mistake as the exact catalog counts that failed on 2026-08-30.
//
// What holds at any moment is the view's own definition: stock minus what is
// currently held. Read with the secret key, because anon must not see holds.
const heldNow = (await svc("GET",
  `reservations?select=variant_id,quantity&status=eq.held&expires_at=gt.${new Date().toISOString()}`)).json ?? [];
const heldPer = {};
for (const r of heldNow) heldPer[r.variant_id] = (heldPer[r.variant_id] ?? 0) + r.quantity;

check("available_stock === stock minus what is actually held",
  avail.json?.every((v) => v.available_stock === Math.max(0, v.stock - (heldPer[v.id] ?? 0))),
  `${heldNow.length} live hold(s) ${JSON.stringify(heldPer)} against ${JSON.stringify(avail.json)}`);

// -- 5. a live Reservation reduces Available Stock ---------------------------
section("5. A held Reservation reduces Available Stock (ADR 0010)");

// Every assertion below is relative to what the view reports right now rather
// than to a literal: the client edits stock in Supabase Studio (#5), and this
// Variant may already be carrying someone's live hold.
const target = (await svc("GET", "variants?select=id,color,size,stock&color=eq.Espresso&size=eq.M")).json?.[0];
check("found a target Variant with room to hold 2", (target?.stock ?? 0) >= 2, JSON.stringify(target));

const availBefore = (await anon("GET", `variants_available?select=available_stock&id=eq.${target.id}`))
  .json?.[0]?.available_stock;

const held = await svc("POST", "reservations", {
  body: {
    variant_id: target.id,
    quantity: 2,
    unit_price: 19.99,
    stripe_session_id: "cs_test_verification_probe",
    expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
  },
  prefer: "return=representation",
});
check("service role can insert a Reservation", held.status === 201, `status ${held.status} ${held.text.slice(0, 120)}`);
const heldId = held.json?.[0]?.id;

const afterHold = (await anon("GET", `variants_available?select=stock,available_stock&id=eq.${target.id}`)).json?.[0];
check("anon sees Available Stock fall by the 2 held",
  afterHold?.available_stock === availBefore - 2,
  `before ${availBefore}, after ${JSON.stringify(afterHold)}`);

// -- 6. expiry is computed, not scheduled ------------------------------------
section("6. Expiry is computed, not scheduled (ADR 0010)");

await svc("PATCH", `reservations?id=eq.${heldId}`, {
  body: { expires_at: new Date(Date.now() - 60_000).toISOString() },
});
const afterExpiry = (await anon("GET", `variants_available?select=available_stock&id=eq.${target.id}`)).json?.[0];
check("a lapsed Reservation stops holding stock without being released",
  afterExpiry?.available_stock === availBefore,
  `before ${availBefore}, after ${JSON.stringify(afterExpiry)}`);

await svc("DELETE", `reservations?id=eq.${heldId}`);
// Scoped to this suite's own probe, not to the whole table: a global "no
// Reservations exist" assertion is false the moment anybody checks out.
const cleaned = (await svc("GET", "reservations?select=id&stripe_session_id=eq.cs_test_verification_probe")).json;
check("test Reservation cleaned up", cleaned?.length === 0, `${cleaned?.length ?? "?"} rows remain`);

// -- 7. Hidden hides the Product, its Variants, and its taxonomy terms -------
section("7. Hidden excludes a Product, its Variants, and its facet terms");

// These assert on the Hidden Product itself, not on what is left over. Counting
// the remainder only works while the catalog is a known size; "did the hoodie
// and its Variants disappear" is the property CONTEXT.md actually claims, and it
// holds at any catalog size.
const hoodieId = (await svc("GET", "products?select=id&slug=eq.rabbit-hole-hoodie")).json?.[0]?.id;

// catalog_facets (#37) is a derived list, so the invariant that holds at any
// catalog size is: it says exactly what anon's own visible Products say. If the
// view ever ran with definer rights it would see through RLS, keep offering a
// Hidden Product's terms, and this equality would break -- which is the whole
// reason the migration takes security_invoker. See its comment block.
const facetTerms = async () => {
  const rows = (await anon("GET", "catalog_facets?select=dimension,value")).json ?? [];
  return new Set(rows.map((r) => `${r.dimension}:${r.value}`));
};

const termsAnonCanSee = async () => {
  const rows = (await anon("GET", "products?select=department,category,collections")).json ?? [];
  const terms = new Set();
  for (const p of rows) {
    if (p.department) terms.add(`department:${p.department}`);
    if (p.category) terms.add(`category:${p.category}`);
    for (const c of p.collections ?? []) terms.add(`collection:${c}`);
  }
  return terms;
};

const sameTerms = (a, b) => a.size === b.size && [...a].every((t) => b.has(t));

const facetsBefore = await facetTerms();
check("catalog_facets matches the terms anon's visible Products carry",
  sameTerms(facetsBefore, await termsAnonCanSee()),
  JSON.stringify([...facetsBefore]));

// Which of the hoodie's terms no other visible Product carries. Computed rather
// than hardcoded: the client adds Products between sessions, and a term that is
// exclusive today may be shared next week without that being a failure.
const hoodie = (await svc("GET", "products?select=department,category,collections&slug=eq.rabbit-hole-hoodie")).json?.[0];
const hoodieTerms = new Set([
  ...(hoodie?.department ? [`department:${hoodie.department}`] : []),
  ...(hoodie?.category ? [`category:${hoodie.category}`] : []),
  ...(hoodie?.collections ?? []).map((c) => `collection:${c}`),
]);

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

const facetsWhileHidden = await facetTerms();
check("catalog_facets still matches what anon can see, with the Product Hidden",
  sameTerms(facetsWhileHidden, await termsAnonCanSee()),
  JSON.stringify([...facetsWhileHidden]));

// The sharper claim, when the data supports it: a term nothing else carries is
// gone from the drawer entirely, so no shopper can tick a filter whose only
// Product is Hidden. Shared terms must survive -- hiding one Product must not
// empty a facet other Products still populate.
const exclusive = [...hoodieTerms].filter((t) => !facetsWhileHidden.has(t));
const shared = [...hoodieTerms].filter((t) => facetsWhileHidden.has(t));
if (exclusive.length > 0) {
  check("a term only the Hidden Product carried is gone from the facets",
    exclusive.every((t) => facetsBefore.has(t)), JSON.stringify(exclusive));
} else {
  console.log("         (no term was exclusive to the hoodie in the current catalog;");
  console.log("          the equality checks above still cover the Hidden rule)");
}
check("terms other visible Products also carry survive the hide",
  shared.every((t) => facetsBefore.has(t)), JSON.stringify(shared));

await svc("PATCH", "products?slug=eq.rabbit-hole-hoodie", { body: { is_hidden: false } });
const restored = (await anon("GET", "products?select=slug")).json;
check("reverted: the Product is visible again",
  Array.isArray(restored) &&
    restored.some((p) => p.slug === "rabbit-hole-hoodie") &&
    restored.length === productCount,
  JSON.stringify(restored));

const facetsAfter = await facetTerms();
check("reverted: its terms are back in the facets",
  sameTerms(facetsAfter, facetsBefore), JSON.stringify([...facetsAfter]));

// -- 8. seed is idempotent ---------------------------------------------------
section("8. Seed idempotency (issue #4)");
const ids = (await svc("GET", "products?select=id,slug&order=slug")).json;
console.log("        ", JSON.stringify(ids));
console.log("         Idempotency is not provable from here: `db push` skips already-applied");
console.log("         migrations. To check it, re-execute the seed directly --");
console.log("           npx supabase db query --linked -f supabase/migrations/20260825120200_seed_initial_products.sql");
console.log("         -- then confirm the ids above are unchanged. They must be updated in place;");
console.log("         a delete-and-reinsert would issue new UUIDs and orphan future foreign keys.");

// -- 9. reserve_cart: the atomic check-and-hold ------------------------------
section("9. reserve_cart: atomic check-and-hold (#15, ADR 0010)");

// What matters here is what Postgres does under concurrency, which no unit test
// can tell you -- so this runs against the real database (CLAUDE.md).

const rpc = (key, body) => req(key, "POST", "rpc/reserve_cart", { body });
const inThirtyMinutes = () => new Date(Date.now() + 30 * 60_000).toISOString();

// `order=id` rather than a bare limit=1: an unordered limit lets Postgres return
// a different Variant between runs, which would make a failure here depend on
// which row it happened to pick.
// The first Variant carrying no live hold. Taking `limit=1` blindly lands on
// whatever id sorts first, which may be the one a real checkout is holding --
// and then every arithmetic assertion below is off by that hold.
const testVariant = (await svc("GET", "variants?select=id,stock&order=id")).json
  ?.find((v) => !(v.id in heldPer));
if (!testVariant) throw new Error("no variants in the database to test reserve_cart against");

const clearHolds = () => svc("DELETE", "reservations?stripe_session_id=like.cs_test_rc_*");

// try/finally, because this block edits variants.stock. Without it a thrown
// error partway through leaves a real Product on a fabricated stock count, and
// db:verify is documented to write nothing permanent.
try {
  // -- the browser must not be able to call it at all ------------------------
  const anonCall = await rpc(ANON, {
    p_session_id: "cs_test_rc_anon",
    p_expires_at: inThirtyMinutes(),
    p_items: [{ variant_id: testVariant.id, quantity: 1, unit_price: 19.99 }],
  });
  check("anon cannot execute reserve_cart", anonCall.status !== 200, `status ${anonCall.status}`);

  // -- a satisfiable hold succeeds and reduces Available Stock ---------------
  await svc("PATCH", `variants?id=eq.${testVariant.id}`, { body: { stock: 5 } });

  const ok = await rpc(SERVICE, {
    p_session_id: "cs_test_rc_ok_1",
    p_expires_at: inThirtyMinutes(),
    p_items: [{ variant_id: testVariant.id, quantity: 2, unit_price: 19.99 }],
  });
  check("a satisfiable hold returns no shortfalls",
    ok.status === 200 && ok.json?.length === 0, `status ${ok.status} ${JSON.stringify(ok.json)}`);

  const afterReserve = (await svc("GET", `variants_available?select=available_stock&id=eq.${testVariant.id}`)).json?.[0];
  check("Available Stock drops by the held quantity",
    afterReserve?.available_stock === 3, JSON.stringify(afterReserve));

  // -- all or nothing --------------------------------------------------------
  const tooMany = await rpc(SERVICE, {
    p_session_id: "cs_test_rc_short_1",
    p_expires_at: inThirtyMinutes(),
    p_items: [{ variant_id: testVariant.id, quantity: 99, unit_price: 19.99 }],
  });
  check("an unsatisfiable hold reports the shortfall",
    tooMany.json?.[0]?.available === 3, JSON.stringify(tooMany.json));

  const shortRows = (await svc("GET", "reservations?select=id&stripe_session_id=eq.cs_test_rc_short_1")).json ?? [];
  check("an unsatisfiable hold inserts nothing", shortRows.length === 0, JSON.stringify(shortRows));

  // -- an unknown Variant is a shortfall, not a silent skip -------------------
  const ghost = await rpc(SERVICE, {
    p_session_id: "cs_test_rc_ghost_1",
    p_expires_at: inThirtyMinutes(),
    p_items: [{ variant_id: "00000000-0000-4000-8000-000000000000", quantity: 1, unit_price: 19.99 }],
  });
  check("an unknown variant reports available 0",
    ghost.json?.[0]?.available === 0, JSON.stringify(ghost.json));

  // -- the race: two shoppers, one unit --------------------------------------
  await clearHolds();
  await svc("PATCH", `variants?id=eq.${testVariant.id}`, { body: { stock: 1 } });

  const [raceA, raceB] = await Promise.all([
    rpc(SERVICE, { p_session_id: "cs_test_rc_race_a", p_expires_at: inThirtyMinutes(),
                   p_items: [{ variant_id: testVariant.id, quantity: 1, unit_price: 19.99 }] }),
    rpc(SERVICE, { p_session_id: "cs_test_rc_race_b", p_expires_at: inThirtyMinutes(),
                   p_items: [{ variant_id: testVariant.id, quantity: 1, unit_price: 19.99 }] }),
  ]);

  const winners = [raceA, raceB].filter((r) => r.status === 200 && r.json?.length === 0).length;
  check("exactly one of two concurrent shoppers gets the last unit", winners === 1,
    `winners=${winners} a=${JSON.stringify(raceA.json)} b=${JSON.stringify(raceB.json)}`);
} finally {
  await clearHolds();
  await svc("PATCH", `variants?id=eq.${testVariant.id}`, { body: { stock: testVariant.stock } });
}

const stockRestored = (await svc("GET", `variants?select=stock&id=eq.${testVariant.id}`)).json?.[0];
check("test stock restored", stockRestored?.stock === testVariant.stock, JSON.stringify(stockRestored));

const holdsLeft = (await svc("GET", "reservations?select=id&stripe_session_id=like.cs_test_rc_*")).json ?? [];
check("no test Reservation left behind", holdsLeft.length === 0, `${holdsLeft.length} rows remain`);

// -- 10. Orders are never anonymous ------------------------------------------
section("10. Orders and Order Items are invisible to anon (#17)");

// An Order is never public. Both policies are `to authenticated`, and anon has
// no grant at all -- so this must be denied outright rather than returning an
// empty list. The distinction matters: an empty 200 is also what a *broken*
// policy returns while the table is still empty, and it would look fine here.
const ordersAnon = await anon("GET", "orders?select=*");
check("anon SELECT on orders denied (not just empty)",
  ordersAnon.status === 401 || ordersAnon.status === 403,
  `status ${ordersAnon.status} ${ordersAnon.json?.code ?? ""} ${ordersAnon.json?.message ?? ""}`);

const itemsAnon = await anon("GET", "order_items?select=*");
check("anon SELECT on order_items denied (not just empty)",
  itemsAnon.status === 401 || itemsAnon.status === 403,
  `status ${itemsAnon.status} ${itemsAnon.json?.code ?? ""}`);

// Orders come from the webhook or they do not exist (#18). Nobody holding a
// browser key may fabricate one -- that would be a Paid Order nobody paid for.
const orderIns = await anon("POST", "orders", {
  body: { user_id: "00000000-0000-4000-8000-000000000000", stripe_session_id: "cs_test_rls_probe", total: 1 },
});
check("anon INSERT on orders denied", orderIns.status === 401 || orderIns.status === 403,
  `status ${orderIns.status} ${orderIns.json?.code ?? ""}`);

// The #17 done-when: no anon-key write to status succeeds. Fulfilment state is
// the shop's word, not the shopper's -- "Delivered" set from a browser is a
// customer signing for their own parcel.
const statusUpd = await anon("PATCH", "orders?status=eq.Paid", {
  body: { status: "Delivered" },
  prefer: "return=representation",
});
check("anon UPDATE of order status denied",
  statusUpd.status === 401 || statusUpd.status === 403,
  `status ${statusUpd.status} ${statusUpd.json?.code ?? ""}`);

// The webhook's key must still reach the table, or #18 has nowhere to write.
// Also the only check here that fails loudly if the migration never ran: every
// denial above would pass just as happily against a table that does not exist.
const ordersSvc = await svc("GET", "orders?select=id&limit=1");
check("the secret key can read orders (what #18 writes with)",
  ordersSvc.status === 200, `status ${ordersSvc.status} ${ordersSvc.json?.message ?? ""}`);

// -- 11. Releasing a lapsed Session's holds (#30) -----------------------------
section("11. checkout.session.expired releases only held Reservations (#30)");

// What the webhook's expired branch does, as PostgREST sees it. Note what this
// is NOT: it is not a test that stock comes back. Stock comes back on its own --
// section 5 above already proves a lapsed Reservation stops holding it with
// nothing released at all, which is the load-bearing half of ADR 0010 and the
// reason a missed webhook cannot strand inventory.
//
// This covers the other half: the release must never touch a Reservation that a
// payment already consumed. Stripe does not send `expired` for a Session that
// completed, so the filter is belt-and-braces -- but an unfiltered UPDATE here
// would rewrite the history of a paid Order, and that is not a thing to leave
// resting on an assumption about another company's event ordering.
const relVariant = (await svc("GET", "variants?select=id&order=id")).json?.[0];
if (!relVariant) throw new Error("no variants in the database to test the release against");

const relRows = [
  { variant_id: relVariant.id, quantity: 1, unit_price: 19.99, status: "held",
    stripe_session_id: "cs_test_rel_held", expires_at: inThirtyMinutes() },
  { variant_id: relVariant.id, quantity: 1, unit_price: 19.99, status: "consumed",
    stripe_session_id: "cs_test_rel_consumed", expires_at: inThirtyMinutes() },
];
const clearRel = () => svc("DELETE", "reservations?stripe_session_id=like.cs_test_rel_*");

try {
  const seeded = await svc("POST", "reservations", { body: relRows });
  check("seeded a held and a consumed Reservation", seeded.status === 201,
    `status ${seeded.status} ${seeded.text.slice(0, 120)}`);

  // Exactly the filter app/api/stripe/webhook/route.ts applies.
  const released = await svc("PATCH",
    "reservations?stripe_session_id=eq.cs_test_rel_held&status=eq.held",
    { body: { status: "released" }, prefer: "return=representation" });
  check("a held Reservation is marked released",
    released.json?.[0]?.status === "released", JSON.stringify(released.json));

  // The same call against the consumed Session must match zero rows. An empty
  // representation is the assertion: it says the predicate excluded the row,
  // not that the update happened to write the same value back over it.
  const spared = await svc("PATCH",
    "reservations?stripe_session_id=eq.cs_test_rel_consumed&status=eq.held",
    { body: { status: "released" }, prefer: "return=representation" });
  check("a consumed Reservation is not released", spared.json?.length === 0,
    JSON.stringify(spared.json));

  const consumedStill = (await svc("GET",
    "reservations?select=status&stripe_session_id=eq.cs_test_rel_consumed")).json?.[0];
  check("the consumed Reservation still reads consumed",
    consumedStill?.status === "consumed", JSON.stringify(consumedStill));

  // Stripe redelivers until it gets a 2xx, so a second delivery has to be a
  // no-op rather than an error -- the status filter is what makes it one.
  const replay = await svc("PATCH",
    "reservations?stripe_session_id=eq.cs_test_rel_held&status=eq.held",
    { body: { status: "released" }, prefer: "return=representation" });
  check("replaying the release is a no-op", replay.status === 200 && replay.json?.length === 0,
    `status ${replay.status} ${JSON.stringify(replay.json)}`);
} finally {
  await clearRel();
}

const relLeft = (await svc("GET", "reservations?select=id&stripe_session_id=like.cs_test_rel_*")).json ?? [];
check("no test Reservation left behind", relLeft.length === 0, `${relLeft.length} rows remain`);

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
