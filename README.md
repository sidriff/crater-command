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
| Dev (prefers :8080) | `bun dev` | `npm run dev` |
| Build | `bun run build` | `npm run build` |
| Preview (prefers :8080) | `bun run preview` | `npm run preview` |
| Typecheck | `bun run typecheck` | `npm run typecheck` |
| Labs (prefers :8090) | `bun run lab` | `npm run lab` |

Dev / lab / preview prefer those ports; if busy, Vite picks the next free one and prints the URL.

## Labs

Modular previews of **real** game chrome — not alternate art.

```bash
npm run lab   # prefers http://localhost:8090
```

| Lab | What |
|-----|------|
| **Readability** | Blank globe + scenario boards (identity grid, contact, FOW edge, clutter). Scorecard / PNG / JSON for visual passes. |
| **Mesh** | Isolate one unit/building solid (`planetMath` geos) with CRT hull + wire. Orbit, tint, edge crease, screenshot. |

### Deep links (Mesh)

Models / scripts can open a mesh without clicking the picker:

```
http://localhost:8090/?lab=mesh&mesh=u:scout
http://localhost:8090/?mesh=scout          # bare slug; implies mesh lab
```

`mesh` accepts exact id (`u:scout`), bare slug (`scout`), or unique label substring.

Console / agent API:

```js
ccLabs.listMeshes()           // [{ id, label, section }, …]
ccLabs.openMesh("u:scout")    // true if resolved
ccLabs.openMesh("drone")      // fuzzy label ok if unique
ccLabs.mesh()                 // current id
ccLabs.openLab("mesh")
```

Shell + labs live under `labs/`. Game code is imported via `@game/*`.
