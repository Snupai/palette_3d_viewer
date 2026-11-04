/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";

/** @type {import("next").NextConfig} */
const config = {
  // Self-contained server bundle in `.next/standalone` for the container
  // image (`Dockerfile`, issue #49). `next start` keeps working locally.
  output: "standalone",
};

export default config;
