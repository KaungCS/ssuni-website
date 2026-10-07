import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Hero Story Server Actions (#77, #78).
 *
 * Same harness as the route suites and lib/admin.test.ts: everything external is
 * mocked, and the pure seams stay real. `lib/admin-hero.ts` is deliberately NOT
 * mocked — what is under test is the writes an action actually issues, and
 * "a reorder leaves the list dense" is a property of `applyHeroOrder` and
 * `reorderIds` together, which a mocked module would assert nothing about.
 *
 * `next/navigation`'s `redirect` throws to unwind the render, and mirroring that
 * is what makes "redirected, and did **not** then fall through to the write" a
 * property this file can assert. Every one of these actions ends in a redirect,
 * so without it every test would pass by accident.
 *
 * #32 scopes required TDD to the logic that can lose money and this is not that.
 * These exist for what #77 names: a refactor that stops calling the admin gate,
 * or stops reporting an error, should fail here rather than in the client's
 * dashboard.
 */

const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});

vi.mock("next/navigation", () => ({ redirect, notFound: () => {
  throw new Error("NOT_FOUND");
} }));

const requireAdmin = vi.fn();
vi.mock("@/lib/admin", () => ({ requireAdmin }));

// ---------------------------------------------------------------------------
// A Supabase stand-in that records what was written.
// ---------------------------------------------------------------------------

type Row = {
  id: string;
  eyebrow: string | null;
  title: string;
  subtitle: string | null;
  image_url: string;
  cta_label: string | null;
  cta_href: string | null;
  is_hidden: boolean;
  sort_order: number;
};

type Write = { op: "insert" | "update" | "delete"; id: string | null; payload: unknown };

let rows: Row[] = [];
let writes: Write[] = [];
/** Set to make the next write come back refused, the way Postgres would. */
let writeError: string | null = null;

function story(id: string, overrides: Partial<Row> = {}): Row {
  return {
    id,
    eyebrow: null,
    title: `Story ${id}`,
    subtitle: null,
    image_url: `https://example.test/${id}.jpg`,
    cta_label: null,
    cta_href: null,
    is_hidden: false,
    sort_order: 0,
    ...overrides,
  };
}

function builder() {
  const state: { op: Write["op"] | "select"; id: string | null; payload: unknown } = {
    op: "select",
    id: null,
    payload: null,
  };

  const settle = () => {
    if (state.op === "select") {
      return state.id === null
        ? { data: rows, error: null }
        : { data: rows.find((r) => r.id === state.id) ?? null, error: null };
    }

    if (writeError) return { data: null, error: { message: writeError } };

    writes.push({ op: state.op, id: state.id, payload: state.payload });
    return state.op === "insert" ? { data: { id: "created-id" }, error: null } : { error: null };
  };

  const b = {
    select: () => b,
    order: () => b,
    eq: (_column: string, value: string) => {
      state.id = value;
      return b;
    },
    maybeSingle: () => Promise.resolve(settle()),
    insert: (payload: unknown) => {
      state.op = "insert";
      state.payload = payload;
      return b;
    },
    update: (payload: unknown) => {
      state.op = "update";
      state.payload = payload;
      return b;
    },
    delete: () => {
      state.op = "delete";
      return b;
    },
    // Awaiting the builder is how supabase-js finishes a query with no
    // .maybeSingle() on the end -- every .update().eq() in lib/admin-hero.ts.
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(settle()).then(resolve, reject),
  };

  return b;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: () => builder() }),
}));

const {
  createHeroStoryAction,
  deleteHeroStoryAction,
  reorderHeroStoryAction,
  setHeroImageAction,
  updateHeroStoryAction,
} = await import("./actions");

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ id: "admin-uuid" });
  rows = [];
  writes = [];
  writeError = null;
});

describe("the admin gate", () => {
  it("refuses a non-admin before any write", async () => {
    // A Server Action is a POST endpoint anyone can hit, and the layout that
    // rendered the form is not in its request path.
    requireAdmin.mockRejectedValue(new Error("NOT_FOUND"));

    await expect(createHeroStoryAction(form({ title: "Sneaky" }))).rejects.toThrow("NOT_FOUND");
    await expect(
      reorderHeroStoryAction(form({ storyId: "a", position: "1" })),
    ).rejects.toThrow("NOT_FOUND");

    expect(writes).toEqual([]);
  });
});

describe("createHeroStoryAction", () => {
  it("refuses a blank title without writing", async () => {
    await expect(createHeroStoryAction(form({ title: "   " }))).rejects.toThrow(
      "REDIRECT:/admin/hero?error=A%20Hero%20Story%20needs%20a%20title.",
    );
    expect(writes).toEqual([]);
  });

  it("creates it Hidden, with no image, last in the order, and opens the editor", async () => {
    rows = [story("a", { sort_order: 0 }), story("b", { sort_order: 1 })];

    await expect(createHeroStoryAction(form({ title: "Hi U District" }))).rejects.toThrow(
      "REDIRECT:/admin/hero/created-id?saved=1",
    );

    expect(writes).toEqual([
      {
        op: "insert",
        id: null,
        payload: {
          title: "Hi U District",
          // The `not null` column's way of saying "no picture yet". Hidden is
          // what makes it safe: lib/hero.ts never serves a Hidden Story, so an
          // empty src cannot reach next/image on the landing page.
          image_url: "",
          is_hidden: true,
          sort_order: 2,
        },
      },
    ]);
  });

  it("turns a refused insert into a readable message", async () => {
    writeError = "new row violates row-level security policy for table hero_stories";

    await expect(createHeroStoryAction(form({ title: "Hi" }))).rejects.toThrow(
      /REDIRECT:\/admin\/hero\?error=The%20database%20refused/,
    );
  });
});

describe("updateHeroStoryAction", () => {
  beforeEach(() => {
    rows = [story("a")];
  });

  it("refuses a blank title without writing", async () => {
    await expect(
      updateHeroStoryAction(form({ storyId: "a", title: "" })),
    ).rejects.toThrow("REDIRECT:/admin/hero/a?error=A%20Hero%20Story%20needs%20a%20title.");
    expect(writes).toEqual([]);
  });

  it("saves every field, turning blanks into nulls", async () => {
    await expect(
      updateHeroStoryAction(
        form({
          storyId: "a",
          title: "Hi U District",
          eyebrow: "Fall 2026",
          subtitle: "  ",
          ctaLabel: "Explore",
          ctaHref: "/catalog",
          isHidden: "on",
        }),
      ),
    ).rejects.toThrow("REDIRECT:/admin/hero/a?saved=1");

    expect(writes).toEqual([
      {
        op: "update",
        id: "a",
        payload: {
          eyebrow: "Fall 2026",
          title: "Hi U District",
          // Blank means null, not "". The storefront treats "" as absent, but a
          // row of empty strings cannot be told from one filled in with nothing.
          subtitle: null,
          cta_label: "Explore",
          cta_href: "/catalog",
          is_hidden: true,
        },
      },
    ]);
  });

  it("saves a half-filled call to action rather than refusing it", async () => {
    // The page warns under the pair. An editor that will not save cannot hold a
    // half-drafted row, and components/HeroStory.tsx degrades to no button.
    await expect(
      updateHeroStoryAction(form({ storyId: "a", title: "Hi", ctaLabel: "Explore" })),
    ).rejects.toThrow("REDIRECT:/admin/hero/a?saved=1");

    expect(writes).toHaveLength(1);
    expect(writes[0].payload).toMatchObject({ cta_label: "Explore", cta_href: null });
  });

  it("refuses to show a Story that has no picture, and writes nothing", async () => {
    // The one refusal in the editor: next/image throws on src="", and the first
    // Story owns the landing page's <h1>.
    rows = [story("a", { image_url: "", is_hidden: true })];

    await expect(
      updateHeroStoryAction(form({ storyId: "a", title: "Hi" })),
    ).rejects.toThrow(/REDIRECT:\/admin\/hero\/a\?error=This%20Hero%20Story%20has%20no%20image/);

    expect(writes).toEqual([]);
  });

  it("still saves an image-less Story while it stays Hidden", async () => {
    rows = [story("a", { image_url: "", is_hidden: true })];

    await expect(
      updateHeroStoryAction(form({ storyId: "a", title: "Draft", isHidden: "on" })),
    ).rejects.toThrow("REDIRECT:/admin/hero/a?saved=1");

    expect(writes).toHaveLength(1);
  });

  it("reports a Story that has been deleted underneath the form", async () => {
    await expect(
      updateHeroStoryAction(form({ storyId: "gone", title: "Hi" })),
    ).rejects.toThrow(/REDIRECT:\/admin\/hero\?error=That%20Hero%20Story%20no%20longer%20exists/);
    expect(writes).toEqual([]);
  });

  it("turns a refused update into a readable message", async () => {
    writeError = "new row violates row-level security policy for table hero_stories";

    await expect(
      updateHeroStoryAction(form({ storyId: "a", title: "Hi" })),
    ).rejects.toThrow(/REDIRECT:\/admin\/hero\/a\?error=The%20database%20refused/);
  });
});

describe("setHeroImageAction", () => {
  beforeEach(() => {
    rows = [story("a", { image_url: "" })];
  });

  it("refuses an upload that produced no URL", async () => {
    await expect(setHeroImageAction(form({ storyId: "a", url: "  " }))).rejects.toThrow(
      /REDIRECT:\/admin\/hero\/a\?error=That%20upload%20produced%20no%20URL/,
    );
    expect(writes).toEqual([]);
  });

  it("records the URL the browser uploaded", async () => {
    await expect(
      setHeroImageAction(form({ storyId: "a", url: "https://x.supabase.co/hero/a/1-p.jpg" })),
    ).rejects.toThrow("REDIRECT:/admin/hero/a?saved=1");

    expect(writes).toEqual([
      { op: "update", id: "a", payload: { image_url: "https://x.supabase.co/hero/a/1-p.jpg" } },
    ]);
  });
});

describe("deleteHeroStoryAction", () => {
  it("deletes the row and returns to the list", async () => {
    rows = [story("a")];

    await expect(deleteHeroStoryAction(form({ storyId: "a" }))).rejects.toThrow(
      "REDIRECT:/admin/hero?deleted=1",
    );

    expect(writes).toEqual([{ op: "delete", id: "a", payload: null }]);
  });
});

describe("reorderHeroStoryAction", () => {
  beforeEach(() => {
    rows = [
      story("a", { sort_order: 0 }),
      story("b", { sort_order: 1 }),
      story("c", { sort_order: 2 }),
      story("d", { sort_order: 3 }),
    ];
  });

  /** The number each id ends up holding, from the writes plus whatever was untouched. */
  function finalOrder(): string[] {
    const numbers = new Map(rows.map((r) => [r.id, r.sort_order]));
    for (const w of writes) {
      numbers.set(w.id as string, (w.payload as { sort_order: number }).sort_order);
    }
    return [...numbers.entries()].sort((x, y) => x[1] - y[1]).map(([id]) => id);
  }

  it("moves a Story to the front and leaves the numbers dense", async () => {
    // Position is 1-based where the client types it; sort_order stays 0-based.
    await expect(
      reorderHeroStoryAction(form({ storyId: "c", position: "1" })),
    ).rejects.toThrow("REDIRECT:/admin/hero?saved=1");

    expect(finalOrder()).toEqual(["c", "a", "b", "d"]);

    const numbers = writes.map((w) => (w.payload as { sort_order: number }).sort_order);
    expect(numbers).toEqual([...new Set(numbers)]);
  });

  it("moves a Story to the end when the position is past it", async () => {
    await expect(
      reorderHeroStoryAction(form({ storyId: "a", position: "99" })),
    ).rejects.toThrow("REDIRECT:/admin/hero?saved=1");

    expect(finalOrder()).toEqual(["b", "c", "d", "a"]);
  });

  it("writes only the rows whose number actually changes", async () => {
    await expect(
      reorderHeroStoryAction(form({ storyId: "c", position: "2" })),
    ).rejects.toThrow("REDIRECT:/admin/hero?saved=1");

    // a keeps 0; b and c swap. Touching d as well would be three round trips
    // for two moves.
    expect(writes.map((w) => w.id).sort()).toEqual(["b", "c"]);
    expect(finalOrder()).toEqual(["a", "c", "b", "d"]);
  });

  it("renumbers a list the client left sparse in Supabase Studio", async () => {
    // "Already at the right index" and "already holding the right number" are
    // different questions once someone has typed 10, 20, 30 into the column.
    rows = [
      story("a", { sort_order: 10 }),
      story("b", { sort_order: 20 }),
      story("c", { sort_order: 30 }),
    ];

    await expect(
      reorderHeroStoryAction(form({ storyId: "a", position: "1" })),
    ).rejects.toThrow("REDIRECT:/admin/hero?saved=1");

    // Nothing moved, but every number was wrong, so every row is rewritten.
    expect(writes.map((w) => [w.id, (w.payload as { sort_order: number }).sort_order])).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 2],
    ]);
  });

  it("does nothing for a Story that is no longer in the list", async () => {
    await expect(
      reorderHeroStoryAction(form({ storyId: "gone", position: "1" })),
    ).rejects.toThrow("REDIRECT:/admin/hero?saved=1");

    // The numbers already being dense is what makes this zero writes rather
    // than four no-op ones.
    expect(writes).toEqual([]);
  });

  it("refuses a position that is not a whole number", async () => {
    await expect(
      reorderHeroStoryAction(form({ storyId: "a", position: "first" })),
    ).rejects.toThrow(/REDIRECT:\/admin\/hero\?error=Position%20must%20be/);
    expect(writes).toEqual([]);
  });

  it("turns a refused renumber into a readable message", async () => {
    writeError = "new row violates row-level security policy for table hero_stories";

    await expect(
      reorderHeroStoryAction(form({ storyId: "c", position: "1" })),
    ).rejects.toThrow(/REDIRECT:\/admin\/hero\?error=The%20database%20refused/);
  });
});
