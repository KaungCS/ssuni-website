import type { NextConfig } from "next";

/**
 * Empty, and it still has to exist. Next itself is happy without this file, so
 * deleting it passes `npm run dev` and `npm run build` -- but
 * `opennextjs-cloudflare build` looks the file up directly and exits 1 with
 * "next.config.js not found. Please make sure you are running this command
 * inside a Next.js app", which takes the deploy with it. Verified 2026-09-18.
 */
const nextConfig: NextConfig = {};

export default nextConfig;
