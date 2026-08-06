import { defineConfig } from "vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(fileURLToPath(import.meta.url));

// Lab shell — modular previews of the real game view (PlanetView + sim).
// Prefer 8090 (alongside game on 8080); if taken, walk upward.
export default defineConfig({
  root: rootDir,
  publicDir: false,
  resolve: {
    alias: {
      "@game": resolve(rootDir, "../src/game"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 8090,
    strictPort: false,
  },
  preview: {
    host: "0.0.0.0",
    port: 8090,
    strictPort: false,
  },

  build: {
    outDir: resolve(rootDir, "dist"),
    emptyOutDir: true,
    target: "es2022",
    sourcemap: true,
  },
});
