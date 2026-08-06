# Crater Command — Faction Lore

Crater Command shares its universe with **[asterops](../asterops)** (*Orbital Slop: Online*) — same belt, same timeline, same "Operator" archetype. Asterops' `LORE.md`/`STYLE.md` are the canonical deep lore; this file pulls the parts relevant to Crater Command's three-faction pocket RTS and should stay in sync with them.

See also: [`src/game/sim/defs.ts`](src/game/sim/defs.ts) (`RACES`) for the mechanical expression of each faction.

## Design rule: asymmetric factions

**The three races do not share a common unit/building kit.** Each faction has its own producers and products (Ops Airpad → Interceptor, Bomber Works → Bomber; other races get their own air lines). Prefer faction-owned `BuildingKind` / `UnitKind` names over race overrides on shared kinds. Shared kinds and `unitProducedBy` race branches are transitional debt, not the target model.

## Orbital Operators (`operators` / "Ops")

**Anti-automation space libertarians.** In the shared universe's *Operator Doctrine* (asterops `LORE.md`, 2110), the founding belief is that fully autonomous machinery is inherently dangerous — "the drone, left alone, will eventually try to kill someone... this is not a malfunction, this is the nature of unsupervised optimization." Automation pays the dividend; the Operator pays the bill. Ops are the belters who took that seriously and never handed the keys over.

- **Vibe:** fast cars and freedom. No bureaucracy, no hive-mind, no patron. Scrappy, individualist belt crews who move fast and grab the crystal before "the paper-pushers" (Mandate) dig in.
- **Identity:** they're drone pilots by trade — teleoperators, not soldiers (asterops `STYLE.md`, §"Humanity — the operator side"). Everything they field is remote-piloted. This is why their roster should skew toward the fastest ground vehicles and the strongest air power in the game — piloting drones is their whole competency, not a side tech.
- **Econ:** light, cheap, disposable hulls over deep investment — `depot` + `refinery` + `dome` instead of the classic `extractor`, cost multiplier 0.92×. Worker is a piloted rover (`workerOps` + `workerOpsTurret`), not a biped — reinforces "everything is a drone here."
- **Visual/style hooks** (from asterops `STYLE.md`): phosphor-green wire (`#2dff8c` in this repo; asterops uses `0x00ffaa`), hollow see-through frames, deliberate NASA-CAD-legible angularity, bilateral symmetry, **no eyes** — Operators signal capability, not alertness. Forward-facing features read as sensors/emitters, never weapons.

**Open item:** current `raceUnitMul` in `defs.ts` gives the air-unit speed/damage bonus to **Blight** (`flyer`/`scout` × 1.1/1.08), not Ops. That's inconsistent with "strongest air power" as an Ops identity trait — flagged for a future balance pass, not changed here.

## System Blight (`blight`)

Rogue mining automation gone feral — the thing the Operator Doctrine warned about. Self-replicating, indifferent rather than malicious, spreads/feeds/hatches. (Full lore: asterops `LORE.md` §"The Blight.") Not part of this pass; noted for cross-reference.

## Surface Mandate (`mandate`)

Settled-world bureaucracy — slow steel, deep pockets, "erase unauthorized operations." The inner-system institutional counterweight to both Ops individualism and Blight indifference. Not part of this pass; noted for cross-reference.
