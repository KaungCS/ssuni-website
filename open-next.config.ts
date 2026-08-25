import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Caching is left at the adapter defaults for now. Incremental cache (KV/R2) and
// tag revalidation become relevant once the catalog reads from Supabase — see
// docs/roadmap-september.md, week 2.
export default defineCloudflareConfig();
