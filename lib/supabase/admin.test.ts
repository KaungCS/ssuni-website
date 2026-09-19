import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createAdminClient } from "./admin";

/**
 * The guard, not the client. Constructing a Supabase client is supabase-js's
 * job and is not worth asserting; what this module adds is refusing to hand
 * back a half-configured one silently, and saying which of Cloudflare's two
 * stores the missing value belongs in.
 */

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

it("builds a client when both values are present", () => {
  expect(createAdminClient()).toBeTruthy();
});

it("names the missing variable rather than letting supabase-js throw", () => {
  vi.stubEnv("SUPABASE_SECRET_KEY", "");

  // The failure this replaces is `TypeError: supabaseKey is required`, at
  // request time, on the money path -- which says neither which key nor that
  // Worker secrets and build variables are different stores (CLAUDE.md).
  expect(() => createAdminClient()).toThrow(/SUPABASE_SECRET_KEY is missing/);
  expect(() => createAdminClient()).toThrow(/Worker secret/);
});

it("distinguishes a missing URL from a missing key", () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");

  expect(() => createAdminClient()).toThrow(/NEXT_PUBLIC_SUPABASE_URL is missing/);
});
