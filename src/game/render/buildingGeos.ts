/**
 * Building mesh catalog — procedural Three.js geometries for match + labs mesh browser.
 */
import * as THREE from "three";
import type { BuildingKind, UnitKind } from "../sim/types";
import {
  type BuildingPartKit,
  type PartSpec,
  box,
  cone,
  cyl,
  flatHex,
  flatRing,
  geoDome,
  kitFromSpecs,
  materializePart,
  mergeGeos,
  mergeParts,
  plate,
} from "./meshKit";
import {
  ROVER_TURRET_PIVOT,
  SCOUT_VENTRAL_Y,
  makeBomberGeo,
  makeInterceptorGeo,
  makeRaiderGeo,
  makeScoutGeo,
  makeWorkerOpsGeo,
  makeWorkerOpsTurretGeo,
} from "./unitGeos";

/**
 * Scout Works rail cradle — shared by building mesh, staged parked drone, and
 * the unit launch animation so the product always leaves from the same pose.
 *
 * `railTilt` is mesh rotateX (negative = nose-up). For `placeOnSurface`, use
 * pitch = `-SCOUT_PAD.railTilt` (positive = nose-up).
 */
export const SCOUT_PAD = {
  railTilt: -0.42,
  /** Model-space park point (ventral on the rails, nose over the lip). */
  parkY: 0.634,
  parkZ: -0.01,
  parkScale: 0.85,
  /** Building shell scale used in entityBuildings. */
  buildScale: 1.15,
  /**
   * Total launch window (rail fling + blend into free flight).
   * First ~railEnd of the normalized progress is locked to the rail; the rest
   * crossfades position / attitude into the normal air controller so release
   * doesn't pop.
   */
  launchDur: 1.45,
  /** Normalized progress (0–1) where free-flight blend begins. */
  railEnd: 0.42,
} as const;

/**
 * Where an Operators producer stages its next unit.
 *
 * Operators don't manufacture, they dispatch — every producer is a ground
 * station with its product sitting out in the open, so the silhouette tells you
 * what comes off it without a tooltip. The Scout Works set the pattern (drone
 * on the rail); this table extends it to the rest of the kit.
 *
 * Coordinates are *building* model space, before `SCOUT_PAD.buildScale`.
 * `y` is the deck the unit's own origin rests on. `yaw` is map-relative, which
 * is the same as building-relative because buildings always render at yaw 0.
 * `scale` is the unit's world render scale divided by `buildScale`, so a parked
 * unit is exactly the size of a live one.
 */
export type ProductPark = {
  unit: UnitKind;
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  /**
   * Nose-up radians, for a product parked on something that isn't level (the
   * Depot ramp). Positive = nose up, matching `placeOnSurface`. A flat unit on
   * a visible slope is worse than no slope at all — it reads as clipping.
   */
  pitch?: number;
};

/** buildScale-relative: ROVER_SCALE 0.57 / 1.15, other units 1.05 / 1.15. */
const PARK_ROVER_SCALE = 0.4957;
const PARK_UNIT_SCALE = 0.913;

export const PRODUCT_PARK: Partial<Record<BuildingKind, ProductPark>> = {
  // Rover nose-out and nose-*down* on the drive-up ramp. y is the ramp's top
  // surface directly under the origin (wheel bottoms sit at unit y=0) and
  // pitch matches the ramp slope, so all four wheels track the deck instead of
  // one pair hanging in air. z 0.34 is mid-ramp: far enough forward that the
  // bay roof never falls across the rover from the match camera, far enough
  // back that the chassis (~0.79 long at park scale) stays on the slope.
  // Any change to DEPOT_DECK_TOP / the ramp span moves all three numbers.
  depot: {
    unit: "worker",
    x: 0,
    y: 0.23,
    z: 0.34,
    yaw: 0,
    scale: PARK_ROVER_SCALE,
    pitch: -0.33,
  },
  // Raider in the stall, wheels on the hardstand rails (top y 0.19), nose out
  // over the front lip. z is pinned by the *tail*, not the nose: the raider is
  // ~1.46 long in model units (rear tyre -0.62 → instrument bar ~0.82) which is
  // ~1.33 at park scale, against a 1.34 deck — tight but the blunt prow still
  // peeks past the apron. z 0.04 leaves ~0.034 between the rear tyre and the
  // blast wall's inner face at -0.56. y 0.19 is the hardstand top; hex wheels
  // rest on a flat, so the tyres touch down 0.025 lower than the origin, same
  // as every Ops wheeled unit.
  barracks: { unit: "raider", x: 0, y: 0.19, z: 0.04, yaw: 0, scale: PARK_UNIT_SCALE },
  // Ops Airpad parks an Interceptor over the landing ring (thrust rest, no gear).
  // y 0.28 is origin height: deck top is 0.18; ventral cone tips sit ~0.03
  // unit-local so they clear the apron after park scale. If the apron height
  // or ventral cones change, retune this.
  airpad: { unit: "interceptor", x: 0, y: 0.28, z: 0.02, yaw: 0, scale: PARK_UNIT_SCALE },
  // Bomber Works parks a Bomber (bulkier airframe). y 0.32 clears underwing
  // munitions (~0.115 unit-local bottom) off the deck.
  bomber_works: { unit: "bomber", x: 0, y: 0.32, z: 0.02, yaw: 0, scale: PARK_UNIT_SCALE },
};

/** Chord bearings of the Core mast truss — one chord forward (+Z), two aft. */
const TRI_CHORD = [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3];

/**
 * Triangular lattice stage for the Core mast: 3 corner chords, zig-zag
 * diagonals, and belts at the interior bay joints only (the socket / ring hub /
 * crown plate cap the ends, so belts there would just double a line).
 *
 * Triangular rather than the square the concept plate draws, for three reasons:
 * a 3-fold mast interleaves with the 4-fold radial spars above it so the two
 * layers never hide each other in plan; it costs 25% fewer lines than a square
 * truss for the same read; and one chord pointing +Z gives the whole station a
 * heading, which a 4-fold tower cannot.
 *
 * `bays` is deliberately small (2 and 1). The concept plate's ~10 bays of dense
 * X-bracing is hash at match zoom — at 58px a bay is under 4px tall. Few tall
 * bays with a single alternating diagonal each read as "truss"; many short ones
 * read as noise.
 */
function triTrussStage(
  y0: number,
  y1: number,
  r: number,
  chordW: number,
  braceW: number,
  bays: number,
): PartSpec[] {
  const out: PartSpec[] = [];
  const side = r * Math.sqrt(3); // face width between adjacent chords
  const apo = r / 2; // face plane distance from the axis
  const bayH = (y1 - y0) / bays;
  const braceLen = Math.hypot(side, bayH);
  const braceTilt = Math.atan2(side, bayH);
  for (let i = 0; i < 3; i++) {
    const a = TRI_CHORD[i]!;
    // Chord posts sit *on* the circumradius; ry keeps their faces radial.
    out.push({
      geo: box(chordW, y1 - y0, chordW),
      x: r * Math.sin(a),
      y: (y0 + y1) / 2,
      z: r * Math.cos(a),
      ry: a,
    });
    // Face i is the one opposite chord i, hence the negated apothem offset.
    const fx = -apo * Math.sin(a);
    const fz = -apo * Math.cos(a);
    for (let b = 0; b < bays; b++) {
      // Brace is modelled long in Y, tilted with rx (which applies before ry in
      // materializePart) so the lean lands tangential once the face is yawed.
      out.push({
        geo: box(braceW, braceLen, braceW),
        x: fx,
        y: y0 + bayH * (b + 0.5),
        z: fz,
        rx: b % 2 === 0 ? braceTilt : -braceTilt,
        ry: a - Math.PI / 2,
      });
    }
    for (let b = 1; b < bays; b++) {
      out.push({
        geo: box(side * 1.06, braceW * 1.25, chordW),
        x: fx,
        y: y0 + bayH * b,
        z: fz,
        ry: a,
      });
    }
  }
  return out;
}

export function makeBuildingGeos() {
  const pad = flatHex(0.95);
  const padLg = flatHex(1.25);
  // Operators square scaffold deck (thin plate) + unit-height leg (scaled per corner)
  const scaffoldDeck = new THREE.BoxGeometry(1.55, 0.12, 1.55);
  scaffoldDeck.translate(0, 0.06, 0); // top of deck at y=0.12
  const scaffoldLeg = new THREE.BoxGeometry(0.1, 1, 0.1);
  // pivot at top of leg so scale.y grows downward when we place carefully
  scaffoldLeg.translate(0, -0.5, 0);
  const ring = flatRing(0.55, 0.82, 6);
  const marker = flatRing(0.38, 0.58, 6);

  /**
   * Operators Core Station — the relay. Not placeable, renders at sx 1.85 /
   * sy 2.05 (entityBuildings), so it is already ~4x a scaffold building's world
   * height at 3.6 model units. **Do not make it taller.** `entityBuildings`
   * launches the sky beam from a hard-coded topLocal of 3.65, so the crown's top
   * face must stay at y ≈ 3.6.
   *
   * Everything below is aimed at the match camera (~40–55° down). Four things
   * drive the design:
   *
   * 1. **It has to read as the relay, not as furniture.** Every unit on the map
   *    is teleoperated through this thing; it is the reason the faction exists.
   *    So the ring carries eight joint flanges, four docking-node modules and two
   *    canted high-gain arrays — something every 22.5° of arc. The old bare
   *    quad-tessellated torus had no scale cue anywhere on it, which made a
   *    5.5-world-unit ring read like a bracelet.
   * 2. **Open has to be visible from above.** The old base was a solid hex
   *    frustum and the old mast a solid cylinder — in plan the whole middle of
   *    the station was one filled blob, which is the opposite of the Operators
   *    hollow-frame identity. Now: square scaffold frame on four legs with an X
   *    of bracing and daylight in the four triangles; open triangular truss
   *    above it. From the match camera you look through the ring's daylight, past
   *    the truss, and down onto the base frame. That layered stack is the whole
   *    point.
   * 3. **Layers must interleave in plan, not stack.** Base bracing runs on the
   *    diagonals (45°/135°), the radial spars on the cardinals (0/90/180/270),
   *    the mast on a 3-fold, the ring flanges on a 45° grid offset 22.5° from
   *    both. No two tiers ever coincide, so nothing occludes anything else from
   *    directly overhead.
   * 4. **Nothing thinner than ~0.07 model units** (≈0.13 world at sx 1.85) — the
   *    thinnest part on the model is the 0.08 ring flange. Below roughly 0.03
   *    world a wireframe part stops being a shape and becomes two shimmering
   *    coincident lines, which is what the old station's detail budget was mostly
   *    spent on.
   *
   * Kept on purpose: ring centre radius 1.35 at y 2.0, base top at 0.46. That
   * 1.54 of empty daylight between base and ring is what makes the ring-station
   * silhouette read at all, and it is exactly what the concept plate is missing.
   *
   * No eyes anywhere — apertures are flush hexes (docking nodes, crown flanks)
   * or flat panels (crown forward face), never a lens barrel or dome.
   */
  const RING_Y = 2.0;

  const coreParts: PartSpec[] = [
    // ── foundation: square scaffold frame on four legs ───────────────────
    // Square + 4 legs is the Operators building family signature (see
    // scaffoldDeck / scaffoldLeg); the core joins it instead of standing on the
    // solid frustum it used to. The frame is a *frame*, not a deck — a deck
    // plate here would be a solid brick in plan and cost the whole hollow read.
    { geo: cyl(0.08, 0.15, 0.34, 4), x: 0.72, y: 0.17, z: 0.72, ry: Math.PI / 4 },
    { geo: cyl(0.08, 0.15, 0.34, 4), x: -0.72, y: 0.17, z: 0.72, ry: Math.PI / 4 },
    { geo: cyl(0.08, 0.15, 0.34, 4), x: 0.72, y: 0.17, z: -0.72, ry: Math.PI / 4 },
    { geo: cyl(0.08, 0.15, 0.34, 4), x: -0.72, y: 0.17, z: -0.72, ry: Math.PI / 4 },
    { geo: box(1.62, 0.17, 0.15), y: 0.375, z: 0.72 },
    { geo: box(1.62, 0.17, 0.15), y: 0.375, z: -0.72 },
    { geo: box(0.15, 0.17, 1.62), x: 0.72, y: 0.375 },
    { geo: box(0.15, 0.17, 1.62), x: -0.72, y: 0.375 },
    // Diagonal bracing, not orthogonal: keeps the base off the spar bearings
    // above so the two layers interleave instead of overlapping in plan.
    { geo: box(2.06, 0.13, 0.14), y: 0.345, ry: Math.PI / 4 },
    { geo: box(2.06, 0.13, 0.14), y: 0.345, ry: -Math.PI / 4 },
    // Hex socket — the transition piece from the square frame to the 3-fold
    // truss. Reads as engineering rather than as parts that happen to touch.
    { geo: cyl(0.3, 0.4, 0.3, 6), y: 0.44 },

    // ── mast: open lattice truss, two stages, stepped at the ring ────────
    // The step happens exactly at the ring hub, so the ring reads as a
    // structural node rather than a hoop slid over a lamppost.
    ...triTrussStage(0.4, 2.02, 0.36, 0.11, 0.095, 2),
    ...triTrussStage(2.0, 2.96, 0.22, 0.09, 0.085, 1),

    // ── ring hub + radial spars ──────────────────────────────────────────
    { geo: cyl(0.28, 0.4, 0.34, 6), y: RING_Y },
  ];

  // Spars taper outboard (0.34 wide at the hub, 0.20 at the ring) — a spar in
  // tension is thickest where the moment is, and the taper gives the four
  // spokes a direction in plan instead of reading as a plus sign.
  for (let k = 0; k < 4; k++) {
    coreParts.push({
      geo: plate(
        [
          [-0.17, 0.24],
          [0.17, 0.24],
          [0.1, 1.27],
          [-0.1, 1.27],
        ],
        0.16,
      ),
      y: RING_Y,
      ry: (k * Math.PI) / 2,
    });
  }

  // The relay ring. Still a torus, and that is deliberate after two failed
  // rewrites: cutting it into 12 (then 8) discrete annular sectors with joint
  // gaps did give scale cues, but it also turned the outer silhouette into a cog
  // and then an octagon, and the ring-station outline is the single most
  // recognizable shape in the game. So the outline stays a clean circle and the
  // scale cues get *mounted on* it instead — flanges, nodes, spar landings
  // below. 4 radial segments (a flattened diamond section, sy 0.62) rather than
  // the old 5: a knife-edged rail reads slimmer and costs fewer lines than the
  // old quad-tessellated tube, which is what made it look like a bracelet.
  coreParts.push({
    geo: new THREE.TorusGeometry(1.35, 0.14, 4, 16),
    y: RING_Y,
    rx: Math.PI / 2,
    sy: 0.62,
  });

  // Segment-joint flanges every 45°, offset 22.5° from both the spars and the
  // docking nodes so that something lands every 22.5° around the circumference
  // and no two tiers ever coincide. These are the scale cue: a ring with eight
  // visible joints in it is a *structure* of known module size; a smooth hoop is
  // a bracelet. They sit proud above, below and *inboard* of the rail but stop
  // at r 1.47, a hair inside the ring's 1.49 — an earlier cut let them poke past
  // it and the eight bumps turned the outer silhouette into a rounded octagon.
  // Only the four docking nodes are allowed to break the circle.
  for (let k = 0; k < 8; k++) {
    const p = Math.PI / 8 + (k * Math.PI) / 4;
    coreParts.push({
      geo: box(0.08, 0.3, 0.32),
      x: 1.31 * Math.sin(p),
      y: RING_Y,
      z: 1.31 * Math.cos(p),
      ry: p,
    });
  }

  // Docking nodes, mid-segment on the diagonals — the only things at r > 1.47,
  // so they read as attached modules rather than as ring. Deliberately modest:
  // an earlier cut at 0.42 x 0.30 jutting to r 1.70 turned the ring into a cog
  // and cost the circle at icon size. The flush hex on the outboard face is the
  // aperture; Operators get no lenses.
  for (let k = 0; k < 4; k++) {
    const p = Math.PI / 4 + (k * Math.PI) / 2;
    coreParts.push({
      geo: box(0.32, 0.24, 0.26),
      x: 1.47 * Math.sin(p),
      y: RING_Y + 0.05,
      z: 1.47 * Math.cos(p),
      ry: p,
    });
    coreParts.push({
      geo: flatHex(0.085),
      x: 1.605 * Math.sin(p),
      y: RING_Y + 0.05,
      z: 1.605 * Math.cos(p),
      rx: Math.PI / 2,
      ry: p,
    });
  }

  // High-gain arrays, port and starboard. These replace the two vertical slabs
  // that used to hang off x ±1.55: a slab is 0.1 x 0.65 in plan, i.e. invisible
  // from the match camera, and it read as a wall. A shallow-canted panel
  // straddling the ring's inner rim projects 0.41 x 0.68 in plan — one of the
  // first things you see from above — while staying inboard of the ring so the
  // docking nodes remain the only things that break the circle. The cant is only
  // 0.2 rad on purpose: at 0.5 the pair read as swept wings raised off the hull,
  // which is an atmosphere tell this faction must never give. Nearly flat, they
  // read as phased-array panels and vanish to a line in elevation, which is the
  // correct trade under rule 1. Two of them, on X: every other ring feature is
  // 4-fold, so a 2-fold pair gives the station a lateral axis.
  for (const s of [1, -1]) {
    coreParts.push({ geo: box(0.13, 0.22, 0.14), x: 1.22 * s, y: 2.2 });
    coreParts.push({ geo: box(0.42, 0.07, 0.68), x: 1.22 * s, y: 2.4, rz: -0.2 * s });
  }

  coreParts.push(
    // ── sensor crown ─────────────────────────────────────────────────────
    // Body is deeper (0.54) than wide (0.42) and the forward face carries a wide
    // flat panel where the laterals get small hexes, so the crown agrees with the
    // mast's forward chord about which way the station faces.
    //
    // The forward feature is a landscape *panel*, not the flush hex used
    // elsewhere: a single centred hex on the front face of a head-shaped box is
    // the most eye-like thing you can draw, and Operators have no eyes (LORE.md
    // — they signal capability, not alertness). A 0.30 x 0.15 panel cannot be
    // misread as a lens. The lateral hexes are fine: off-axis and paired.
    { geo: box(0.5, 0.12, 0.5), y: 2.98 },
    { geo: box(0.42, 0.42, 0.54), y: 3.25 },
    { geo: box(0.3, 0.15, 0.05), y: 3.22, z: 0.28 },
    { geo: flatHex(0.085), x: 0.212, y: 3.28, rx: Math.PI / 2, ry: Math.PI / 2 },
    { geo: flatHex(0.085), x: -0.212, y: 3.28, rx: Math.PI / 2, ry: -Math.PI / 2 },
    { geo: box(0.58, 0.1, 0.58), y: 3.5 },
    // Emitter pad: flat, flush, top face at y 3.60. This is where the sky beam
    // in entityBuildings leaves from (topLocal 3.65) — it exists so the beam has
    // something to come out of.
    { geo: cyl(0.17, 0.25, 0.1, 6), y: 3.55 },
  );

  const coreStation = mergeParts(coreParts);

  const hexOrb = (r: number) => new THREE.IcosahedronGeometry(r, 0);
  const coreHive = mergeParts([
    { geo: hexOrb(1.15), y: 1.0 },
    { geo: hexOrb(0.95), y: 2.15 },
    { geo: hexOrb(0.78), y: 3.15 },
    { geo: hexOrb(0.58), y: 3.95 },
    { geo: hexOrb(0.4), y: 4.55 },
    { geo: hexOrb(0.42), x: 0.95, y: 1.55, z: 0.35 },
    { geo: hexOrb(0.38), x: -0.85, y: 2.0, z: -0.4 },
    { geo: hexOrb(0.32), x: 0.55, y: 2.85, z: -0.55 },
    { geo: cone(0.14, 0.85, 5), x: 0.4, y: 4.9, z: 0.15 },
    { geo: cone(0.12, 0.7, 5), x: -0.35, y: 4.75, z: -0.2 },
  ]);

  const coreRocket = mergeParts([
    { geo: cyl(0.7, 0.85, 0.35, 6), y: 0.2 },
    { geo: cyl(0.5, 0.58, 2.6, 6), y: 1.65 },
    { geo: cone(0.58, 1.1, 6), y: 3.55 },
    { geo: cyl(0.65, 0.8, 0.35, 6), y: 0.45 },
    { geo: box(0.14, 1.0, 0.7), x: 0.7, y: 0.85 },
    { geo: box(0.14, 1.0, 0.7), x: -0.7, y: 0.85 },
    { geo: box(0.7, 1.0, 0.14), z: 0.7, y: 0.85 },
    { geo: box(0.7, 1.0, 0.14), z: -0.7, y: 0.85 },
    { geo: box(0.12, 0.7, 0.12), x: 0.75, y: 0.35, z: 0.75 },
    { geo: box(0.12, 0.7, 0.12), x: -0.75, y: 0.35, z: 0.75 },
    { geo: box(0.12, 0.7, 0.12), x: 0.75, y: 0.35, z: -0.75 },
    { geo: box(0.12, 0.7, 0.12), x: -0.75, y: 0.35, z: -0.75 },
    { geo: cyl(0.12, 0.12, 0.4, 5), y: 4.2 },
  ]);

  const coreGem = new THREE.OctahedronGeometry(0.55, 0);
  const coreBeam = new THREE.CylinderGeometry(0.035, 0.09, 1, 6, 1, true);
  const coreBeamSoft = new THREE.CylinderGeometry(0.1, 0.22, 1, 6, 1, true);

  const extractorKit = kitFromSpecs([
    { geo: cyl(0.45, 0.65, 0.5, 6), y: 0.3 },
    { geo: cyl(0.2, 0.25, 1.0, 5), y: 1.0 },
    { geo: box(0.9, 0.12, 0.12), y: 1.35 },
    { geo: box(0.12, 0.12, 0.7), y: 1.35, z: 0.2 },
    { geo: cone(0.3, 0.4, 5), y: 1.65 },
  ]);
  const extractor = extractorKit.solid;

  /**
   * Operators Worker Depot — garage bay aft, drive-up ramp forward.
   *
   * Same doctrine as the Scout Works: an Operators producer is a dispatch
   * station, so its product is parked in the open where you can read it. Concept
   * plate `operators/depot.jpg`: garage bay mouth facing +Z, rover staged on a
   * sloping drive-up ramp from the front lip up onto the bay floor — not thin
   * guide rails (those read as guardrails at match zoom).
   *
   * Match-camera doctrine (~40–55° down):
   * 1. **Ramp, not rails.** The first pass at this laid a near-flat plank on the
   *    ground and flanked it with two low kerb pads. From the match camera the
   *    kerbs were the only thing with any height, so the whole assembly read as
   *    *guardrails* — the exact note this geo exists to answer. A ramp reads as a
   *    ramp because of three things together, and none of them is optional:
   *    a deck that is **raised enough to need one** (top 0.30, not 0.19), a
   *    **slope you can see in profile** (~17°), and **solid triangular side
   *    cheeks** that close the wedge. The cheeks are the load-bearing cue: a
   *    tilted plate alone is ambiguous at 58px, a filled wedge never is. No kerbs.
   * 2. **Garage silhouette.** Side walls + rear wall + lipped roof over the bay;
   *    service stack and dispatch mast on the roof.
   * 3. **Footprint** near scaffold family ±0.7–0.8. Nothing thinner than ~0.07.
   *
   * PRODUCT_PARK.depot parks the rover on the ramp surface — retune y/z if the
   * ramp plate moves (wheel bottoms are unit y=0; park.y = surface under origin).
   */
  // Ramp geometry, kept as named constants because the park point and the side
  // cheeks all have to agree with the deck: any change here moves the rover.
  const DEPOT_DECK_TOP = 0.30;
  const DEPOT_RAMP_FOOT_Z = 0.86; // ground end (+Z)
  const DEPOT_RAMP_HEAD_Z = -0.02; // meets the deck just inside the bay mouth
  const DEPOT_RAMP_RUN = DEPOT_RAMP_FOOT_Z - DEPOT_RAMP_HEAD_Z;
  const DEPOT_RAMP_TILT = Math.atan2(DEPOT_DECK_TOP, DEPOT_RAMP_RUN); // ≈0.33 rad
  const DEPOT_RAMP_LEN = Math.hypot(DEPOT_RAMP_RUN, DEPOT_DECK_TOP);
  const DEPOT_RAMP_HALF_W = 0.48; // seats the parked rover (chassis ~0.8 × scale)

  // Cheek profile authored as [height, z]; rz≈90° stands it up, thickness → X.
  const depotCheek = () =>
    plate(
      [
        [0.02, DEPOT_RAMP_FOOT_Z],
        [0.02, DEPOT_RAMP_HEAD_Z],
        [DEPOT_DECK_TOP, DEPOT_RAMP_HEAD_Z],
      ],
      0.1,
    );

  const depotKit = kitFromSpecs([
    // Bay floor / main apron under the garage (top = DEPOT_DECK_TOP)
    { geo: box(1.35, 0.3, 1.0), y: 0.15, z: -0.14 },
    // Garage bay at -Z
    { geo: box(0.14, 0.62, 0.62), x: 0.55, y: 0.63, z: -0.34 }, // bay walls
    { geo: box(0.14, 0.62, 0.62), x: -0.55, y: 0.63, z: -0.34 },
    { geo: box(1.24, 0.62, 0.12), y: 0.63, z: -0.59 }, // rear wall
    { geo: box(1.35, 0.1, 0.78), y: 0.99, z: -0.28 }, // bay roof, lipped over the apron
    { geo: cyl(0.18, 0.24, 0.34, 6), x: -0.42, y: 1.16, z: -0.5 }, // service stack
    { geo: box(0.08, 0.5, 0.08), x: 0.5, y: 1.26, z: -0.5 }, // dispatch mast
    // Drive-up ramp: sloping deck, ground at +Z up to the apron top.
    // rx > 0 lowers the +Z end.
    {
      geo: box(DEPOT_RAMP_HALF_W * 2, 0.1, DEPOT_RAMP_LEN),
      y: DEPOT_DECK_TOP * 0.5,
      z: (DEPOT_RAMP_FOOT_Z + DEPOT_RAMP_HEAD_Z) * 0.5,
      rx: DEPOT_RAMP_TILT,
    },
    // Side cheeks — the filled wedge that makes it a ramp and not a plank.
    { geo: depotCheek(), x: DEPOT_RAMP_HALF_W, rz: Math.PI / 2 },
    { geo: depotCheek(), x: -DEPOT_RAMP_HALF_W, rz: Math.PI / 2 },
  ]);
  const depot = depotKit.solid;

  /**
   * Operators Refinery — mineral drop-off + energy bank (former Capacitor).
   *
   * Match camera (~40–55° down). Plan silhouette is twin broad hex stacks on a
   * square pad with a low intake bay — deliberately not Depot (garage + apron +
   * rover rails). Catalog subject: low intake bay, twin processing stacks, one
   * clean pipe run, square scaffold pad. Human: **broaden the silos.** Energy-
   * bank role reads as one charge collar per stack (no bus-bar forest, no
   * greeble). Nothing thinner than ~0.07. No parked unit.
   *
   * Deck footprint stays near scaffoldDeck's ±0.775 (pad ±0.68); plinths may
   * kiss the scaffold edge. Stacks sit on a diagonal so the single pipe has a
   * real span and the plan never reads as a single blob.
   */
  const refineryKit = kitFromSpecs([
    // Square working pad — Ops scaffold family (sits on shared scaffoldDeck)
    { geo: box(1.36, 0.13, 1.36), y: 0.065 },
    { geo: box(1.36, 0.07, 0.08), y: 0.165, z: 0.64 }, // front lip

    // ── Tall processing stack (aft-port) — broad plinth + fat hex column ──
    { geo: cyl(0.40, 0.44, 0.40, 6), x: -0.38, y: 0.34, z: -0.28 }, // plinth
    { geo: cyl(0.32, 0.34, 1.08, 6), x: -0.38, y: 1.08, z: -0.28 }, // column
    { geo: cyl(0.36, 0.36, 0.09, 6), x: -0.38, y: 1.28, z: -0.28 }, // charge ring
    { geo: cyl(0.30, 0.30, 0.08, 6), x: -0.38, y: 1.66, z: -0.28 }, // cap

    // ── Short stack (fore-starboard) — intake side, also broad ──
    { geo: cyl(0.38, 0.42, 0.36, 6), x: 0.34, y: 0.32, z: 0.26 }, // plinth
    { geo: cyl(0.30, 0.32, 0.88, 6), x: 0.34, y: 0.94, z: 0.26 }, // column
    { geo: cyl(0.34, 0.34, 0.09, 6), x: 0.34, y: 1.12, z: 0.26 }, // charge ring

    // ── One clean pipe run (process + bus) between stack faces ──
    // Centers (-0.38,-0.28)→(0.34,0.26); dist ≈0.90; face gap ≈0.28 after radii.
    // Box long-axis is X; ry = -atan2(dz, dx) aims it at the short stack.
    { geo: box(0.36, 0.1, 0.1), x: -0.02, y: 0.98, z: -0.01, ry: -0.64 },

    // ── Low intake bay — open hopper on the short stack, facing +Z ──
    { geo: box(0.52, 0.30, 0.22), x: 0.34, y: 0.37, z: 0.50 }, // hopper body
    { geo: box(0.48, 0.12, 0.26), x: 0.34, y: 0.24, z: 0.62 }, // chute tray
    { geo: box(0.08, 0.26, 0.28), x: 0.56, y: 0.35, z: 0.56 }, // hopper flanks
    { geo: box(0.08, 0.26, 0.28), x: 0.12, y: 0.35, z: 0.56 },
  ]);
  const refinery = refineryKit.solid;

  /**
   * Operators Habitat Dome — fragile geodesic glass house (Red Mars).
   *
   * Concept plate `operators/dome.jpg` + catalog id "dome": true geodesic
   * **hemisphere** on a low multi-bay scaffold ring. This is the ONE deliberate
   * see-through surface in the kit — the shell lattice sells the soft-spot card
   * (cheap to snipe, painful when cap-starved). Do not solid-face this shell.
   *
   * Match-camera doctrine (~40–55° down, ~58px plan):
   * 1. **Silhouette is "bowl cut of geodesic on a ring," not a ball.** A full
   *    icosahedron scaled Y*0.7 read as a squashed balloon. Shell is an upper
   *    hemisphere with a clear apex; base sits on the ring top, not floating
   *    past the skirt.
   * 1b. **The shell is a sliced icosphere, never a lat/long hemisphere.** The
   *    `SphereGeometry` version of this read as vertical *strips* — its quads
   *    split into near-coplanar triangles, so the crease pass culled every
   *    diagonal and left only rings and meridians. `geoDome` slices an icosphere
   *    instead: every strut survives, and the triangulation is the whole point
   *    of drawing a geodesic. Detail stays at 1 (see `geoDome`).
   * 2. **Scaffold ring.** Open rectangular bays around the perimeter (depot wall
   *    gauge ~0.12–0.14), low height, outer radius hugging scaffoldDeck ±0.78.
   *    Inner seat/sill under the glass base so the dome rests on the ring.
   * 3. **Fewer parts.** Ring bays + seat + shell. No door greeble.
   * 4. **Footprint** hugs scaffoldDeck (±0.775). Nothing thinner than ~0.07.
   */
  const DOME_RING_R = 0.72; // panel centerline → outer ≈ ±0.785
  const DOME_BEAM = 0.13; // depot frame gauge (bay walls 0.14, core beams 0.15)
  const DOME_RING_H = 0.28;
  const DOME_RING_Y0 = 0.05;
  const DOME_RING_TOP = DOME_RING_Y0 + DOME_RING_H; // shell base / seat top
  const DOME_SHELL_R = 0.70; // ≤ ring outer so the skirt reads in plan
  const DOME_N = 10; // multi-bay skirt (concept ~10–12 open frames)

  // Sliced icosphere. Cut a touch above the equator: the plate's dome is a
  // little shallower than a half-ball, and the shorter skirt stops the lowest
  // struts from diving behind the ring where they read as clutter.
  const domeShell = geoDome(DOME_SHELL_R, 1, DOME_SHELL_R * 0.12);
  // Base on ring top; crown ≈ ring top + 0.88·R ≈ 0.95 (clear apex, not a ball).
  domeShell.translate(0, DOME_RING_TOP, 0);

  const domeParts: PartSpec[] = [];
  // Open rectangular scaffold bays — EdgesGeometry of each box reads as a
  // wireframe cell, same grammar as the concept plate's skirt frames.
  for (let i = 0; i < DOME_N; i++) {
    const a = (i + 0.5) * ((Math.PI * 2) / DOME_N);
    const chord = 2 * DOME_RING_R * Math.sin(Math.PI / DOME_N);
    domeParts.push({
      geo: box(chord * 0.94, DOME_RING_H, DOME_BEAM),
      x: Math.sin(a) * DOME_RING_R,
      y: DOME_RING_Y0 + DOME_RING_H * 0.5,
      z: Math.cos(a) * DOME_RING_R,
      ry: a,
    });
  }
  // Inner seat — short sill the glass rests on (not a filled deck).
  domeParts.push({
    geo: cyl(0.54, 0.60, 0.12, 10),
    y: DOME_RING_TOP - 0.06,
  });
  domeParts.push({ geo: domeShell, y: 0 });
  const domeKit = kitFromSpecs(domeParts);
  const dome = domeKit.solid;

  /**
   * Raider Bay — an open servicing stall, **deliberately roofless**. This is the
   * decision that must not be undone: an earlier version slung the building mass
   * overhead on a gantry and the top-down render showed it burying its own parked
   * raider. The match camera looks *down*; a roof hides the one part of this
   * building worth reading. Everything tall on this mesh is therefore pushed to
   * -Z, behind the raider's tail, where it can never fall across the stall.
   *
   * The rest follows the same doctrine as the rover and the core station:
   *
   * 1. **The deck is not a brick.** It used to be a solid 1.35 plate sitting on
   *    the (also solid) scaffold deck — two stacked slabs, no internal line, a
   *    filled square in plan. Now the pan is recessed and two hardstand rails run
   *    fore-aft on top of it, on the raider's exact wheel tracks (x ±0.4565,
   *    derived from the unit's ±0.50 through the 0.913 park scale). From above
   *    you read rails, then floor 0.06 under them, then the machine standing on
   *    the rails — and when the stall is empty the tracks still say what parks
   *    here.
   * 2. **The side walls are frames, not slabs.** A low solid sill to 0.41, then
   *    posts and a cap rail with daylight between them. The old 0.70 slab walls
   *    were taller than the parked raider's deck line and hid its flanks from the
   *    match camera, which is the roof mistake again, just sideways. The cap rail
   *    tops out at 0.71 against the parked raider's cabin/dish line, so the
   *    closed deck, cabin and stalked dish all clear the wall line.
   * 3. **Ordnance lives outboard, in pairs.** The old single rack hung in mid-air
   *    off the left wall — unsupported, and asymmetric, which Operators are not.
   *    Two magazines now bolt to the outside of the sills on deck-edge brackets.
   *    They also stop the plan silhouette from being a plain square, so the bay
   *    reads apart from the Depot at a glance.
   *
   * Deck footprint stays inside the scaffoldDeck's ±0.674 (pan is ±0.67); only
   * the flank magazines and the apron lip overhang, which is the point of them.
   * Nothing thinner than 0.07 model units (≈0.08 world at build scale 1.15).
   */
  const barracksKit = kitFromSpecs([
    { geo: box(1.34, 0.13, 1.34), y: 0.065 }, // recessed stall pan
    { geo: box(0.2, 0.06, 1.2), x: 0.4565, y: 0.16 }, // hardstand rails, on the
    { geo: box(0.2, 0.06, 1.2), x: -0.4565, y: 0.16 }, //   raider's wheel tracks
    { geo: box(1.34, 0.07, 0.09), y: 0.165, z: 0.635 }, // apron lip
    { geo: box(0.08, 0.22, 1.22), x: 0.63, y: 0.3 }, // stall sills
    { geo: box(0.08, 0.22, 1.22), x: -0.63, y: 0.3 },
    { geo: box(0.09, 0.31, 0.13), x: 0.63, y: 0.555, z: 0.5 }, // wall posts
    { geo: box(0.09, 0.31, 0.13), x: -0.63, y: 0.555, z: 0.5 },
    { geo: box(0.09, 0.31, 0.13), x: 0.63, y: 0.555, z: -0.5 },
    { geo: box(0.09, 0.31, 0.13), x: -0.63, y: 0.555, z: -0.5 },
    { geo: box(0.08, 0.08, 1.22), x: 0.63, y: 0.67 }, // cap rails
    { geo: box(0.08, 0.08, 1.22), x: -0.63, y: 0.67 },
    { geo: box(0.11, 0.06, 0.14), x: 0.72, y: 0.16, z: -0.14 }, // magazine brackets
    { geo: box(0.11, 0.06, 0.14), x: -0.72, y: 0.16, z: -0.14 },
    { geo: box(0.13, 0.3, 0.52), x: 0.735, y: 0.34, z: -0.14 }, // flank magazines
    { geo: box(0.13, 0.3, 0.52), x: -0.735, y: 0.34, z: -0.14 },
    { geo: box(1.32, 0.62, 0.11), y: 0.5, z: -0.615 }, // rear blast wall
    { geo: box(1.32, 0.09, 0.2), y: 0.855, z: -0.615 }, // blast wall cap beam
    { geo: box(0.62, 0.24, 0.28), y: 1.02, z: -0.6 }, // arming head — behind the
    { geo: box(0.09, 0.34, 0.09), y: 1.31, z: -0.6 }, //   tail, never over it
    { geo: box(0.16, 0.1, 0.16), y: 1.53, z: -0.6 }, // dispatch beacon
  ]);
  const barracks = barracksKit.solid;

  /**
   * Turret — short-stub ground hardpoint. Hex pedestal + rotating head + stub
   * barrel + phosphor sight ring. Barrel stays short so Artillery can own length
   * later (artillery currently aliases this geo in-match). Pedestal + head + stub
   * is the clean match-camera read. Nothing thinner than 0.07.
   *
   * Concept plate: stepped hex frustum base, armored cupola, two-stage stub
   * muzzle. No eye/lens — sight is a flush ring collar on the crown.
   */
  const turretKit = kitFromSpecs([
    // hex pedestal: stepped frustum (wide foot → body → race collar)
    { geo: cyl(0.52, 0.64, 0.14, 6), y: 0.07 },
    { geo: cyl(0.42, 0.52, 0.20, 6), y: 0.24 },
    { geo: cyl(0.32, 0.38, 0.12, 6), y: 0.40 },
    // swivel neck under the head
    { geo: cyl(0.26, 0.30, 0.14, 6), y: 0.53 },
    // armored rotating head — slightly longer in Z than X; rear bustle
    { geo: box(0.56, 0.34, 0.54), y: 0.77 },
    { geo: box(0.38, 0.22, 0.14), y: 0.72, z: -0.32 },
    { geo: box(0.36, 0.12, 0.30), y: 1.0 }, // crown plate
    // short stub barrel — two-stage; head face ≈ z 0.27, total poke ≈ 0.36
    { geo: cyl(0.09, 0.10, 0.26, 6), y: 0.77, z: 0.40, rx: Math.PI / 2 },
    { geo: cyl(0.065, 0.07, 0.14, 6), y: 0.77, z: 0.58, rx: Math.PI / 2 },
    // phosphor sight ring — flush collar on the crown, not a lens barrel
    { geo: cyl(0.11, 0.13, 0.07, 8), y: 1.1 },
  ]);
  const turret = turretKit.solid;

  /**
   * Interceptor Net (AA) — open four-legged lattice tower with twin vertical
   * launcher rails. Concept plate is lattice + rails; the old mesh was a solid
   * 4-sided cone. Rails are the hero silhouette at match zoom; the tracking
   * dish stays small so it never reads as a dish farm (EM Array owns that).
   * Open truss language matches the core mast (few tall bays, min ~0.07).
   */
  const aaParts: PartSpec[] = [];
  {
    const footR = 0.8;
    const cageR = 0.27; // half-side of square cage (chords at ±cageR)
    const cageY0 = 0.3;
    const cageY1 = 1.04;
    const platY = 1.12;
    const railTop = 2.02;
    const chord = 0.1;
    const brace = 0.085;
    const corners: readonly (readonly [number, number])[] = [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ];

    // Foot pads
    for (const [sx, sz] of corners) {
      aaParts.push({
        geo: box(0.18, 0.08, 0.18),
        x: sx * footR,
        y: 0.04,
        z: sz * footR,
      });
    }

    // Splayed outrigger legs: foot → upper cage corner
    for (const [sx, sz] of corners) {
      const x0 = sx * footR;
      const z0 = sz * footR;
      const y0 = 0.08;
      const x1 = sx * cageR;
      const z1 = sz * cageR;
      const y1 = cageY1 - 0.04;
      const dx = x1 - x0;
      const dy = y1 - y0;
      const dz = z1 - z0;
      const horiz = Math.hypot(dx, dz);
      const len = Math.hypot(horiz, dy);
      aaParts.push({
        geo: box(chord, len, chord),
        x: (x0 + x1) / 2,
        y: (y0 + y1) / 2,
        z: (z0 + z1) / 2,
        rx: Math.atan2(horiz, dy),
        ry: Math.atan2(dx, dz),
      });
    }

    // Lower undercroft X — daylight under the cage, same grammar as core base
    {
      const xLen = footR * 2 * Math.SQRT2 * 0.72;
      aaParts.push({ geo: box(xLen, brace, brace), y: 0.2, ry: Math.PI / 4 });
      aaParts.push({ geo: box(xLen, brace, brace), y: 0.2, ry: -Math.PI / 4 });
    }

    // Socket hub under the cage (legs land here)
    aaParts.push({ geo: box(0.28, 0.12, 0.28), y: cageY0 - 0.02 });

    // Square lattice cage — 4 vertical chords
    for (const [sx, sz] of corners) {
      aaParts.push({
        geo: box(chord, cageY1 - cageY0, chord),
        x: sx * cageR,
        y: (cageY0 + cageY1) / 2,
        z: sz * cageR,
      });
    }

    // Horizontal belts at bottom / mid / top
    const side = cageR * 2;
    for (const by of [cageY0, (cageY0 + cageY1) / 2, cageY1]) {
      aaParts.push({ geo: box(side + chord, brace, chord), y: by, z: cageR });
      aaParts.push({ geo: box(side + chord, brace, chord), y: by, z: -cageR });
      aaParts.push({ geo: box(chord, brace, side + chord), x: cageR, y: by });
      aaParts.push({ geo: box(chord, brace, side + chord), x: -cageR, y: by });
    }

    // Face diagonals — 2 tall bays, one alternating brace each (core mast rule)
    {
      const bays = 2;
      const bayH = (cageY1 - cageY0) / bays;
      const braceLen = Math.hypot(side, bayH);
      const braceTilt = Math.atan2(side, bayH);
      for (let b = 0; b < bays; b++) {
        const yMid = cageY0 + bayH * (b + 0.5);
        const s0 = b % 2 === 0 ? 1 : -1;
        const s1 = -s0;
        // ±Z faces: tilt in X (rz)
        aaParts.push({
          geo: box(brace, braceLen, brace),
          y: yMid,
          z: cageR,
          rz: s0 * braceTilt,
        });
        aaParts.push({
          geo: box(brace, braceLen, brace),
          y: yMid,
          z: -cageR,
          rz: s1 * braceTilt,
        });
        // ±X faces: tilt in Z (rx)
        aaParts.push({
          geo: box(brace, braceLen, brace),
          x: cageR,
          y: yMid,
          rx: s0 * braceTilt,
        });
        aaParts.push({
          geo: box(brace, braceLen, brace),
          x: -cageR,
          y: yMid,
          rx: s1 * braceTilt,
        });
      }
    }

    // Platform: thin deck + open frame ring (rails mount here)
    const pr = cageR + 0.08;
    aaParts.push({ geo: box(pr * 2, 0.07, pr * 2), y: platY - 0.02 });
    aaParts.push({ geo: box(pr * 2 + chord, brace, chord), y: platY + 0.04, z: pr });
    aaParts.push({ geo: box(pr * 2 + chord, brace, chord), y: platY + 0.04, z: -pr });
    aaParts.push({ geo: box(chord, brace, pr * 2 + chord), x: pr, y: platY + 0.04 });
    aaParts.push({ geo: box(chord, brace, pr * 2 + chord), x: -pr, y: platY + 0.04 });

    // Twin vertical launcher rails (HERO) — dual-tube each side
    {
      const railH = railTop - platY;
      const railY = (platY + railTop) / 2;
      for (const rx of [0.175, -0.175]) {
        for (const rz of [0.055, -0.055]) {
          aaParts.push({ geo: box(0.09, railH, 0.09), x: rx, y: railY, z: rz });
        }
        // pair cross-links
        aaParts.push({ geo: box(0.08, 0.08, 0.15), x: rx, y: platY + railH * 0.32 });
        aaParts.push({ geo: box(0.08, 0.08, 0.15), x: rx, y: platY + railH * 0.68 });
        // top cap
        aaParts.push({ geo: box(0.12, 0.08, 0.18), x: rx, y: railTop });
      }
    }

    // Small tracking dish — pedestal + shallow bowl, secondary to rails
    aaParts.push({ geo: cyl(0.055, 0.07, 0.14, 6), y: platY + 0.12, z: 0.02 });
    aaParts.push({
      geo: cyl(0.15, 0.04, 0.07, 8),
      y: platY + 0.26,
      z: 0.1,
      rx: -0.6,
    });
    aaParts.push({
      geo: box(0.07, 0.07, 0.09),
      y: platY + 0.3,
      z: 0.16,
      rx: -0.6,
    });
  }
  const aaKit = kitFromSpecs(aaParts);
  const aa = aaKit.solid;

  /**
   * Logistics Hub (sim kind `factory` — Ops aliases this geo). Cargo yard on an
   * open square scaffold: faceted flat-roofed warehouse aft, racked cargo crates
   * on the forward apron, rigid transfer gantry with a claw, radio mast + dish.
   *
   * Concept plate `operators/logistics.jpg` + catalog: "Logistics hub on an open
   * square scaffold: flat-roofed block, racked cargo cans clamped down, a rigid
   * transfer gantry, radio mast." Match camera looks down, so:
   *
   * 1. **Scaffold is a frame, not a brick.** Corner posts, perimeter rails, mid
   *    joists — daylight in the bays. Distinct from depot's solid apron.
   * 2. **Warehouse is a faceted angular block** (stacked/chamfered mass), aft on
   *    -Z, flat or shallow-pitch roof — not a plain cube or second tower.
   * 3. **Clear crate grid** on the forward apron: body + slight lid thickness,
   *    2×3, readable as cargo first from above.
   * 4. **Rigid transfer arm + claw.** Column + boom + two-prong grabber over the
   *    cans. Concept has an articulated arm; at icon scale multi-joint spaghetti
   *    collapses, so this is the rigid transfer silhouette with a visible claw.
   * 5. **Radio mast** lattice-ish (spar + crossed braces) + dish on the roof —
   *    never over the cans.
   *
   * Footprint ~±0.78. Nothing thinner than 0.07. Distinct from depot (garage +
   * ramp), barracks (roofless stall), command, refinery.
   */
  const factoryKit = kitFromSpecs([
    // ── open square scaffold ─────────────────────────────────────────────
    { geo: box(0.12, 0.3, 0.12), x: 0.72, y: 0.15, z: 0.72 }, // corner posts
    { geo: box(0.12, 0.3, 0.12), x: -0.72, y: 0.15, z: 0.72 },
    { geo: box(0.12, 0.3, 0.12), x: 0.72, y: 0.15, z: -0.72 },
    { geo: box(0.12, 0.3, 0.12), x: -0.72, y: 0.15, z: -0.72 },
    { geo: box(1.56, 0.1, 0.12), y: 0.35, z: 0.72 }, // perimeter rails
    { geo: box(1.56, 0.1, 0.12), y: 0.35, z: -0.72 },
    { geo: box(0.12, 0.1, 1.56), x: 0.72, y: 0.35 },
    { geo: box(0.12, 0.1, 1.56), x: -0.72, y: 0.35 },
    { geo: box(1.44, 0.08, 0.1), y: 0.32, z: 0.18 }, // mid joists — daylight bays
    { geo: box(1.44, 0.08, 0.1), y: 0.32, z: -0.22 },
    { geo: box(0.1, 0.08, 1.44), x: 0, y: 0.32 },
    { geo: box(0.08, 0.22, 0.08), x: 0.36, y: 0.18, z: 0.72, rz: 0.55 },
    { geo: box(0.08, 0.22, 0.08), x: -0.36, y: 0.18, z: 0.72, rz: -0.55 },

    // ── faceted warehouse block (aft) ────────────────────────────────────
    // Stacked mass with forward chamfer + stepped roof so plan/side read
    // angular (concept beveled hull), not a single barn cube.
    { geo: box(1.16, 0.48, 0.68), y: 0.64, z: -0.32 }, // main body
    { geo: box(1.02, 0.28, 0.22), y: 0.58, z: 0.08 }, // loading face toward cans
    { geo: box(0.92, 0.22, 0.16), y: 0.78, z: 0.02, rx: -0.35 }, // forward bevel plate
    { geo: box(1.08, 0.14, 0.58), y: 0.95, z: -0.30 }, // roof shoulder
    { geo: box(0.92, 0.12, 0.48), y: 1.08, z: -0.34 }, // flat roof cap
    { geo: box(0.30, 0.1, 0.26), x: -0.36, y: 1.18, z: -0.42 }, // roof equipment hump

    // ── cargo crate grid (forward apron) ─────────────────────────────────
    { geo: box(1.12, 0.08, 0.58), y: 0.4, z: 0.38 }, // rack deck
    // 2×3 crates — body + lid lip so they read as cans, not featureless boxes
    { geo: box(0.26, 0.14, 0.20), x: -0.34, y: 0.51, z: 0.24 },
    { geo: box(0.28, 0.07, 0.22), x: -0.34, y: 0.615, z: 0.24 }, // lid
    { geo: box(0.26, 0.14, 0.20), x: 0, y: 0.51, z: 0.24 },
    { geo: box(0.28, 0.07, 0.22), x: 0, y: 0.615, z: 0.24 },
    { geo: box(0.26, 0.14, 0.20), x: 0.34, y: 0.51, z: 0.24 },
    { geo: box(0.28, 0.07, 0.22), x: 0.34, y: 0.615, z: 0.24 },
    { geo: box(0.26, 0.15, 0.20), x: -0.34, y: 0.515, z: 0.5 },
    { geo: box(0.28, 0.07, 0.22), x: -0.34, y: 0.625, z: 0.5 },
    { geo: box(0.26, 0.14, 0.20), x: 0, y: 0.51, z: 0.5 },
    { geo: box(0.28, 0.07, 0.22), x: 0, y: 0.615, z: 0.5 },
    { geo: box(0.26, 0.15, 0.20), x: 0.34, y: 0.515, z: 0.5 },
    { geo: box(0.28, 0.07, 0.22), x: 0.34, y: 0.625, z: 0.5 },
    // clamp bars pinning the crate rows
    { geo: box(1.02, 0.07, 0.08), y: 0.69, z: 0.24 },
    { geo: box(1.02, 0.07, 0.08), y: 0.70, z: 0.5 },
    // end stops at the rack lip
    { geo: box(0.08, 0.12, 0.52), x: 0.52, y: 0.5, z: 0.38 },
    { geo: box(0.08, 0.12, 0.52), x: -0.52, y: 0.5, z: 0.38 },

    // ── rigid transfer gantry + claw ─────────────────────────────────────
    // Column on the starboard edge, boom over the can lane, two-prong claw
    // (concept articulated arm → icon-scale rigid transfer with visible grabber).
    { geo: box(0.12, 0.82, 0.12), x: 0.56, y: 0.86, z: 0.38 }, // column
    { geo: box(0.2, 0.12, 0.2), x: 0.56, y: 1.32, z: 0.38 }, // column cap
    { geo: box(1.0, 0.11, 0.12), x: 0.08, y: 1.32, z: 0.38 }, // boom
    { geo: box(0.14, 0.1, 0.14), x: -0.36, y: 1.26, z: 0.38 }, // trolley
    { geo: box(0.09, 0.2, 0.09), x: -0.36, y: 1.1, z: 0.38 }, // hoist post
    { geo: box(0.22, 0.08, 0.16), x: -0.36, y: 0.96, z: 0.38 }, // claw base
    { geo: box(0.07, 0.16, 0.07), x: -0.44, y: 0.86, z: 0.38 }, // claw prong L
    { geo: box(0.07, 0.16, 0.07), x: -0.28, y: 0.86, z: 0.38 }, // claw prong R

    // ── radio mast on the warehouse roof (lattice-ish) ───────────────────
    { geo: box(0.09, 0.48, 0.09), x: 0.26, y: 1.36, z: -0.26 }, // mast spar
    { geo: box(0.07, 0.26, 0.07), x: 0.26, y: 1.34, z: -0.26, rz: 0.55 }, // crossed braces
    { geo: box(0.07, 0.26, 0.07), x: 0.26, y: 1.34, z: -0.26, rz: -0.55 },
    { geo: box(0.07, 0.18, 0.07), x: 0.26, y: 1.68, z: -0.26 }, // tip spar
    { geo: box(0.07, 0.12, 0.07), x: 0.26, y: 1.42, z: -0.16 }, // dish mount
    { geo: cyl(0.15, 0.15, 0.07, 6), x: 0.26, y: 1.5, z: -0.14, rx: 0.55 }, // dish
  ]);
  const factory = factoryKit.solid;

  /**
   * Airpad — hexagonal VTOL pad. Hex footprint stays distinct from the square
   * scaffold family (depot / barracks). Concept plate: glowing landing ring,
   * four low tie-down clamps outside the wingspan, small control box, charge
   * spar. No landing gear on an Operators airframe — the product parks on
   * thrust, a hand's width off the deck (see PRODUCT_PARK.airpad).
   *
   * Clamps stay under the wing line *and* outside the span (flyer wing tips
   * ±0.70 → ±0.64 at park scale), or they merge with the airframe in the
   * match camera. Nothing thinner than 0.07 model units.
   *
   * Deck top y = 0.18. If that moves, retune PRODUCT_PARK.airpad.y.
   */
  const airpadKit = kitFromSpecs([
    { geo: cyl(1.0, 1.0, 0.16, 6), y: 0.1 }, // hex apron
    { geo: flatRing(0.48, 0.72, 12), y: 0.185 }, // glowing landing ring
    // Low tie-down clamps: base + cap, not tall posts (tall ones read as gear).
    { geo: box(0.16, 0.1, 0.14), x: 0.86, y: 0.23, z: 0.5 },
    { geo: box(0.16, 0.1, 0.14), x: -0.86, y: 0.23, z: 0.5 },
    { geo: box(0.16, 0.1, 0.14), x: 0.86, y: 0.23, z: -0.5 },
    { geo: box(0.16, 0.1, 0.14), x: -0.86, y: 0.23, z: -0.5 },
    { geo: box(0.12, 0.08, 0.1), x: 0.86, y: 0.32, z: 0.5 }, // clamp caps
    { geo: box(0.12, 0.08, 0.1), x: -0.86, y: 0.32, z: 0.5 },
    { geo: box(0.12, 0.08, 0.1), x: 0.86, y: 0.32, z: -0.5 },
    { geo: box(0.12, 0.08, 0.1), x: -0.86, y: 0.32, z: -0.5 },
    // Control box sits starboard of the fuselage (not under the nose). Antenna
    // reads as the pad's uplink, charge spar is the port-aft twin silhouette.
    { geo: box(0.28, 0.18, 0.22), x: 0.78, y: 0.29, z: 0.32 }, // control box
    { geo: box(0.07, 0.28, 0.07), x: 0.78, y: 0.52, z: 0.32 }, // control antenna
    { geo: box(0.07, 0.36, 0.07), x: -0.72, y: 0.38, z: -0.58 }, // charge spar
  ]);
  const airpad = airpadKit.solid;

  /**
   * Command Center — T1 tech gateway. Angular bunker on the square scaffold:
   * low wide body, wide roof plate, central sensor cylinder with collar disks,
   * lattice side pylons, front entry ramp. **No dish** — Scout Works / EM Array
   * own that identity; Command is the teleop HQ (roof + sensor stack).
   *
   * Match camera (~40–55° down) reads, in order:
   * 1. **Roof plate + sensor** — wide horizontal plane with a vertical cylinder
   *    punched through it. That pair is the teleop silhouette at icon scale.
   * 2. **Corner pylons** — four lattice A-frames outboard of the body so plan is
   *    not a plain filled square (depot apron / bay stall).
   * 3. **Ramp** — heading cue on +Z; bilateral symmetry holds on X.
   *
   * Distinct from depot (garage + apron), barracks (open stall + rails), scout
   * pad (round rail + dish). Footprint stays near scaffoldDeck ±0.775 (plinth
   * ±0.71; ramp and pylon feet may overhang). Nothing thinner than 0.07.
   */
  const commandKit = kitFromSpecs([
    // Plinth — inset from scaffold deck so the under-frame still reads
    { geo: box(1.42, 0.13, 1.42), y: 0.065 },

    // Low bunker body — wide, short. Stepped shoulder gives the faceted massing
    // the concept plate sells without a full octagon mesh.
    { geo: box(1.18, 0.42, 1.08), y: 0.34 },
    { geo: box(1.04, 0.16, 0.94), y: 0.63 },

    // Wide roof plate — proud of the body, chamfered corners (angular Operators
    // planform). Edge ribs keep the plate from vanishing to a filled blob at icon.
    {
      geo: plate(
        [
          [-0.62, -0.52],
          [-0.5, -0.6],
          [0.5, -0.6],
          [0.62, -0.52],
          [0.62, 0.52],
          [0.5, 0.6],
          [-0.5, 0.6],
          [-0.62, 0.52],
        ],
        0.1,
      ),
      y: 0.78,
    },
    { geo: box(1.28, 0.07, 0.09), y: 0.84, z: 0.56 },
    { geo: box(1.28, 0.07, 0.09), y: 0.84, z: -0.56 },
    { geo: box(0.09, 0.07, 1.08), x: 0.58, y: 0.84 },
    { geo: box(0.09, 0.07, 1.08), x: -0.58, y: 0.84 },

    // Sensor stack — central cylinder + collar disks (pushed hard for teleop).
    // Stacked collars read as instrument rings, not a dish.
    { geo: cyl(0.2, 0.24, 0.12, 8), y: 0.9 }, // socket on roof
    { geo: cyl(0.13, 0.13, 0.62, 8), y: 1.27 }, // mast
    { geo: cyl(0.24, 0.24, 0.08, 8), y: 1.08 }, // collar low
    { geo: cyl(0.22, 0.22, 0.08, 8), y: 1.28 }, // collar mid
    { geo: cyl(0.2, 0.2, 0.08, 8), y: 1.48 }, // collar high
    { geo: cyl(0.11, 0.15, 0.12, 8), y: 1.64 }, // cap

    // Side pylons — four lattice A-frames at deck corners, rising past the roof.
    // Outer post + inner post + mid tie + cap beam. Bilateral on X and Z.
    { geo: box(0.09, 1.0, 0.09), x: 0.64, y: 0.58, z: 0.64 },
    { geo: box(0.09, 1.0, 0.09), x: -0.64, y: 0.58, z: 0.64 },
    { geo: box(0.09, 1.0, 0.09), x: 0.64, y: 0.58, z: -0.64 },
    { geo: box(0.09, 1.0, 0.09), x: -0.64, y: 0.58, z: -0.64 },
    { geo: box(0.08, 0.72, 0.08), x: 0.48, y: 0.5, z: 0.48 },
    { geo: box(0.08, 0.72, 0.08), x: -0.48, y: 0.5, z: 0.48 },
    { geo: box(0.08, 0.72, 0.08), x: 0.48, y: 0.5, z: -0.48 },
    { geo: box(0.08, 0.72, 0.08), x: -0.48, y: 0.5, z: -0.48 },
    // Cap beams (diagonal across each A-frame top)
    { geo: box(0.28, 0.08, 0.08), x: 0.56, y: 1.05, z: 0.56, ry: Math.PI / 4 },
    { geo: box(0.28, 0.08, 0.08), x: -0.56, y: 1.05, z: 0.56, ry: -Math.PI / 4 },
    { geo: box(0.28, 0.08, 0.08), x: 0.56, y: 1.05, z: -0.56, ry: -Math.PI / 4 },
    { geo: box(0.28, 0.08, 0.08), x: -0.56, y: 1.05, z: -0.56, ry: Math.PI / 4 },
    // Mid cross-ties
    { geo: box(0.22, 0.07, 0.07), x: 0.56, y: 0.72, z: 0.56, ry: Math.PI / 4 },
    { geo: box(0.22, 0.07, 0.07), x: -0.56, y: 0.72, z: 0.56, ry: -Math.PI / 4 },
    { geo: box(0.22, 0.07, 0.07), x: 0.56, y: 0.72, z: -0.56, ry: -Math.PI / 4 },
    { geo: box(0.22, 0.07, 0.07), x: -0.56, y: 0.72, z: -0.56, ry: Math.PI / 4 },

    // Entry portal on +Z face
    { geo: box(0.4, 0.3, 0.12), y: 0.38, z: 0.58 },
    { geo: box(0.48, 0.08, 0.1), y: 0.56, z: 0.58 }, // lintel

    // Entry ramp — out from portal toward +Z, slightly down toward deck edge
    { geo: box(0.4, 0.08, 0.48), y: 0.16, z: 0.88, rx: -0.28 },
    { geo: box(0.07, 0.1, 0.46), x: 0.22, y: 0.22, z: 0.88, rx: -0.28 },
    { geo: box(0.07, 0.1, 0.46), x: -0.22, y: 0.22, z: 0.88, rx: -0.28 },
  ]);
  const command = commandKit.solid;

  // Scout Works (Ops drone cradle) — Operators are teleoperators before they're
  // soldiers, so the building is a ground station, not a factory: a drone rolls
  // out of the bay onto an inclined launch rail and gets flung off it (escape
  // velocity here is a few m/s), while the dish is what actually flies it.
  //
  // Round footprint stays, so top-down it can't be read as the square scaffold
  // family. The product is staged on the rail in entityBuildings (supply-capped
  // = still parked; free seat + free cap = launches). Solid mesh is the empty
  // pad so the parked unit never double-draws with a live scout.
  // Rail is a cantilever: hangar holds the rear, one mid A-strut, the launch lip
  // juts out unsupported over the apron edge. Everything else stays low so the
  // drone is the tallest thing on the pad and never gets occluded.
  const RAIL_TILT = SCOUT_PAD.railTilt;
  const scoutPadKit = kitFromSpecs([
    { geo: cyl(0.92, 0.98, 0.16, 10), y: 0.08 }, // apron
    { geo: flatRing(0.58, 0.8, 10), y: 0.165 }, // deck marking
    { geo: box(0.62, 0.34, 0.42), y: 0.33, z: -0.66 }, // hangar bay (low — drone wins)
    { geo: box(0.44, 0.24, 0.06), y: 0.34, z: -0.45 }, // bay mouth — rails run through it
    { geo: box(0.05, 0.05, 1.3), x: 0.17, y: 0.62, z: 0.02, rx: RAIL_TILT },
    { geo: box(0.05, 0.05, 1.3), x: -0.17, y: 0.62, z: 0.02, rx: RAIL_TILT },
    { geo: box(0.42, 0.04, 0.06), y: 0.857, z: 0.55, rx: RAIL_TILT }, // launch-lip tie
    { geo: box(0.07, 0.57, 0.07), x: 0.17, y: 0.44, z: 0.25 }, // mid struts
    { geo: box(0.07, 0.57, 0.07), x: -0.17, y: 0.44, z: 0.25 },
    // pilot booth — canted at the rail so it doesn't read as a second hangar
    { geo: box(0.28, 0.24, 0.3), x: 0.6, y: 0.28, z: -0.3, ry: -0.5 },
    { geo: box(0.06, 0.62, 0.06), x: -0.68, y: 0.47, z: -0.22 }, // telemetry mast
    { geo: cyl(0.16, 0.05, 0.07, 6), x: -0.68, y: 0.82, z: -0.16, rx: 0.5 }, // uplink dish
  ]);
  // CRT construction: last part is the staged drone (not in solid — live game
  // draws it dynamically so launch / supply-cap can toggle it).
  const parkedScout = makeScoutGeo();
  parkedScout.translate(0, -SCOUT_VENTRAL_Y, 0);
  const parkedPart = materializePart({
    geo: parkedScout,
    rx: RAIL_TILT,
    sx: SCOUT_PAD.parkScale,
    sy: SCOUT_PAD.parkScale,
    sz: SCOUT_PAD.parkScale,
    y: SCOUT_PAD.parkY,
    z: SCOUT_PAD.parkZ,
  });
  parkedScout.dispose();
  scoutPadKit.parts.push(parkedPart);
  scoutPadKit.edges.push(new THREE.EdgesGeometry(parkedPart, 18));
  // Empty pad for match; staged composite for mesh lab / static shots
  const scoutPad = scoutPadKit.solid;
  const scoutPadStaged = mergeGeos([scoutPad.clone(), parkedPart.clone()], true);

  /**
   * Building + its parked product, baked. Match draws the product live (it has
   * to flicker in with production and leave when the unit spawns); this is the
   * static version the mesh lab and marketing shots want.
   */
  function stage(pad: THREE.BufferGeometry, park: ProductPark, unit: THREE.BufferGeometry) {
    const posed = materializePart({
      geo: unit,
      // three.js +rx tips a +Z nose down, so a nose-up park pitch is -rx.
      rx: -(park.pitch ?? 0),
      ry: park.yaw,
      sx: park.scale,
      sy: park.scale,
      sz: park.scale,
      x: park.x,
      y: park.y,
      z: park.z,
    });
    unit.dispose();
    return mergeGeos([pad.clone(), posed], true);
  }

  // Rover body + turret are separate at runtime (the gun tracks); the staged
  // composite bakes the turret at its pivot so the parked rover isn't headless.
  const roverTurret = makeWorkerOpsTurretGeo();
  const parkedRover = mergeGeos(
    [
      makeWorkerOpsGeo(),
      materializePart({
        geo: roverTurret,
        x: ROVER_TURRET_PIVOT.x,
        y: ROVER_TURRET_PIVOT.y,
        z: ROVER_TURRET_PIVOT.z,
      }),
    ],
    true,
  );
  roverTurret.dispose();
  const depotStaged = stage(depot, PRODUCT_PARK.depot!, parkedRover);
  const barracksStaged = stage(barracks, PRODUCT_PARK.barracks!, makeRaiderGeo());
  const airpadStaged = stage(airpad, PRODUCT_PARK.airpad!, makeInterceptorGeo());
  // Bomber Works reuses airpad solid for now; stage a bomber for mesh-lab chrome.
  const bomberWorksStaged = stage(airpad, PRODUCT_PARK.bomber_works!, makeBomberGeo());

  const accent = new THREE.BoxGeometry(0.2, 0.2, 0.2);
  function crystalShard(h: number, r: number) {
    const g = new THREE.OctahedronGeometry(r, 0);
    g.scale(1, h / (r * 2), 1);
    g.translate(0, h * 0.5, 0);
    return g;
  }
  const crystalSpike = crystalShard(1.4, 0.28);
  const crystalSpikeSm = crystalShard(0.9, 0.18);
  const crystalSpikeTall = crystalShard(1.85, 0.32);

  /** Per-building part kits for CRT assembly resolve (placeables only). */
  const kits: Record<string, BuildingPartKit> = {
    extractor: extractorKit,
    depot: depotKit,
    refinery: refineryKit,
    dome: domeKit,
    barracks: barracksKit,
    turret: turretKit,
    aa: aaKit,
    factory: factoryKit,
    airpad: airpadKit,
    scout: scoutPadKit,
    scoutPad: scoutPadKit,
    command: commandKit,
  };

  return {
    pad,
    padLg,
    scaffoldDeck,
    scaffoldLeg,
    ring,
    marker,
    coreStation,
    coreHive,
    coreRocket,
    coreGem,
    coreBeam,
    coreBeamSoft,
    extractor,
    depot,
    refinery,
    dome,
    barracks,
    turret,
    aa,
    factory,
    airpad,
    scoutPad,
    /**
     * Producer + its parked product, baked for mesh lab / static chrome.
     * Match draws the empty building and stages the unit dynamically.
     */
    scoutPadStaged,
    depotStaged,
    barracksStaged,
    airpadStaged,
    bomberWorksStaged,
    command,
    accent,
    crystalSpike,
    crystalSpikeSm,
    crystalSpikeTall,
    kits,
  };
}
