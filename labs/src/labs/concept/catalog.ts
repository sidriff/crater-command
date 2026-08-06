/**
 * Operators concept roster — one art slot per unit / building.
 * Image files live in ./assets/operators/<id>.jpg (wired via import.meta.glob).
 *
 * Tech tiers mirror the Operators deck inject chain in src/game/sim/deck.ts.
 */

export type ConceptKind = "unit" | "building";
/** Deck tech rung: T0 openers → T1 Command → T2 doctrines → T3 apex. */
export type TechTier = 0 | 1 | 2 | 3;
/** T2/T3 branch (command fans into three doctrines). */
export type TechBranch = "eco" | "def" | "aggro" | "core" | "shared";

export type ConceptDef = {
  id: string;
  label: string;
  kind: ConceptKind;
  tech: TechTier;
  branch: TechBranch;
  /**
   * `active` (default) ships in the Operators deck/gallery tiers.
   * `unused` keeps the plate for comparison but parks it under Unused.
   */
  status?: "active" | "unused";
  /** Deck / sim name hook */
  sim?: string;
  /** One-line card blurb */
  blurb: string;
  /** Longer mechanical description for the detail panel */
  detail: string;
  /** Energy cost when played as a card (if any) */
  cost?: number;
  /** What it trains / produces (building → unit label) */
  produces?: string;
  /**
   * Unit only: concept ids of buildings that train this unit.
   * Empty / omitted = not produced in Operators deck.
   */
  trainedAt?: readonly string[];
  /** Building prereq to play */
  prereq?: string;
  /** Short prompt subject used when regenerating art */
  subject: string;
  /** Standing art-direction review of the generated plate (see `ConceptReview`). */
  review?: ConceptReview;
};

export function isActiveConcept(c: ConceptDef): boolean {
  return c.status !== "unused";
}

/**
 * Agent art-direction pass on a generated plate. Lives in the catalog rather
 * than localStorage so it survives a cache clear, diffs in review, and can be
 * read in the editor next to the thing it's about.
 *
 * Separate from the in-lab per-card verdict, which stays the human's channel —
 * these two never overwrite each other.
 */
export type ConceptReview = {
  verdict: ConceptVerdict;
  /** Worth keeping — what the plate already earns. */
  keeps: string;
  /** Changes, most important first. */
  fixes: readonly string[];
  /** How the plate diverges from the shipped mesh, if it does. */
  mesh?: string;
};

/** keep = ship it · revise = right idea, wrong execution · reject = regenerate. */
export type ConceptVerdict = "keep" | "revise" | "reject";

/**
 * Shared style block for image regen prompts.
 * Match in-game chrome: simple phosphor wire on black, occluded internals
 * (see assets/operators/_wire_ref.png — flyer reference).
 */
export const OPERATORS_STYLE = [
  "Simple low-poly wireframe game art matching an existing RTS wireframe style.",
  "Pure black void background only — no ground, stars, fog, or studio.",
  "Black solid faces that fully occlude internals; only exterior edges drawn as thin phosphor green (#2dff8c) wireframe lines.",
  "Exception: Habitat Dome keeps a see-through geodesic lattice — the card sells fragile glass, so that plate must not occlude.",
  "No textures, no PBR materials, no complex panel greeble, no glow bloom, no labels.",
  "Angular NASA-CAD silhouette, bilateral symmetry, readable at icon scale.",
  "Vacuum architecture: no Earth atmosphere tells (tails for airflow, canopies, pitched roofs, handrails, slack cable hoists).",
  "Three-quarter view floating in black. Same simplicity as a green CAD wireframe preview.",
  // Co-gen rule (see concept/v1.md): unit plates should match the product
  // already staged on their producer building plate — extract, don't reinvent.
].join(" ");

export const TECH_LABELS: Record<TechTier, string> = {
  0: "T0 · Openers",
  1: "T1 · Command",
  2: "T2 · Doctrines",
  3: "T3 · Apex",
};

export const BRANCH_LABELS: Record<TechBranch, string> = {
  core: "Core",
  eco: "Eco",
  def: "Defense",
  aggro: "Aggro",
  shared: "Shared",
};

export const OPERATORS_CONCEPTS: readonly ConceptDef[] = [
  // ── T0 units ───────────────────────────────────────────
  {
    id: "rover",
    label: "Worker Rover",
    kind: "unit",
    tech: 0,
    branch: "eco",
    sim: "worker",
    blurb: "Mine crystals · drop at Core / Refinery.",
    detail:
      "Operators worker is a piloted rover (not a biped). Harvests crystals on a laser channel, hauls energy to Core or Refinery. Fast cruise (race mul). Trained from Worker Depots only — Core does not auto-train. Cheap disposable hull; economy spine of the faction.",
    trainedAt: ["depot"],
    subject:
      "Open-bed mining rover: solid tub chassis, side rails (not full lattice), four wheels, tall mast with box sensor head, thin aft antenna — under 12 forms at mesh, denser on the plate",
    review: {
      verdict: "keep",
      keeps:
        "Pinned to iter 38 (open-truss character plate). Mesh is a reduced read of the same silhouette. Human promoted keep.",
      fixes: [
        "Human: too busy — simplify pass still wanted (plate denser than match: rocker arms, full truss). Mesh deliberately drops lattice for orbit.",
      ],
      mesh: "workerOps: solid tub + side rails + fixed mast + 4 wheels + aft antenna; separate box head yaws at ROVER_TURRET_PIVOT. No ico dome, no full lattice.",
    },
  },
  {
    id: "scout",
    label: "Recon Drone",
    kind: "unit",
    tech: 0,
    branch: "shared",
    sim: "scout",
    blurb: "Air scout · huge vision · no weapons.",
    detail:
      "Vacuum recon drone from Scout Works. Highest vision in the kit (~7.5); air unit, zero damage. Role is pure FOW and early map read. RCS thrusters only — no rotors. Later T1 Recon op can task a light unit to a mark; this unit is the early eyes.",
    trainedAt: ["scout_works"],
    subject:
      "Notched-delta recon drone: the delta is a downward-looking sensor aperture, not a wing. Twin thruster bells hang in the trailing-edge notch, canted twin fins, flush hex aperture in the nose housing, no eye, no rotors, no landing gear",
    review: {
      verdict: "keep",
      keeps:
        "Regen pass: notched delta plate, hex aperture, twin bells in the notch, canted twin fins, no vertical tail, faces occlude. Closest to makeScoutGeo yet. Human promoted keep.",
      fixes: [
        "Optional: still a thick body rather than a thin aperture plate — flatten toward the mesh if a polish pass lands.",
      ],
      mesh: "makeScoutGeo: notched delta aperture plate, dorsal spine chine, flush hex aperture, canted twin fins, twin bells in the notch.",
    },
  },

  // ── T0 buildings ───────────────────────────────────────
  {
    id: "core",
    label: "Core Station",
    kind: "building",
    tech: 0,
    branch: "core",
    sim: "core",
    blurb: "HQ · mineral drop-off · +5 capacity · not placeable.",
    detail:
      "Match start building. Grants free capacity (CORE_CAP), accepts mineral drop-offs, and anchors the claim. Operators Core does not train workers — Depots do. If it dies, you lose. Visual: ring-station silhouette unique to Operators.",
    subject:
      "Tall Operators core station, distinctly taller than wide (about 1.7:1): narrow open hexagonal scaffold base on short legs no wider than ~half the ring, a slender open lattice truss tower rising well clear of it, a large horizontal ring with radial spars and docking-node modules carried high on the tower with obvious empty daylight underneath, compact sensor crown with flush apertures on top",
    review: {
      verdict: "revise",
      keeps:
        "Regen pass (iter 62): tall tower silhouette, open lattice hex base on legs, lattice truss mast, ring high with daylight underneath, segmented ring with docking nodes and radial spars, occlusion clean. Hits the mesh-proportion brief the squat plate missed.",
      fixes: [
        "Human: re-score after regen.",
        "Soft: base still a bit wide vs ideal ~40% of ring diameter — narrow further if icon-scale reads heavy.",
        "Soft: crown still has a mild cylindrical aperture on one face — prefer fully flush hex only (no eyes).",
      ],
      mesh:
        "Mesh has caught up (62 parts, 778 edge segments, bbox x/z ±1.49 y 0–3.60). coreStation is now: open square scaffold frame on four tapered legs with diagonal bracing (Ops building family) → hex socket → two-stage triangular lattice truss mast, stepped at the ring → torus rail carrying eight joint flanges, four outboard docking nodes with flush hex apertures, four tapered radial spars and two near-flat high-gain arrays → sensor crown with a flat forward panel, lateral hex apertures and a flush emitter pad at y 3.60. Ring diameter, ring height (y 2.0) and the 1.54 of daylight under it are unchanged. Remaining plate-vs-mesh deltas: the plate's mast is square-plan and ~10 bays (mesh is triangular and 3 bays — hash at match zoom), and the plate's base is octagonal (mesh is square, to join the scaffold family).",
    },
  },
  {
    id: "depot",
    label: "Worker Depot",
    kind: "building",
    tech: 0,
    branch: "eco",
    sim: "depot",
    cost: 100,
    produces: "Worker Rover",
    blurb: "Trains rovers when you have free capacity.",
    detail:
      "T0 eco card. Worker production hub: trains one rover at a time while free capacity allows. Garage-bay silhouette. Logistics Hub (T2 eco) injects extra Depot copies into discard for convoy scaling.",
    subject:
      "Square scaffold deck: enclosed garage bay at the back, open apron at the front with guide rails running out of the bay, a mining rover parked nose-out on the apron, service stack and dispatch mast",
    review: {
      verdict: "keep",
      keeps:
        "Regen pass: garage mouth, rover on the apron, faces occlude. Product-on-plate rule hit. Human promoted keep.",
      fixes: [
        "Optional: still denser than the shipped scaffold — simplify toward bay + apron + guide rails only if a polish pass lands.",
      ],
      mesh: "Bay walls + rear wall + lipped roof at -Z, apron and guide rails at +Z, rover staged on the apron by production progress.",
    },
  },
  {
    id: "scout_works",
    label: "Scout Works",
    kind: "building",
    tech: 0,
    branch: "shared",
    sim: "scout",
    cost: 100,
    produces: "Recon Drone",
    blurb: "Launches recon drones · lights fog of war.",
    detail:
      "T0 opener. Builds Recon Drones (air, vision-heavy, unarmed). Only round footprint in the Operators kit — iris pad + launch rail so it never confuses with square scaffolds top-down.",
    subject:
      "Circular apron with a low hangar bay at the back and an inclined cantilever launch rail running out over the front lip, a recon drone parked on the rail cradle nose-up, canted pilot booth, telemetry mast with uplink dish — only round footprint in the kit",
    review: {
      verdict: "keep",
      keeps:
        "Regen pass: round apron, hangar, cantilever rail with A-strut, drone on the rail — product-on-plate hit. Round footprint still disambiguates the kit. Human promoted keep.",
      fixes: [
        "Optional: parked craft still leans fighter-jet — align product with makeScoutGeo if a polish pass lands.",
      ],
      mesh: "scoutPadStaged in the Mesh lab is the reference. Everything else on the pad is deliberately low so the drone is the tallest thing on it.",
    },
  },
  {
    id: "dome",
    label: "Habitat Dome",
    kind: "building",
    tech: 0,
    branch: "eco",
    sim: "dome",
    cost: 200,
    blurb: "+3 capacity · fragile glass · expensive soft spot.",
    detail:
      "T0 supply. Only +3 capacity (DOME_CAP) for high cost and low HP — orbital glass house. Main Operators soft spot: cheap to snipe, painful to lose when army is cap-starved. Logistics can re-inject Domes later.",
    subject:
      "Fragile geodesic glass habitat dome on a low scaffold ring, transparent lattice shell, thin structural ribs",
    review: {
      verdict: "keep",
      keeps:
        "Matches the shipped ico dome, and the geodesic triangulation is doing real work — it's the only curved-lattice surface in the kit, so it reads as glass rather than armour.",
      fixes: [
        "This is the one plate that should deliberately break the occlusion rule. The card sells it as a fragile glass house and the main Operators soft spot; opaque faces hide the fragility that justifies the cost. Let this shell stay see-through and make that an explicit exception in OPERATORS_STYLE rather than an accident.",
        "Scaffold ring below is finer than the rest of the kit's structure — thicken to match the depot's frame gauge.",
      ],
      mesh: "Matches domeShell.",
    },
  },

  // ── T1 ─────────────────────────────────────────────────
  {
    id: "command",
    label: "Command Center",
    kind: "building",
    tech: 1,
    branch: "core",
    sim: "command",
    cost: 250,
    blurb: "TECH T1 · unlocks combat, Refinery, T2 doctrines.",
    detail:
      "Tech gateway. On finish injects Turret, Raider Bay, Refinery, Recon op, and all three T2 doctrine techs (Logistics / EM Array / Strike Dock) into discard. Play this to leave pure eco openers and open combat + branching.",
    subject:
      "Angular command center on a square scaffold: low bunker body, central sensor cylinder, wide roof plate, side pylons, entry ramp — no dish",
    review: {
      verdict: "keep",
      keeps:
        "Regen pass: low wide bunker, roof plate, side pylons, no hero dish — massing separates from Scout Works / EM Array. Human promoted keep.",
      fixes: [
        "Optional: still generic-bunker; push sensor cylinder + roof plate harder for teleop read if a polish pass lands.",
      ],
    },
  },
  {
    id: "refinery",
    label: "Refinery",
    kind: "building",
    tech: 1,
    branch: "eco",
    sim: "refinery",
    cost: 150,
    prereq: "Command Center (inject)",
    blurb: "Mineral drop-off · +100 energy max while standing.",
    detail:
      "Local drop-off so rovers don't all path home to Core. Each finished Refinery raises energyMax by REFINERY_ENERGY_BONUS (+100) — former Capacitor role merged here. No capacity grant (Core / Dome own supply). No crystal link required. Unlocked via Command inject; Logistics can re-inject extras.",
    subject:
      "Compact mineral refinery: low intake bay, twin processing stacks, one clean pipe run, square scaffold pad",
    review: {
      verdict: "keep",
      keeps:
        "Regen pass: intake, twin stacks, one pipe, pad — greeble/handrails stripped. Separates from Depot cleanly.",
      fixes: [
        "Human: for the build-out, broaden the silos.",
        "Energy-bank role now lives here (was Capacitor). Optional: bus bars / charge rings on the stacks without cluttering icon scale.",
      ],
    },
  },
  {
    id: "bay",
    label: "Raider Bay",
    kind: "building",
    tech: 1,
    branch: "aggro",
    sim: "barracks",
    cost: 150,
    produces: "Raider",
    prereq: "Command Center",
    blurb: "Trains Raiders · basic ground combat.",
    detail:
      "T1 combat production. Trains Raiders (fast light ground). Prereq Command. Strike Dock (T2 aggro) can inject extra Bay copies. Core of early pressure.",
    subject:
      "Open roofless combat stall: square deck walled on three sides, tall rear blast wall with an arming hall on top, ordnance rack on the outside of one wall, a light attack rover parked in the stall with its nose over the front lip",
    review: {
      verdict: "keep",
      keeps:
        "Pinned to iter 36 (open hangar + parked raider). Human promoted keep — roofed hangar wins over mesh-aligned roofless stall (iter 56 stays in history).",
      fixes: [],
      mesh: "Mesh has caught up (21 parts, 252 edge segments empty / 540 staged, bbox x ±0.92 y 0–1.82 z ±0.82 world). barracksStaged in the Mesh lab. The bay is now: recessed stall pan with two hardstand rails on the parked raider's exact wheel tracks → framed side walls (solid sill to 0.41, then posts and a cap rail with daylight between, topping out below the raider's deck line) → paired ordnance magazines bolted outboard on deck-edge brackets → rear blast wall, cap beam, arming head and dispatch mast, all behind the tail. The raider is nearly as long as the deck is deep, which is why the building wraps it instead of standing beside it, and why 0.25 of nose and gun overhangs the front lip. Plate-vs-mesh deltas, both deliberate: the plate is a *roofed* hangar (human-promoted keep) and the mesh is roofless, because the match camera looks down and a roof buries the parked raider; and the plate's walls are solid, where the mesh frames them for the same reason.",
    },
  },
  {
    id: "raider",
    label: "Raider",
    kind: "unit",
    tech: 1,
    branch: "aggro",
    sim: "raider",
    blurb: "Fast light combat rover · ground only.",
    detail:
      "Basic combat unit from Raider Bay. Light role: speed over HP, short-range ground attack, no air. Operators race mul gives a small speed/dmg bump. Workhorse for early harass and mid-game swarms.",
    trainedAt: ["bay"],
    subject:
      "Light attack rover matching the Raider Bay parked product: angular faceted wedge hull, four small slim wheels, short forward gun barrel, dorsal disk sensor on a short stalk, low ground clearance — ground-only combat rover, no fins, no canopy",
    review: {
      verdict: "keep",
      keeps:
        "Co-gen from bay plate (iter 57): same wedge hull, dorsal disk, nose gun, wheels as the vehicle parked in Raider Bay — unit and producer finally match.",
      fixes: [
        "Mesh still boxy nose cone + side pods; concept is ahead of geo.",
      ],
      mesh: "Mesh has caught up (20 parts, 288 edge segments, bbox x ±0.59 y 0–0.71 z -0.65..1.01 world at scale 1.05). The raider is now a ground buggy matching the plate's role: dart planform (half-width 0.105 nose → 0.325 hip → 0.245 transom) so heading reads in plan, an open trough deck — recessed pan, gunwale rails 0.2 above it, cross sleepers, and a window of daylight between the gun and the power module — four hex wheels standing 0.16+ clear of the hull on exposed cross axles, a fixed fore-aft nose gun elongated 2.9:1 in plan, and a flat dorsal uplink hex. It reads apart from the rover (0.64 × 0.91, squat open bed) and the tank (1.44 × 1.66, wide slab) in plan at 58px. Plate-vs-mesh deltas: the plate's dish is stalked and the mesh lays it flat (a stalked circle occludes the deck it sits over from the match camera), and the plate's wheels are slim where the mesh runs them fat and outboard so the gap between hull and tyre survives at match zoom.",
    },
  },
  {
    id: "turret",
    label: "Turret",
    kind: "building",
    tech: 1,
    branch: "def",
    sim: "turret",
    cost: 100,
    prereq: "Command Center",
    blurb: "Ground defense hardpoint · medium range.",
    detail:
      "Static ground AA-no — ground attack only (~range 4.5). Prereq Command. EM Array path re-injects Turrets. Cheap perimeter teeth while army is out mining.",
    subject:
      "Ground defense turret: hexagonal pedestal, rotating head with a short stubby barrel, phosphor sight ring",
    review: {
      verdict: "keep",
      keeps:
        "Regen pass: short stub barrel so Artillery owns length; pedestal + head + stub remains the cleanest read in the set.",
      fixes: [],
      mesh: "Matches the shipped turret.",
    },
  },
  {
    id: "tank",
    label: "Tank",
    kind: "unit",
    tech: 1,
    branch: "shared",
    sim: "tank",
    blurb: "Heavy ground · not in Operators deck yet.",
    detail:
      "Shared sim unit (heavy, slow, high HP/dmg). Operators deck currently has no Forge/Factory card — this slot is for silhouette comparison and future tech. If it ships for Operators, expect teleop plate, not biped infantry.",
    trainedAt: [],
    subject:
      "Heavy angular ground combat vehicle with a thick box hull, short barrel, and treads or dual tracks",
    review: {
      verdict: "keep",
      keeps:
        "Technically the best-executed plate in the set — clean occlusion, confident facets, no greeble. Human promoted keep (comparison material; no Operators producer yet).",
      fixes: [
        "Still zero faction identity if it ever ships for Operators — hollow/strutted language vs solid MBT slab. Parked until Forge/Factory tech exists.",
      ],
      mesh: "Shipped tank is shared across races, which is arguably the real problem this plate is exposing.",
    },
  },

  // ── T2 Eco ─────────────────────────────────────────────
  {
    id: "logistics",
    label: "Logistics Hub",
    kind: "building",
    tech: 2,
    branch: "eco",
    sim: "logistics",
    cost: 300,
    prereq: "Command Center",
    blurb: "TECH T2 ECO · convoy tempo + artillery · no T3 on this branch.",
    detail:
      "Doctrine tech. Efficiency apex: injects Depot×2, Dome, Refinery (energy bank), Artillery Pad, and Overdrive op into discard. No T3 eco — this branch tops out at tempo, bank, and siege. Pick when you want more workers, cap, energy headroom, and long-range pads without committing air.",
    subject:
      "Logistics hub on an open square scaffold: flat-roofed block, racked cargo cans clamped down, a rigid transfer gantry, radio mast",
    review: {
      verdict: "keep",
      keeps:
        "Regen pass: flat roof, cargo cans, rigid gantry, faces occlude — no longer a barn with a slack cable. Human promoted keep.",
      fixes: [
        "Optional: still denser than icon-scale wants; simplify to scaffold + cans + one gantry + mast.",
        "No unique mesh yet (aliases factory) — silhouette here is the brief for a new geo.",
      ],
      mesh: "No unique mesh — currently aliases the factory geo. Whatever this becomes needs building from scratch.",
    },
  },
  {
    id: "artillery",
    label: "Artillery Pad",
    kind: "building",
    tech: 2,
    branch: "eco",
    sim: "artillery",
    cost: 200,
    prereq: "Logistics Hub",
    blurb: "Long-range ground battery (~range 7.5).",
    detail:
      "Siege hardpoint. High ground attack, longest static range in the kit. Squishier than a turret — needs vision and screen. From Logistics Hub inject (eco doctrine), not Strike Dock.",
    subject:
      "Long-range artillery hardpoint: high-elevation long barrel on a rotating base, four deployed outriggers, magazine box",
    review: {
      verdict: "keep",
      keeps:
        "The four deployed outriggers are the best bit of environmental storytelling in the gallery — they say 'recoil is a serious problem here' without a word, which is exactly true at this gravity. The high barrel elevation sells the range stat.",
      fixes: [
        "Reads as a pedestal-and-gun, same family as the Turret. Keep the long barrel and let the Turret shorten its own; the outriggers already carry most of the separation.",
        "Base cylinder is the busiest object in the plate for the least payoff — simplify it and let the outriggers dominate.",
      ],
      mesh: "No unique mesh — aliases the turret, so in-match the two really are the same building right now.",
    },
  },
  {
    id: "capacitor",
    label: "Capacitor",
    kind: "building",
    tech: 2,
    branch: "eco",
    status: "unused",
    sim: "capacitor",
    cost: 150,
    prereq: "— (retired)",
    blurb: "UNUSED · energy bank merged into Refinery.",
    detail:
      "Retired. +100 energy max now comes from each finished Refinery (REFINERY_ENERGY_BONUS). BuildingKind kept for old saves; not placeable, not in the Operators deck. Plate kept for silhouette comparison.",
    subject:
      "Bank of vertical energy capacitor cylinders of differing heights on a low pad, with charge rings and heavy bus bars",
    review: {
      verdict: "keep",
      keeps:
        "Clean cylinder bank — still a useful reference if Refinery ever wants a charge-read visual.",
      fixes: [
        "Do not ship as a card. Role lives on Refinery.",
      ],
      mesh: "No unique mesh — aliases depot. Kind placeable:false.",
    },
  },

  // ── T2 Def ─────────────────────────────────────────────
  {
    id: "em_array",
    label: "EM Array",
    kind: "building",
    tech: 2,
    branch: "def",
    sim: "em_array",
    cost: 300,
    prereq: "Command Center",
    blurb: "TECH T2 DEF · EW · unlocks AA, Jam, Null Lattice.",
    detail:
      "Defense doctrine tech. Injects Turret, Interceptor Net, Jamming op, Dome, and Null Lattice (T3 def). Path for anti-air, op denial, and eventual nuke site.",
    subject:
      "Electronic warfare array: one large dish flanked by two small ones and a single lattice mast on a square scaffold, coil core at the base",
    review: {
      verdict: "keep",
      keeps:
        "Regen pass: one hero dish + two small + one mast — listening-station count. Not a six-dish smear. Human promoted keep.",
      fixes: [
        "Still needs unique geo (aliases AA cone) — mesh work, not plate regen.",
      ],
      mesh: "No unique mesh — aliases the AA cone, which is a completely different silhouette from this plate.",
    },
  },
  {
    id: "aa",
    label: "Interceptor Net",
    kind: "building",
    tech: 2,
    branch: "def",
    sim: "aa",
    cost: 150,
    prereq: "EM Array",
    blurb: "Anti-air hardpoint · high air DPS.",
    detail:
      "Static AA nest (attackAir heavy, range ~5.5). Answers flyers and recon. Requires EM Array. Operators' answer to air pressure without committing Strike Dock.",
    subject:
      "Anti-air nest: open four-legged lattice tower with twin vertical launcher rails at the top and a small tracking dish",
    review: {
      verdict: "keep",
      keeps:
        "Regen pass: open lattice tower + twin vertical rails — no longer a solid pyramid mass. Rails stay the hero read. Human promoted keep.",
      fixes: [
        "Mesh is still a solid cone — plate is ahead of geo (mesh lab work).",
      ],
      mesh: "Shipped AA is a 4-sided cone on a pad — same solid-mass problem.",
    },
  },

  // ── T2 Aggro ───────────────────────────────────────────
  {
    id: "strike_dock",
    label: "Strike Dock",
    kind: "building",
    tech: 2,
    branch: "aggro",
    sim: "strike_dock",
    cost: 300,
    prereq: "Command Center",
    blurb: "TECH T2 AGGRO · air + Bay inject · unlocks Bomber Works.",
    detail:
      "Aggro doctrine tech. Injects Bay, Airpad, Intercept op, and Bomber Works (T3). Path for VTOL fighters and eventual bomber seat. Artillery Pad lives on Logistics (eco) so siege does not require the air doctrine.",
    subject:
      "Light strike staging dock: open hangar deck, short ramp, fuel spars and a loaded pallet — stages gear not a parked unit",
    review: {
      verdict: "keep",
      keeps:
        "Regen pass: light open deck + fuel spars/pallet (stages gear, not a flyer). Lighter mass than Bomber Works.",
      fixes: [
        "Still needs unique geo (aliases airpad which parks a flyer).",
      ],
      mesh: "No unique mesh — aliases the airpad, which now parks a flyer on it. Needs its own geo.",
    },
  },
  {
    id: "airpad",
    label: "Airpad",
    kind: "building",
    tech: 2,
    branch: "aggro",
    sim: "airpad",
    cost: 200,
    produces: "Interceptor",
    prereq: "Strike Dock",
    blurb: "Trains Interceptors · VTOL air + ground.",
    detail:
      "Produces Interceptor (Ops combat air — hits air and ground). Mid-cost air from Strike Dock path. Cluster pads for interceptor wings; Bomber Works is the T3 heavy seat. Factions are asymmetric: this is an Operators product line, not a shared flyer.",
    subject:
      "Hexagonal VTOL airpad with a glowing landing ring, four low tie-down clamps set outside the wingspan, a small control box, and a VTOL interceptor parked on the ring resting on its thrust with no landing gear",
    review: {
      verdict: "keep",
      keeps:
        "Hex apron + parked craft. Interceptor unit plate (58) was extracted from this product.",
      fixes: [
        "Optional: re-pass parked craft if unit plate drifts.",
      ],
      mesh: "airpadStaged parks interceptor geo. Bomber Works still aliases the pad solid.",
    },
  },
  {
    id: "interceptor",
    label: "Interceptor",
    kind: "unit",
    tech: 2,
    branch: "aggro",
    sim: "interceptor",
    blurb: "VTOL interceptor · air + ground · from Airpad.",
    detail:
      "Operators T2 combat air from Airpad. Hits air and ground, faster than Bomber, weaker than focused AA. Cap cost 2. Bomb Run can task any air unit including this one.",
    trainedAt: ["airpad"],
    subject:
      "VTOL interceptor matching the Airpad parked craft: pointed angular nose, compact fuselage, wing planforms, twin ventral thruster cones, twin rear thrusters, small dorsal fins, no landing gear — vacuum hover fighter extracted from the airpad plate",
    review: {
      verdict: "keep",
      keeps:
        "Co-gen from airpad (iter 58): same pointed craft, ventral cones, rear thrusters as the product on the pad.",
      fixes: [
        "Mesh still aliases flyer geo — update makeInterceptorGeo toward this plate.",
        "UI name collision with Interceptor Net (AA building).",
      ],
      mesh: "makeInterceptorGeo currently aliases flyer geo — diverge toward this plate.",
    },
  },
  {
    id: "flyer",
    label: "Flyer",
    kind: "unit",
    tech: 2,
    branch: "aggro",
    status: "unused",
    sim: "flyer",
    blurb: "UNUSED · Ops air split into Interceptor + Bomber.",
    detail:
      "Retired from the Operators deck. Shared flyer kind remains for other factions until they get their own air units (factions are asymmetric). Ops Airpad → Interceptor; Bomber Works → Bomber.",
    trainedAt: [],
    subject:
      "Angular VTOL fighter drone: straight thin wings, no tail fin, no canopy, twin thruster bells at the tail, wingtip RCS blisters, pointed nose — vacuum airframe, uncrewed, no rotors",
    review: {
      verdict: "keep",
      keeps: "Plate still useful as Mandate/shared air reference.",
      fixes: ["Do not train from Ops producers."],
      mesh: "makeFlyerGeo — non-Ops airpad product.",
    },
  },

  // ── T3 ─────────────────────────────────────────────────
  {
    id: "null_lattice",
    label: "Null Lattice",
    kind: "building",
    tech: 3,
    branch: "def",
    sim: "null_lattice",
    cost: 400,
    prereq: "EM Array",
    blurb: "TECH T3 DEF · apex deny · injects Nuke op.",
    detail:
      "Defense apex. On finish injects Nuke operation (heavy structure damage channel at mark — not a one-shot Core). Long build, fragile for cost — the point is the nuke tool, not the HP pool. Vision 6.",
    subject:
      "Abstract geometric null-lattice deny structure: open wireframe octahedron lattice tower with pulsing green nodes, rising from a small hexagonal ground anchor",
    review: {
      verdict: "keep",
      keeps:
        "Regen pass: open lattice stack, ground anchor, slight base weight — still the best lore fit and the only vertical silhouette. See-through is correct for a lattice.",
      fixes: [
        "Highest-value new geo in the backlog (still aliases habitat dome in-match).",
      ],
      mesh: "No unique mesh — currently aliases the habitat dome, which could not be further from this plate. Highest-value new geo in the backlog.",
    },
  },
  {
    id: "bomber_works",
    label: "Bomber Works",
    kind: "building",
    tech: 3,
    branch: "aggro",
    sim: "bomber_works",
    cost: 400,
    produces: "Bomber",
    prereq: "Strike Dock",
    blurb: "TECH T3 AGGRO · one Bomber seat · death refill · Bomb Run.",
    detail:
      "Aggro apex. One Bomber production seat per Works; on death, refill. Cluster Works for wings. Injects Bomb Run op. Expensive hangar — silhouette should read heavy air production, not a second Airpad.",
    subject:
      "Bomber hangar works: tall open bay with a heavy bomber parked in it nose-out, overhead gantry, munitions rack, launch apron",
    review: {
      verdict: "keep",
      keeps:
        "User: building concept is lit. Bomber unit plate (60) extracted from hangar product.",
      fixes: [
        "Hangar craft still has a canopy in the building plate; unit plate is solid-nose teleop.",
      ],
      mesh: "Still aliases airpad solid; bomberWorksStaged parks bomber for mesh lab.",
    },
  },
  {
    id: "bomber",
    label: "Bomber",
    kind: "unit",
    tech: 3,
    branch: "aggro",
    sim: "bomber",
    blurb: "Heavy strike bomber · from Bomber Works.",
    detail:
      "Operators T3 air. Higher HP and ground punch than Interceptor, slower, cap cost 3. Trained only at Bomber Works. Bomb Run op directs air units to a mark — this is the intended payload.",
    trainedAt: ["bomber_works"],
    subject:
      "Heavy bomber matching Bomber Works hangar craft: thick fuselage, wide wings, twin large rear thruster pods, underwing munition pylons, solid uncrewed nose (no canopy) — bulkier than the interceptor",
    review: {
      verdict: "keep",
      keeps:
        "Co-gen from bomber_works (iter 60): same mass, twin pods, munitions load as the hangar product; canopy stripped for teleop.",
      fixes: [
        "Mesh makeBomberGeo is simpler — catch geo up to this silhouette.",
        "Hangar plate still shows a canopy on the staged craft; optional building re-pass for perfect match.",
      ],
      mesh: "makeBomberGeo — bulkier flyer family; iterate toward this plate.",
    },
  },
];

/**
 * Findings that belong to the roster rather than to any one plate. Kept as data
 * so they show up in the lab's handoff panel and in a diff, not just in chat.
 */
export type RosterNote = {
  id: string;
  title: string;
  body: string;
  /** Concept ids the note bears on. */
  touches: readonly string[];
};

export const ROSTER_NOTES: readonly RosterNote[] = [
  {
    id: "occlusion-split",
    title: "Occlusion pass done — re-check chrome match",
    body:
      "Regen hit rover, scout, core, depot, logistics with solid faces. Habitat Dome stays see-through by design (now explicit in OPERATORS_STYLE). Re-walk the gallery for any plate that regressed to X-ray after later edits.",
    touches: ["rover", "scout", "core", "depot", "logistics", "dome"],
  },
  {
    id: "atmosphere-tells",
    title: "Atmosphere tells — scrubbed on second pass",
    body:
      "Scout, interceptor (ex-flyer plate), raider, logistics, refinery all re-hit. Artillery outriggers remain the positive gravity-tell example.",
    touches: ["scout", "interceptor", "raider", "logistics", "refinery", "artillery"],
  },
  {
    id: "empty-producers",
    title: "Producers stage product — polish remaining",
    body:
      "Depot, Bay, Airpad (Interceptor), Bomber Works (Bomber), Scout Works all stage product. Human keep on Depot/Bay/Scout Works. Soft polish: Scout Works parked craft still leans fighter-jet vs notched-delta; Bomber plate exists (co-gen from works).",
    touches: ["scout_works", "depot", "bay", "airpad", "bomber_works", "interceptor", "bomber"],
  },
  {
    id: "shared-geos",
    title: "Seven buildings have no mesh of their own",
    body:
      "logistics→factory, em_array→aa, strike_dock→airpad, null_lattice→dome, bomber_works→airpad, artillery→turret. Capacitor→depot is moot (Capacitor retired; energy on Refinery). In-match those pairs are literally the same building. Null Lattice is the worst of them (an abstract deny lattice currently drawn as a glass habitat dome) and Artillery/Turret the most gameplay-relevant, since a defender can't tell a 4.5-range turret from a 7.5-range battery. Parked products are keyed to building kind, not geo, so the aliases correctly stay empty — except Bomber Works, which stages a flyer on purpose.",
    touches: ["logistics", "em_array", "strike_dock", "null_lattice", "artillery", "bomber_works"],
  },
  {
    id: "icon-scale-collisions",
    title: "Pairs that collide at icon scale",
    body:
      "Turret vs Artillery Pad (pedestal + long thin barrel, both), Command Center vs EM Array vs Scout Works (all identified by a dish), Strike Dock vs Bomber Works (both open decks with a ramp). Capacitor crate collision retired with the card. Fixes are noted per card; the general rule is to separate on mass and footprint, which survives downscaling, rather than on features, which don't.",
    touches: ["turret", "artillery", "command", "em_array", "scout_works", "bay", "strike_dock", "bomber_works"],
  },
  {
    id: "roster-gaps",
    title: "Roster gaps against the sim",
    body:
      "No card exists for `factory` or `extractor`, both real BuildingKinds. Factory is the only producer of `tank`, which is why the Tank card correctly shows no producer — the Operators deck never injects a Forge, so the tank plate is comparison material only. Also worth knowing: `scout` is both a UnitKind and a BuildingKind, so resolveConceptId(\"scout\") always lands on the drone, never the Works — use `scout_works` explicitly.",
    touches: ["tank", "scout", "scout_works"],
  },
];

/** Catalog order within a tier: buildings then units, eco→def→aggro→core. */
const BRANCH_ORDER: TechBranch[] = ["core", "eco", "def", "aggro", "shared"];

/**
 * T2 doctrine gateways. Each unlocks injects on its branch; gallery groups
 * T2 under these with the tech building first (left).
 */
export const T2_DOCTRINES: readonly {
  id: string;
  branch: TechBranch;
  label: string;
}[] = [
  { id: "logistics", branch: "eco", label: "Logistics Hub" },
  { id: "em_array", branch: "def", label: "EM Array" },
  { id: "strike_dock", branch: "aggro", label: "Strike Dock" },
];

export type DoctrineGroup = {
  id: string;
  label: string;
  branch: TechBranch;
  /** Tech building first, then other buildings, then units. */
  concepts: ConceptDef[];
};

/**
 * Sort a doctrine cluster: tech building on the left, then buildings,
 * then units (catalog label as tiebreak).
 */
function sortDoctrineCluster(techId: string, list: ConceptDef[]): ConceptDef[] {
  return [...list].sort((a, b) => {
    if (a.id === techId && b.id !== techId) return -1;
    if (b.id === techId && a.id !== techId) return 1;
    if (a.kind !== b.kind) return a.kind === "building" ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
}

/** T2 concepts split by doctrine tech building (tech card is always first). */
export function t2DoctrineGroups(): DoctrineGroup[] {
  return T2_DOCTRINES.map((d) => {
    const concepts = sortDoctrineCluster(
      d.id,
      OPERATORS_CONCEPTS.filter(
        (c) => isActiveConcept(c) && c.tech === 2 && c.branch === d.branch,
      ),
    );
    return {
      id: d.id,
      label: d.label,
      branch: d.branch,
      concepts,
    };
  });
}

export function conceptsByTech(tech: TechTier): ConceptDef[] {
  if (tech === 2) {
    // Flat list still respects doctrine order + tech-building-first.
    return t2DoctrineGroups().flatMap((g) => g.concepts);
  }
  return OPERATORS_CONCEPTS.filter(
    (c) => isActiveConcept(c) && c.tech === tech,
  ).sort((a, b) => {
    const bk = BRANCH_ORDER.indexOf(a.branch) - BRANCH_ORDER.indexOf(b.branch);
    if (bk !== 0) return bk;
    if (a.kind !== b.kind) return a.kind === "building" ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
}

/** Retired plates — gallery "Unused" section. */
export function unusedConcepts(): ConceptDef[] {
  return OPERATORS_CONCEPTS.filter((c) => !isActiveConcept(c)).sort((a, b) =>
    a.label.localeCompare(b.label),
  );
}

export function conceptById(id: string): ConceptDef | undefined {
  return OPERATORS_CONCEPTS.find((c) => c.id === id);
}

export function resolveConceptId(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  if (!t) return null;
  if (conceptById(t)) return t;
  const bySim = OPERATORS_CONCEPTS.find(
    (c) => c.sim === t || c.label.toLowerCase() === t,
  );
  return bySim?.id ?? null;
}

export function techBadge(c: ConceptDef): string {
  const branch =
    c.branch === "core" || c.branch === "shared"
      ? ""
      : ` · ${BRANCH_LABELS[c.branch]}`;
  return `T${c.tech}${branch}`;
}

/** Units only, catalog order. */
export function operatorUnits(): ConceptDef[] {
  return OPERATORS_CONCEPTS.filter((c) => c.kind === "unit");
}

/** Reviewed cards, worst verdict first — the regeneration queue. */
export function reviewQueue(): ConceptDef[] {
  const rank: Record<ConceptVerdict, number> = { reject: 0, revise: 1, keep: 2 };
  return OPERATORS_CONCEPTS.filter((c) => c.review).sort(
    (a, b) => rank[a.review!.verdict] - rank[b.review!.verdict] || a.label.localeCompare(b.label),
  );
}

export function reviewTally(): Record<ConceptVerdict, number> {
  const t: Record<ConceptVerdict, number> = { keep: 0, revise: 0, reject: 0 };
  for (const c of OPERATORS_CONCEPTS) if (c.review) t[c.review.verdict]++;
  return t;
}

export function rosterNotesFor(id: string): RosterNote[] {
  return ROSTER_NOTES.filter((n) => n.touches.includes(id));
}

export function productionBuildingsFor(unit: ConceptDef): ConceptDef[] {
  return (unit.trainedAt ?? [])
    .map((id) => conceptById(id))
    .filter((b): b is ConceptDef => !!b);
}
