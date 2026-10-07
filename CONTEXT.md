# SSUNI Storefront

SSUNI is a clothing storefront selling apparel and accessories directly to customers, currently being built toward a real launch.

## Language

**Product**:
An item for sale, described by name, price, and description, sold as one or more Variants.
_Avoid_: Item

**Variant**:
A specific purchasable combination of a Product's color and size, carrying its own stock count.
_Avoid_: SKU, option

**Reservation**:
A temporary hold placed on a Variant's stock when a shopper begins checkout, so two shoppers cannot buy the same last unit. It expires if payment doesn't complete, and is consumed into an actual stock decrement when it does. Distinct from the decrement itself, which happens only on payment. It also records the price its line was quoted to Stripe at, so the Order Item it becomes is priced as the shopper was charged rather than as the Product is priced when the webhook lands — which can be days later, on a retry.
_Avoid_: lock, allocation, backorder

**Available Stock**:
A Variant's stock count minus its unexpired Reservations — what a shopper can actually buy right now, and what the storefront displays. Distinct from stock, which is the physical count on the shelf.

**Cart**:
The Cart Items a shopper intends to buy. Held locally in the browser, not tied to an account; login is only required at checkout.
_Avoid_: Bag, basket

**Cart Item**:
A Variant plus a quantity, as one line of a Cart. Holds a reference to the Variant, never a copy of its price or stock — those are read live, so what the Cart displays and what Stripe charges cannot drift apart. Parallels an Order Item, which is the same idea after payment.
_Avoid_: line item, cart line

**Taxonomy Term**:
One entry on a declared list the client maintains — a Department, a Category, or a Collection — carrying the name shoppers see. A Product picks Terms from these lists and can never mint a new one; a Term can only be retired by reassigning the Products that hold it.
_Avoid_: tag, label, facet

**Department**:
The broadest taxonomy dimension a Product can be filtered by (e.g. Women, Men, Unisex). A Product sits in at most one. Distinct from Category and Collection.

**Category**:
The clothing-type taxonomy dimension a Product can be filtered by (e.g. Hoodies & Sweats, Knitwear). A Product sits in at most one. Distinct from Department and Collection.

**Collection**:
A named, curated grouping of Products the client assembles by hand — a time-boxed drop ("The Rabbit Hole"), a seasonal edit ("Fall Lookbook"), or a merchandising shelf ("Best Sellers"). Membership is always chosen, never computed from sales or recency, and a Product can belong to several at once. Distinct from Department and Category.

**Tag**:
A planned future taxonomy dimension for finer-grained, cross-cutting labeling of Products, not yet implemented.

**Admin Dashboard**:
A planned web UI on the deployed site letting the non-technical client manage Products (add/remove/hide), Hero Stories (add/remove/hide), and Orders directly, without an IDE or git.
_Avoid_: CMS, back office

**Hero Story**:
A full-bleed promotional panel on the storefront landing page. The landing page renders every visible Hero Story, stacked vertically in an order the client sets — there is no fixed number of them, and adding one is how a section is added to the home page. Each is independently Hidden or not. Nothing auto-rotates; order is explicit and manual, never derived from recency.

_Was_: Hero Slot — a fixed position (one primary banner plus a few secondary tiles, à la UNIQLO) that a Hero Story was assigned into. Retired 2026-09-18 with the amendment to ADR 0003, before any code used it: the landing page has no fixed hero real estate, so there was nothing for Stories to compete for.

**Hidden**:
A Product or Hero Story's state when temporarily excluded from customer-facing pages without deleting the record. Distinct from removal, which deletes it outright.

The two differ in what an *admin* sees, deliberately. A Hidden Product is still served to an admin browsing the catalog, marked as Hidden — a preview of what shoppers cannot see. A Hidden Hero Story is not shown on the landing page at all, to anyone, and appears only in the Admin Dashboard: a full-bleed panel is too large to be a preview, and the first Story on the page carries its heading. See the 2026-09-22 amendment to ADR 0003.

**Archive**:
The set of Hidden Products and Hero Stories a client can browse in the Admin Dashboard — a draft/no-longer-relevant holding area, kept indefinitely until the client explicitly removes an entry.

**Order**:
A completed Stripe purchase, recorded in Supabase for the client to track and fulfill. Distinct from a Cart, which is pre-purchase intent. Has a Status.

**Order Status**:
The current stage of an Order: `Paid` (set automatically when Stripe confirms payment), `Shipped` (set manually by the client, carries a Tracking Link), optionally `Delivered`, or a manual `Cancelled`/`Refunded` override.

**Tracking Link**:
A URL to the shipping carrier's own tracking page for a specific Order, entered by the client when marking an Order `Shipped` and shown to the customer on their Profile page.

**Profile**:
A customer-facing page where a logged-in shopper views their own Order history and status. Distinct from the Admin Dashboard, which manages all Products and Orders across every customer.

**Review**:
A planned future feature letting customers rate/comment on a Product, not yet implemented.

**Reward**:
A planned future loyalty/incentive feature for repeat customers, not yet implemented.
