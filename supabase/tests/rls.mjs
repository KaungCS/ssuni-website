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
// Writes nothing permanent. The Reservation it creates is deleted, the is_hidden
// flag it toggles is reverted, and section 14's throwaway accounts, Orders and
// probe Product are removed in a `finally`. Everything it creates carries an
// `rls-probe-` marker and is swept at the START of the run as well as the end,
// because a crashed run is exactly when cleanup does not happen.

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

// `bearer` is only ever passed for a signed-in user (section 14). It is the one
// case where the two headers legitimately differ: the publishable key says which
// project, the token says which person. For the API keys themselves they must be
// identical, which is why every other caller leaves it unset.
async function req(key, method, path, { body, prefer, bearer } = {}) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${bearer ?? key}`,
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

// Not a floor of 6. That literal was the count of the seeded Variants, and it
// goes red the moment the client Hides a Product in the dashboard -- which is an
// ordinary thing for them to do, and not a policy failure. The property that
// holds at any catalog size and any Hidden state is the one the policy actually
// claims: anon sees every Variant of every visible Product, and no others.
const variants = await anon("GET", "variants?select=color,size,stock");
const visibleVariantCount = (await svc(
  "GET", "variants?select=id,products!inner(is_hidden)&products.is_hidden=is.false"
)).json?.length ?? -1;
check("anon sees exactly the Variants of visible Products",
  variants.status === 200 && variants.json?.length === visibleVariantCount,
  `status ${variants.status}, anon ${variants.json?.length ?? 0} vs ${visibleVariantCount} visible`);

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

// Compared against the snapshot taken moments ago, not against a hardcoded slug
// and price. The claim here is "nothing the anon key attempted changed anything",
// which is true of whatever catalog happens to exist -- naming rabbit-hole-hoodie
// at 65 turned a Hidden Product, or an edited price, into a fake RLS failure.
const still = await anon("GET", "products?select=slug,price&order=slug");
const before = JSON.stringify((products.json ?? []).map((p) => [p.slug, Number(p.price)]));
const after = JSON.stringify((still.json ?? []).map((p) => [p.slug, Number(p.price)]));
check("catalog survived the write attempts unchanged", before === after && still.json?.length === productCount,
  before === after ? JSON.stringify(still.json) : `before ${before} / after ${after}`);

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

// The client Hides Products in the dashboard, so this Product may ALREADY be
// Hidden when the suite runs -- and until 2026-09-22 the revert below set
// is_hidden to false unconditionally, meaning a test run silently un-hid a
// Product the client had deliberately hidden. Capture the prior state, force
// the starting condition these checks assume, and put the restore in a finally
// so a failed assertion cannot leave the storefront changed either.
const hoodieWasHidden = (await svc("GET", "products?select=is_hidden&slug=eq.rabbit-hole-hoodie")).json?.[0]?.is_hidden === true;
if (hoodieWasHidden) {
  console.log("         (this Product was already Hidden; it is shown for the length of this",);
  console.log("          section and restored to Hidden afterwards)");
  await svc("PATCH", "products?slug=eq.rabbit-hole-hoodie", { body: { is_hidden: false } });
}

try {
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

} finally {
  await svc("PATCH", "products?slug=eq.rabbit-hole-hoodie", { body: { is_hidden: hoodieWasHidden } });
}

// Only meaningful when the Product is meant to be visible; when the client has
// it Hidden, "visible again" is not the state to restore.
if (!hoodieWasHidden) {
  const restored = (await anon("GET", "products?select=slug")).json;
  check("reverted: the Product is visible again",
    Array.isArray(restored) &&
      restored.some((p) => p.slug === "rabbit-hole-hoodie") &&
      restored.length === productCount,
    JSON.stringify(restored));

  const facetsAfter = await facetTerms();
  check("reverted: its terms are back in the facets",
    sameTerms(facetsAfter, facetsBefore), JSON.stringify([...facetsAfter]));
}


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

// -- 12. hero_stories -------------------------------------------------------
section("12. Hero Stories are public to read, admin-only to write, and ordered (#22)");

// Same shape as the products checks above, because hero_stories carries the same
// pair of policies. What is specific to #22 is the last check: the landing page
// renders these in `sort_order`, and an unordered home page is the failure the
// client would notice first.

const heroes = await anon("GET", "hero_stories?select=id,title,sort_order&order=sort_order");
check("anon can select hero_stories", heroes.status === 200 && heroes.json?.length >= 1,
  `status ${heroes.status}, ${heroes.json?.length ?? 0} rows (expected >= 1)`);

const heroIns = await anon("POST", "hero_stories", {
  body: { title: "rls-probe-hero anon", image_url: "/images/download.jpeg" },
});
check("anon INSERT on hero_stories rejected", heroIns.status === 401 || heroIns.status === 403,
  `status ${heroIns.status} ${heroIns.json?.code ?? ""}`);

const heroDel = await anon("DELETE", "hero_stories?title=like.rls-probe-hero*");
check("anon DELETE on hero_stories affects nothing",
  heroDel.status === 401 || heroDel.status === 403 || heroDel.status === 204,
  `status ${heroDel.status}`);

// Seeded out of display order on purpose: if the ordering check passed on
// insertion order it would prove nothing.
const clearHeroes = () => svc("DELETE", "hero_stories?title=like.rls-probe-hero*");

try {
  const seededHeroes = await svc("POST", "hero_stories", {
    body: [
      // Every object needs identical keys -- PostgREST rejects a mixed batch
      // with PGRST102 "All object keys must match" rather than defaulting the
      // missing ones.
      { title: "rls-probe-hero second", image_url: "/images/download.jpeg", sort_order: 901,
        is_hidden: false },
      { title: "rls-probe-hero first", image_url: "/images/download.jpeg", sort_order: 900,
        is_hidden: false },
      { title: "rls-probe-hero hidden", image_url: "/images/download.jpeg", sort_order: 902,
        is_hidden: true },
    ],
  });
  check("seeded three probe Hero Stories", seededHeroes.status === 201,
    `status ${seededHeroes.status} ${seededHeroes.text.slice(0, 120)}`);

  const visible = ((await anon("GET", "hero_stories?select=title,sort_order&order=sort_order"))
    .json ?? []).filter((h) => h.title.startsWith("rls-probe-hero"));

  // Asserted on the probe rows only, never on the whole table: the client adds
  // Hero Stories in Supabase Studio exactly as they add Products, and a check
  // that counts the table turns that into a red suite (CLAUDE.md).
  check("hero_stories come back in sort_order",
    visible.map((h) => h.title).join(" | ") === "rls-probe-hero first | rls-probe-hero second",
    visible.map((h) => `${h.sort_order}:${h.title}`).join(" | "));

  // The Hidden rule, asserted as the property rather than as a count: the
  // Hidden Story is gone for anon and present for the service role.
  // The length check is not decoration: without it this passes when the seed
  // above failed and anon can see nothing at all, which is how it read green
  // through a broken batch insert the first time it ran.
  check("a Hidden Hero Story is invisible to anon",
    visible.length === 2 && !visible.some((h) => h.title === "rls-probe-hero hidden"),
    visible.map((h) => h.title).join(" | "));

  const hiddenToSvc = (await svc("GET",
    "hero_stories?select=title&title=eq.rls-probe-hero hidden")).json ?? [];
  check("the Hidden Hero Story still exists", hiddenToSvc.length === 1,
    `${hiddenToSvc.length} rows`);
} finally {
  await clearHeroes();
}

const heroesLeft = (await svc("GET", "hero_stories?select=id&title=like.rls-probe-hero*")).json ?? [];
check("no probe Hero Story left behind", heroesLeft.length === 0, `${heroesLeft.length} rows remain`);

// -- 13. product_images + the Storage bucket --------------------------------
section("13. Product images follow their Product, and the bucket is admin-write (#11)");

// The policy under test is product_images_select_visible, which names no
// is_hidden at all -- it asks whether the parent Product is visible and lets
// products_select_visible answer. The check that matters is therefore the
// Hidden one: get it wrong and the photography for an unreleased drop is
// readable by anyone who guesses the table name.
//
// Uses a probe Product of its own rather than hiding a real one. Section 7
// toggles is_hidden on seeded data and reverts it; that is fine there, but the
// client now adds real Products between sessions (CLAUDE.md), and hiding one of
// theirs -- even for a second, even reverted -- is a live storefront briefly
// missing a Product.

const PROBE_SLUG = "rls-probe-images-product";
const clearProbeProduct = () => svc("DELETE", `products?slug=eq.${PROBE_SLUG}`);

await clearProbeProduct();

try {
  const probe = await svc("POST", "products", {
    body: { slug: PROBE_SLUG, name: "rls probe images", price: 1.0, is_hidden: false },
    prefer: "return=representation",
  });
  const probeId = probe.json?.[0]?.id;
  check("seeded a probe Product", probe.status === 201 && !!probeId,
    `status ${probe.status} ${probe.text.slice(0, 120)}`);

  // Inserted out of display order so that an ordering check cannot pass just by
  // agreeing with insertion order.
  const seededImages = await svc("POST", "product_images", {
    body: [
      { product_id: probeId, url: "https://example.test/b.jpg", sort_order: 1, color: null },
      { product_id: probeId, url: "https://example.test/a.jpg", sort_order: 0, color: null },
      { product_id: probeId, url: "https://example.test/c.jpg", sort_order: 2, color: "Sage" },
    ],
  });
  check("seeded three probe images", seededImages.status === 201,
    `status ${seededImages.status} ${seededImages.text.slice(0, 120)}`);

  const visibleImages = (await anon("GET",
    `product_images?select=url,sort_order,color&product_id=eq.${probeId}&order=sort_order`)).json ?? [];
  check("anon can select a visible Product's images", visibleImages.length === 3,
    `${visibleImages.length} rows (expected 3)`);
  check("sort_order round-trips through PostgREST",
    visibleImages.map((i) => i.url).join(" | ") ===
      "https://example.test/a.jpg | https://example.test/b.jpg | https://example.test/c.jpg",
    visibleImages.map((i) => `${i.sort_order}:${i.url}`).join(" | "));
  check("the unwired color column stores what it is given",
    visibleImages[2]?.color === "Sage", `got ${JSON.stringify(visibleImages[2]?.color)}`);

  const imgIns = await anon("POST", "product_images", {
    body: { product_id: probeId, url: "https://example.test/anon.jpg" },
  });
  check("anon INSERT on product_images rejected", imgIns.status === 401 || imgIns.status === 403,
    `status ${imgIns.status} ${imgIns.json?.code ?? ""}`);

  const imgDel = await anon("DELETE", `product_images?product_id=eq.${probeId}`);
  check("anon DELETE on product_images affects nothing",
    imgDel.status === 401 || imgDel.status === 403 || imgDel.status === 204,
    `status ${imgDel.status}`);
  const survived = (await svc("GET", `product_images?select=id&product_id=eq.${probeId}`)).json ?? [];
  check("the images survived the anon DELETE", survived.length === 3,
    `${survived.length} rows remain (expected 3)`);

  // The property this whole policy exists for.
  await svc("PATCH", `products?slug=eq.${PROBE_SLUG}`, { body: { is_hidden: true } });
  const hiddenImages = (await anon("GET",
    `product_images?select=url&product_id=eq.${probeId}`)).json ?? [];
  check("a Hidden Product's images are invisible to anon", hiddenImages.length === 0,
    `${hiddenImages.length} rows leaked`);
  const stillThere = (await svc("GET", `product_images?select=id&product_id=eq.${probeId}`)).json ?? [];
  check("...but they still exist", stillThere.length === 3, `${stillThere.length} rows`);

  // on delete cascade: deleting a Product must not strand its gallery rows.
  await clearProbeProduct();
  const orphans = (await svc("GET", `product_images?select=id&product_id=eq.${probeId}`)).json ?? [];
  check("deleting the Product cascades to its images", orphans.length === 0,
    `${orphans.length} orphan rows`);
} finally {
  await clearProbeProduct();
}

// The bucket. A different API from PostgREST, so a different base URL -- but the
// same question: the Admin Dashboard uploads from a browser (ADR 0007, amended),
// so these policies and not the admin UI are what refuse a signed-in customer.
const storage = (key, method, path, body) =>
  fetch(`${URL_}/storage/v1/${path}`, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    ...(body ? { body } : {}),
  }).then(async (r) => ({ status: r.status, text: await r.text() }));

const bucketInfo = await storage(SERVICE, "GET", "bucket/product-images");
check("the product-images bucket exists", bucketInfo.status === 200,
  `status ${bucketInfo.status} ${bucketInfo.text.slice(0, 120)}`);
check("the bucket is public-read", (() => {
  try { return JSON.parse(bucketInfo.text).public === true; } catch { return false; }
})(), bucketInfo.text.slice(0, 120));

const anonUpload = await storage(ANON, "POST", "object/product-images/rls-probe.txt",
  new Blob(["nope"]));
check("anon upload to the bucket rejected",
  anonUpload.status === 400 || anonUpload.status === 401 || anonUpload.status === 403,
  `status ${anonUpload.status} ${anonUpload.text.slice(0, 120)}`);

const anonUploaded = await storage(SERVICE, "GET", "object/product-images/rls-probe.txt");
check("nothing was written by the rejected upload", anonUploaded.status === 400 || anonUploaded.status === 404,
  `status ${anonUploaded.status}`);

// -- 14 & 15. real signed-in sessions ----------------------------------------
//
// Everything above this line is the anon key or the secret key. #24 asks for a
// third identity -- "attempting each forbidden read and write ... with a second
// customer's session" -- and until now that was only simulated, in
// admin-path.sql, by setting request.jwt.claims. That proves the policy
// EXPRESSION. It does not prove the path: PostgREST parsing a real token and
// resolving a real role, which is what a browser actually does.
//
// This was believed to be blocked by the Resend single-address limit (#27). It
// is not: the Auth admin API creates a confirmed user, the password grant
// returns a real token, and the admin API deletes the user afterwards. No email
// is sent at any point. The limit blocks manual testing, not this.

const PROBE_PREFIX = "rls-probe-";
const PROBE_PASSWORD = "rls-probe-pw-9f3a";
const PROBE_SESSION = "cs_test_rls_probe_";
const PROBE_HIDDEN_SLUG = "rls-probe-hidden-product";

async function auth(key, method, path, { body, bearer } = {}) {
  const res = await fetch(`${URL_}/auth/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${bearer ?? key}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-json body */ }
  return { status: res.status, json, text };
}

/** Everything this section could have left behind, whether or not it finished. */
async function sweepProbes() {
  await svc("DELETE", `orders?stripe_session_id=like.${PROBE_SESSION}*`);
  await svc("DELETE", `products?slug=eq.${PROBE_HIDDEN_SLUG}`);
  const listed = await auth(SERVICE, "GET", "admin/users?per_page=200");
  const stale = (listed.json?.users ?? []).filter((u) => (u.email ?? "").startsWith(PROBE_PREFIX));
  for (const u of stale) {
    await svc("DELETE", `admins?user_id=eq.${u.id}`);
    await auth(SERVICE, "DELETE", `admin/users/${u.id}`);
  }
  return stale.length;
}

/**
 * A throwaway account with a real session. `as` sends the publishable key as the
 * apikey and this user's token as the Bearer, which is exactly what
 * supabase-js does in a signed-in browser.
 */
async function createProbeUser(tag) {
  const email = `${PROBE_PREFIX}${tag}-${Date.now()}@example.com`;
  const created = await auth(SERVICE, "POST", "admin/users", {
    // email_confirm skips the confirmation mail AND the unconfirmed state that
    // would otherwise refuse the password grant below.
    body: { email, password: PROBE_PASSWORD, email_confirm: true },
  });
  const signedIn = await auth(ANON, "POST", "token?grant_type=password", {
    body: { email, password: PROBE_PASSWORD },
  });
  const token = signedIn.json?.access_token;
  return {
    tag,
    email,
    id: created.json?.id,
    token,
    ok: Boolean(created.json?.id && token),
    as: (m, p, o) => req(ANON, m, p, { ...o, bearer: token }),
    storageAs: (method, path, body) =>
      fetch(`${URL_}/storage/v1/${path}`, {
        method,
        headers: { apikey: ANON, Authorization: `Bearer ${token}` },
        ...(body ? { body } : {}),
      }).then(async (r) => ({ status: r.status, text: await r.text() })),
  };
}

section("14. Two real signed-in customers (#24)");

const swept = await sweepProbes();
if (swept > 0) console.log(`  (swept ${swept} leftover probe account(s) from an earlier run)`);

let customerA = null;
let customerB = null;
let probeAdmin = null;

try {
  customerA = await createProbeUser("a");
  customerB = await createProbeUser("b");
  check("two throwaway customers can sign in with real tokens",
    customerA.ok && customerB.ok,
    `A ${customerA.ok ? "ok" : "failed"}, B ${customerB.ok ? "ok" : "failed"}`);

  // Give each one an Order the way the webhook does -- with the secret key,
  // because nothing holding a browser key may create an Order (section 10).
  const anyVariant = (await svc("GET", "variants?select=id&limit=1")).json?.[0]?.id;

  async function giveOrder(user, suffix) {
    const order = await svc("POST", "orders", {
      body: { user_id: user.id, stripe_session_id: `${PROBE_SESSION}${suffix}`, total: 42.0 },
      prefer: "return=representation",
    });
    const id = order.json?.[0]?.id;
    if (id && anyVariant) {
      await svc("POST", "order_items", {
        body: { order_id: id, variant_id: anyVariant, quantity: 1, unit_price: 42.0 },
      });
    }
    return id;
  }

  const orderA = await giveOrder(customerA, "a");
  const orderB = await giveOrder(customerB, "b");
  check("both probe Orders were created by the secret key", Boolean(orderA && orderB),
    `A ${orderA ?? "none"}, B ${orderB ?? "none"}`);

  // A Hidden Product of our own. Section 7 toggles is_hidden on seeded rows and
  // reverts it; that is fine there, but the client adds real Products between
  // sessions and hiding one of theirs -- even briefly -- is a live storefront
  // missing a Product.
  const hidden = await svc("POST", "products", {
    body: {
      slug: PROBE_HIDDEN_SLUG, name: "RLS probe hidden", price: 10.0, is_hidden: true,
    },
    prefer: "return=representation",
  });
  const hiddenId = hidden.json?.[0]?.id;

  // -- what customer A may read ---------------------------------------------

  const aOrders = (await customerA.as("GET", "orders?select=id")).json ?? [];
  check("customer A sees their own Order",
    aOrders.some((o) => o.id === orderA), `${aOrders.length} rows`);
  check("customer A does NOT see customer B's Order",
    !aOrders.some((o) => o.id === orderB), `${aOrders.length} rows`);

  // The likelier shape of a leak: not selecting order_items directly, but
  // pulling them up through the Order they hang off. A different policy path.
  const embedded = await customerA.as("GET", `orders?select=id,order_items(id)&id=eq.${orderB}`);
  check("customer A cannot reach B's Order Items through the embed",
    (embedded.json ?? []).length === 0, `${(embedded.json ?? []).length} rows`);

  const aItems = (await customerA.as("GET", "order_items?select=id,order_id")).json ?? [];
  check("customer A's Order Items contain none of B's",
    !aItems.some((i) => i.order_id === orderB), `${aItems.length} rows`);

  // -- what customer A may write --------------------------------------------

  // Fulfilment is the shop's word. There is no own-Order update policy, so this
  // matches nothing and changes nothing -- asserted by re-reading rather than by
  // the status code, because "updated zero rows" is a 2xx.
  await customerA.as("PATCH", `orders?id=eq.${orderA}`, {
    body: { status: "Shipped", tracking_link: "https://example.com/nope" },
    prefer: "return=representation",
  });
  const afterSelfUpdate = (await svc("GET", `orders?select=status,tracking_link&id=eq.${orderA}`)).json?.[0];
  check("customer A cannot mark their own Order Shipped",
    afterSelfUpdate?.status === "Paid" && afterSelfUpdate?.tracking_link === null,
    `status ${afterSelfUpdate?.status}, tracking ${afterSelfUpdate?.tracking_link}`);

  const aAdmins = await customerA.as("GET", "admins?select=user_id");
  check("customer A sees no rows in admins (admins_select_self)",
    aAdmins.status === 200 && (aAdmins.json ?? []).length === 0,
    `status ${aAdmins.status}, ${(aAdmins.json ?? []).length} rows`);

  const aResv = await customerA.as("GET", "reservations?select=id");
  check("customer A cannot read reservations",
    aResv.status === 401 || aResv.status === 403 || (aResv.json ?? []).length === 0,
    `status ${aResv.status}, ${(aResv.json ?? []).length ?? 0} rows`);

  const aProductIns = await customerA.as("POST", "products", {
    body: { slug: "rls-probe-customer-write", name: "nope", price: 1 },
  });
  check("customer A cannot insert a Product",
    aProductIns.status === 401 || aProductIns.status === 403,
    `status ${aProductIns.status} ${aProductIns.json?.code ?? ""}`);

  await customerA.as("PATCH", `products?id=eq.${hiddenId}`, { body: { name: "hacked" } });
  const nameAfter = (await svc("GET", `products?select=name&id=eq.${hiddenId}`)).json?.[0]?.name;
  check("customer A cannot rename a Product", nameAfter === "RLS probe hidden", `name is "${nameAfter}"`);

  await customerA.as("DELETE", `products?id=eq.${hiddenId}`);
  const stillExists = (await svc("GET", `products?select=id&id=eq.${hiddenId}`)).json ?? [];
  check("customer A cannot delete a Product", stillExists.length === 1, `${stillExists.length} rows`);

  const aHeroIns = await customerA.as("POST", "hero_stories", {
    body: { title: "rls-probe-hero customer", image_url: "/images/download.jpeg" },
  });
  check("customer A cannot insert a Hero Story",
    aHeroIns.status === 401 || aHeroIns.status === 403,
    `status ${aHeroIns.status} ${aHeroIns.json?.code ?? ""}`);

  const aImageIns = await customerA.as("POST", "product_images", {
    body: { product_id: hiddenId, url: "https://example.com/nope.jpg", sort_order: 0 },
  });
  check("customer A cannot insert a product image",
    aImageIns.status === 401 || aImageIns.status === 403,
    `status ${aImageIns.status} ${aImageIns.json?.code ?? ""}`);

  // The bucket, as a signed-in customer rather than anonymously. This is the
  // likelier attacker and the exact path components/AdminImageUploader.tsx
  // takes in a browser -- it uploads client-side, so the policy is the boundary.
  const aUpload = await customerA.storageAs("POST", "object/product-images/rls-probe-customer.txt",
    new Blob(["nope"]));
  check("customer A cannot upload to the product-images bucket",
    aUpload.status === 400 || aUpload.status === 401 || aUpload.status === 403,
    `status ${aUpload.status} ${aUpload.text.slice(0, 120)}`);

  const aSeesHidden = (await customerA.as("GET", `products?select=id&slug=eq.${PROBE_HIDDEN_SLUG}`)).json ?? [];
  check("customer A cannot see a Hidden Product", aSeesHidden.length === 0, `${aSeesHidden.length} rows`);

  // -- 15. a real admin session, and losing it ------------------------------

  section("15. A real admin session, and what revoking it takes away (#24)");

  probeAdmin = await createProbeUser("admin");
  await svc("POST", "admins", { body: { user_id: probeAdmin.id } });
  check("a throwaway admin can sign in", probeAdmin.ok, probeAdmin.ok ? "" : "no token");

  const adminSeesHidden = (await probeAdmin.as("GET", `products?select=id&slug=eq.${PROBE_HIDDEN_SLUG}`)).json ?? [];
  check("the admin sees the Hidden Product", adminSeesHidden.length === 1, `${adminSeesHidden.length} rows`);

  await probeAdmin.as("PATCH", `products?id=eq.${hiddenId}`, { body: { name: "RLS probe renamed" } });
  const adminRenamed = (await svc("GET", `products?select=name&id=eq.${hiddenId}`)).json?.[0]?.name;
  check("the admin can rename a Product", adminRenamed === "RLS probe renamed", `name is "${adminRenamed}"`);

  const adminOrders = (await probeAdmin.as("GET", "orders?select=id")).json ?? [];
  check("the admin sees every customer's Orders (orders_admin_all)",
    adminOrders.some((o) => o.id === orderA) && adminOrders.some((o) => o.id === orderB),
    `${adminOrders.length} rows`);

  await probeAdmin.as("PATCH", `orders?id=eq.${orderA}`, {
    body: { status: "Shipped", tracking_link: "https://example.com/track/rls-probe" },
  });
  const fulfilled = (await svc("GET", `orders?select=status,tracking_link,total&id=eq.${orderA}`)).json?.[0];
  check("the admin can mark an Order Shipped with a Tracking Link",
    fulfilled?.status === "Shipped" && fulfilled?.tracking_link?.includes("rls-probe"),
    `status ${fulfilled?.status}, tracking ${fulfilled?.tracking_link}`);

  // The grant on orders is column-scoped to (status, tracking_link), so even an
  // admin cannot move money through the fulfilment path. A policy would not stop
  // this; the grant does.
  await probeAdmin.as("PATCH", `orders?id=eq.${orderA}`, { body: { total: 1 } });
  const totalAfter = (await svc("GET", `orders?select=total&id=eq.${orderA}`)).json?.[0]?.total;
  check("not even the admin can change an Order's total (column-scoped grant)",
    Number(totalAfter) === 42, `total is ${totalAfter}`);

  // Revocation, on the SAME token. Admin-ness is a row in a table read on every
  // request, not a claim baked into the JWT -- so removing the row takes effect
  // immediately, without waiting for the token to expire. Nothing checked this
  // before, and it is what makes "remove an admin" actually work.
  await svc("DELETE", `admins?user_id=eq.${probeAdmin.id}`);

  const exAdminHidden = (await probeAdmin.as("GET", `products?select=id&slug=eq.${PROBE_HIDDEN_SLUG}`)).json ?? [];
  check("after removal, the same token no longer sees Hidden Products",
    exAdminHidden.length === 0, `${exAdminHidden.length} rows`);

  await probeAdmin.as("PATCH", `products?id=eq.${hiddenId}`, { body: { name: "ex-admin" } });
  const exAdminName = (await svc("GET", `products?select=name&id=eq.${hiddenId}`)).json?.[0]?.name;
  check("after removal, the same token can no longer write the catalog",
    exAdminName === "RLS probe renamed", `name is "${exAdminName}"`);

  const exAdminOrders = (await probeAdmin.as("GET", "orders?select=id")).json ?? [];
  check("after removal, the same token sees no other customer's Orders",
    !exAdminOrders.some((o) => o.id === orderA || o.id === orderB),
    `${exAdminOrders.length} rows`);
} finally {
  // Not conditional on success. A failed assertion above must still leave the
  // production project exactly as it was found.
  await sweepProbes();
  const leftover = await auth(SERVICE, "GET", "admin/users?per_page=200");
  const remaining = (leftover.json?.users ?? []).filter((u) => (u.email ?? "").startsWith(PROBE_PREFIX));
  check("every throwaway account and Order was cleaned up", remaining.length === 0,
    `${remaining.length} probe account(s) left behind`);
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
