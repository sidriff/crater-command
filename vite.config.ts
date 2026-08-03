import { defineConfig } from "vite";

// Vanilla SPA — Three.js + raw HTML/CSS. Bind 0.0.0.0:8080 for live preview.
export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: 8080,
    strictPort: true,
  },
  preview: {
    host: "0.0.0.0",
    port: 8080,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    target: "es2022",
    sourcemap: true,
  },
});
