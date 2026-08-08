import { defineConfig, type Plugin } from "vite";

// Vanilla SPA — Three.js + raw HTML/CSS.
// Prefer 8080; if taken, Vite walks upward (strictPort: false).
//
// Keep file watching + module invalidation so a manual refresh gets fresh
// modules, but drop client HMR / full-reload payloads so the game never
// auto-reloads mid-session.
function noAutoReload(): Plugin {
  const mute = (send: (...args: unknown[]) => void) => {
    return (...args: unknown[]) => {
      const payload = typeof args[0] === "string" ? { type: "custom" as const } : args[0];
      if (
        payload &&
        typeof payload === "object" &&
        "type" in payload &&
        (payload.type === "full-reload" || payload.type === "update")
      ) {
        return;
      }
      return send(...args);
    };
  };

  return {
    name: "no-auto-reload",
    apply: "serve",
    configureServer(server) {
      for (const env of Object.values(server.environments)) {
        env.hot.send = mute(env.hot.send.bind(env.hot)) as typeof env.hot.send;
      }
      server.ws.send = mute(server.ws.send.bind(server.ws)) as typeof server.ws.send;
    },
  };
}

export default defineConfig({
  plugins: [noAutoReload()],
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
