import { defineConfig } from "vite";

// Vanilla SPA — Three.js + raw HTML/CSS.
// Prefer 8080; if taken, Vite walks upward (strictPort: false).
export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: 8080,
    strictPort: false,
  },
  preview: {
    host: "0.0.0.0",
    port: 8080,
    strictPort: false,
  },
  build: {
    outDir: "dist",
    target: "es2022",
    sourcemap: true,
  },
});
