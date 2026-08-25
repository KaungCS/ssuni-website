import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next, widened to any depth so that build
    // output from a dev server started in a subdirectory doesn't get linted.
    "**/.next/**",
    "**/out/**",
    "**/build/**",
    "next-env.d.ts",
    // Cloudflare/OpenNext build output. Generated bundles are not ours to lint,
    // and left unignored they bury the real findings by three orders of magnitude.
    "**/.open-next/**",
    "**/.wrangler/**",
    "cloudflare-env.d.ts",
    // Supabase CLI scratch state.
    "**/supabase/.temp/**",
    "**/supabase/.branches/**",
  ]),
]);

export default eslintConfig;
