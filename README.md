# Crater Command

Pocket RTS on a hostile globe. Place buildings — armies run themselves. Three-minute matches, blind faction pick, CRT operator chrome.

**Stack:** TypeScript · Vite · Three.js · raw HTML/CSS (no React, no R3F)

## Factions

| Banner | Vibe |
|--------|------|
| **Orbital Operators** | Scrappy belt crews. Thin hulls, first to the crystal. |
| **System Blight** | Rogue mining gear gone feral. Expand, feed, hatch. |
| **Surface Mandate** | Settled-world bureaucracy. Slow steel, deep pockets. |

## Play

1. Boot title → Engage (vs bot)
2. Blind-pick a faction (or random)
3. Drag the globe, zoom, place mines / bays / turrets
4. Hold the core for 3:00 — or crack theirs

```bash
# Bun (preferred)
bun install
bun dev

# or npm
npm install
npm run dev
```

| | Bun | npm |
|---|-----|-----|
| Install | `bun install` | `npm install` |
| Dev (http://localhost:8080) | `bun dev` | `npm run dev` |
| Build | `bun run build` | `npm run build` |
| Preview | `bun run preview` | `npm run preview` |
| Typecheck | `bun run typecheck` | `npm run typecheck` |
