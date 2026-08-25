# Hero Stories use fixed, manually-curated Slots, not a rotating carousel

The landing page will host many Hero Stories over time, some advertising a specific collection or category rather than always the newest drop — a few are meant to stay featured indefinitely regardless of age. We chose a UNIQLO-style layout of a fixed number of simultaneous Hero Slots (one primary banner plus a few secondary tiles), each holding one Hero Story the client manually assigns and swaps via the Admin Dashboard, instead of an auto-rotating carousel ordered by recency. Timed rotation was considered and rejected: a shopper interested in a story is expected to click through immediately rather than wait for it to cycle back into view.

## Consequences

Revisiting timed rotation later is still possible without restructuring the Slot/Story data model — it would only add an optional per-Story display duration, not change how Slots are assigned.
