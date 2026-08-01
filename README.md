# Crater Command

High Slop pocket RTS on a hostile globe. Place buildings — armies run themselves. Three-minute matches, blind faction pick, CRT/VHS operator chrome.

## Factions

| Banner | Vibe |
|--------|------|
| **Orbital Operators** | Scrappy belt crews. Thin hulls, first to the crystal. |
| **System Blight** | Rogue mining gear gone feral. Expand, feed, hatch. |
| **Surface Mandate** | Settled-world bureaucracy. Slow steel, deep pockets. |

## Stack

React 19 · TypeScript · Vite · TanStack Start · Three.js / R3F · Tailwind v4

## Dev

```bash
npm install
npm run dev   # 0.0.0.0:8080
```

```bash
npm run build
npm run typecheck
```

## Notes

- Title boot defers Three/`PlanetScene` until after the typewriter (option A load path).
- Advisor loops live under `public/advisor/`.
- Local savepoint tag (when cloned from sandbox): `v0-crt-boot-factions`.

Built in Grok Build / Orbital Slop lineage.
