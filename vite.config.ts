import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [cloudflare()],
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    // Set by Cloudflare Workers Builds; empty for local builds.
    __BUILD_COMMIT__: JSON.stringify((process.env.WORKERS_CI_COMMIT_SHA ?? "").slice(0, 7)),
  },
});
