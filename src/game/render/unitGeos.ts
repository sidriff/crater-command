/**
 * Unit mesh catalog — procedural Three.js geometries for match + labs mesh browser.
 */
import { box, cone, cyl, flatHex, loftRings, mergeParts, plate, sph } from "./meshKit";

/**
 * Operators rover turret pivot (unscaled mesh units).
 * Mast is fixed on the body; only the sensor head yaws (mining / build beam).
 * Pivot sits on the mast top, forward over the prow deck.
 */
export const ROVER_TURRET_PIVOT = { x: 0, y: 0.9, z: 0.32 };
/**
 * Beam origin in *turret-local* space — the aperture face, so the mining laser
 * leaves the hole it's drawn coming out of. Not unit space: anything working in
 * unit space has to compose it through the pivot (see `roverTipWorld`).
 */
export const ROVER_TURRET_TIP = { x: 0, y: 0.04, z: 0.34 };

/**
 * Drone (Operators scout) — teleoperated recon kite.
 *
 * Hard vacuum and ~zero g, so the delta is *not* a wing: it's a downward-looking
 * SAR / phased-array aperture, and the twin bells in the trailing-edge notch do
 * the actual flying. The notch makes the top-down silhouette an arrowhead —
 * heading reads at any zoom, and no other Operators mesh is a triangle in plan,
 * so it can't be confused with the flyer's straight wing or the square scaffold
 * family. Canted fins are pure jet-read, kept deliberately.
 *
 * No eye: the forward feature is a flush instrument aperture (LORE.md —
 * Operators signal capability, not alertness). Armament is beam VFX only.
 *
 * Shared with the Scout Works, which parks one of these on its launch rail.
 */
export function makeScoutGeo() {
  // Fin plate is authored in [height, z]; rz≈90° stands it up, thickness → X.
  const fin = () =>
    plate(
      [
        [0, 0.02],
        [0, -0.27],
        [0.28, -0.28],
        [0.26, -0.14],
      ],
      0.045,
    );

  return mergeParts([
    // aperture plate — nose at +Z, tips at ±0.55, trailing edge notched forward
    {
      geo: plate(
        [
          [0, 0.62],
          [0.55, -0.42],
          [0, -0.16],
          [-0.55, -0.42],
        ],
        0.05,
      ),
      y: 0.5,
    },
    // dorsal spine, flush on the plate — the seam is the chine line
    {
      geo: plate(
        [
          [0, 0.6],
          [0.155, -0.3],
          [-0.155, -0.3],
        ],
        0.15,
      ),
      y: 0.6,
    },
    // sensor housing + flush hex aperture
    { geo: box(0.16, 0.05, 0.34), y: 0.7, z: 0.12 },
    { geo: flatHex(0.06), y: 0.726, z: 0.12 },
    // canted twin fins
    { geo: fin(), x: 0.24, y: 0.525, rz: Math.PI / 2 - 0.22 },
    { geo: fin(), x: -0.24, y: 0.525, rz: Math.PI / 2 + 0.22 },
    // main bells, hanging in the notch — mouths aft
    { geo: cone(0.08, 0.18, 6), x: 0.1, y: 0.6, z: -0.36, rx: Math.PI / 2 },
    { geo: cone(0.08, 0.18, 6), x: -0.1, y: 0.6, z: -0.36, rx: Math.PI / 2 },
  ]);
}

/** Ventral plane of the scout in model space — mount height for the rail cradle. */
export const SCOUT_VENTRAL_Y = 0.475;

/**
 * Roll axis — the spine, level with the bells. Rolling about this instead of the
 * model origin is the difference between an aileron roll and a carnival swing.
 */
export const SCOUT_PIVOT_Y = 0.6;

/** Main bell mouths (model space) — plume apex sits here, thrust runs aft. */
export const SCOUT_BELLS = [
  { x: 0.1, y: 0.6, z: -0.45 },
  { x: -0.1, y: 0.6, z: -0.45 },
] as const;

/** Wingtip RCS ports — fire downward to torque the craft in roll / yaw. */
export const SCOUT_RCS = [
  { x: 0.5, y: 0.49, z: -0.34 },
  { x: -0.5, y: 0.49, z: -0.34 },
] as const;

/** Flyer: fuselage centerline is the roll axis; tail bells + wingtip RCS ports. */
export const FLYER_PIVOT_Y = 0.3;
export const FLYER_BELLS = [
  { x: 0.11, y: 0.3, z: -0.54 },
  { x: -0.11, y: 0.3, z: -0.54 },
] as const;
export const FLYER_RCS = [
  { x: 0.63, y: 0.24, z: -0.04 },
  { x: -0.63, y: 0.24, z: -0.04 },
] as const;

/** Interceptor: roll axis down the lifting body; aft bells + wingtip pods. */
export const INTERCEPTOR_PIVOT_Y = 0.4;
export const INTERCEPTOR_BELLS = [
  { x: 0.115, y: 0.42, z: -0.76 },
  { x: -0.115, y: 0.42, z: -0.76 },
] as const;
export const INTERCEPTOR_RCS = [
  { x: 0.585, y: 0.27, z: -0.44 },
  { x: -0.585, y: 0.27, z: -0.44 },
] as const;

/** Bomber: mains hang off the wing nacelles, not the fuselage. */
export const BOMBER_PIVOT_Y = 0.42;
export const BOMBER_BELLS = [
  { x: 0.56, y: 0.5, z: -0.56 },
  { x: -0.56, y: 0.5, z: -0.56 },
] as const;
export const BOMBER_RCS = [
  { x: 0.98, y: 0.34, z: -0.2 },
  { x: -0.98, y: 0.34, z: -0.2 },
] as const;

/**
 * Individual makers are exported so buildingGeos can stage a product on a
 * producer's apron without paying for the whole unit pack twice.
 */
export function makeWorkerGeo() {
  return mergeParts([
    { geo: box(0.55, 0.55, 0.4), y: 0.85 },
    { geo: box(0.38, 0.32, 0.32), y: 1.3 },
    { geo: box(0.14, 0.45, 0.14), x: -0.18, y: 0.35 },
    { geo: box(0.14, 0.45, 0.14), x: 0.18, y: 0.35 },
    { geo: box(0.12, 0.4, 0.12), x: -0.4, y: 0.95, rz: 0.3 },
    { geo: box(0.12, 0.4, 0.12), x: 0.4, y: 0.95, rz: -0.3 },
    { geo: box(0.22, 0.1, 0.18), y: 0.12, x: -0.18 },
    { geo: box(0.22, 0.1, 0.18), y: 0.12, x: 0.18 },
  ]);
}

/**
 * Operators worker body — open-bed mining rover, rocker-bogie chassis.
 *
 * Everything here is aimed at the *match camera*, which looks down at ~55°. Two
 * consequences drive the whole design:
 *
 * 1. **Heading has to read in plan.** So the chassis is a wedge — the prow deck
 *    tapers from ±0.45 to ±0.27 — and the mass is deliberately asymmetric fore/
 *    aft (mast + sensor forward, bed and high-gain panel aft). A rover you can't
 *    orient is a rover you can't read as fleeing, hauling, or arriving.
 * 2. **"Open bed" has to be visible from above, or it isn't open.** A solid deck
 *    plate with rails on top looks identical to a cargo brick in plan. So the bed
 *    floor is recessed below the rail line and two cross ribs sit flush with the
 *    rail tops: from the match camera you see rails, ribs, and floor *underneath*
 *    them. That stack is what sells a hollow frame.
 *
 * Nothing here is thinner than ~0.05 model units (≈0.03 world at ROVER_SCALE).
 * Below that a wireframe part stops being a shape and becomes a shimmering pair
 * of coincident lines — which is why there's a high-gain panel aft instead of the
 * antenna pin the concept plate draws.
 *
 * Rocker beams are the one bit of concept lattice worth keeping: two per side,
 * hub → mid-pivot → hub. They cost 4 boxes and they're the difference between a
 * cart and a machine built for this rock.
 *
 * Turret (sensor head) is a separate geo at ROVER_TURRET_PIVOT.
 */
export function makeWorkerOpsGeo() {
  // 6-seg wheels: crease reads the rim without a dense tire tread.
  const wheel = () => cyl(0.24, 0.24, 0.13, 6);
  // Rocker beam runs hub (z ±0.46, y 0.24) up to a mid pivot (z 0, y 0.34).
  const rockerLen = Math.hypot(0.46, 0.1);
  const rockerTilt = Math.atan2(0.1, 0.46);

  return mergeParts([
    // ── prow: the taper is the heading cue ──────────────────────────────
    { geo: plate([[0.27, 0.8], [0.45, 0.34], [-0.45, 0.34], [-0.27, 0.8]], 0.1), y: 0.3 },
    { geo: box(0.34, 0.08, 0.09), y: 0.39, z: 0.74 }, // nose instrument bar
    // ── open bed: recessed floor + rails + ribs, read as a cage in plan ──
    { geo: box(0.8, 0.08, 1.0), y: 0.29, z: -0.16 }, // floor (top 0.33)
    { geo: box(0.06, 0.3, 1.02), x: 0.45, y: 0.48, z: -0.16 }, // rails (top 0.63)
    { geo: box(0.06, 0.3, 1.02), x: -0.45, y: 0.48, z: -0.16 },
    { geo: box(0.9, 0.34, 0.07), y: 0.5, z: -0.7 }, // rear bulkhead
    { geo: box(0.9, 0.2, 0.07), y: 0.43, z: 0.32 }, // bed head wall
    { geo: box(0.96, 0.07, 0.08), y: 0.595, z: -0.1 }, // cross ribs, flush with
    { geo: box(0.96, 0.07, 0.08), y: 0.595, z: -0.44 }, //   the rail tops
    // ── running gear ────────────────────────────────────────────────────
    { geo: box(0.56, 0.16, 1.26), y: 0.17, z: -0.04 }, // drivetrain spine
    { geo: wheel(), x: 0.5, y: 0.24, z: 0.46, rz: Math.PI / 2 },
    { geo: wheel(), x: -0.5, y: 0.24, z: 0.46, rz: Math.PI / 2 },
    { geo: wheel(), x: 0.5, y: 0.24, z: -0.46, rz: Math.PI / 2 },
    { geo: wheel(), x: -0.5, y: 0.24, z: -0.46, rz: Math.PI / 2 },
    { geo: box(0.05, 0.06, rockerLen), x: 0.47, y: 0.29, z: 0.23, rx: rockerTilt },
    { geo: box(0.05, 0.06, rockerLen), x: -0.47, y: 0.29, z: 0.23, rx: rockerTilt },
    { geo: box(0.05, 0.06, rockerLen), x: 0.47, y: 0.29, z: -0.23, rx: -rockerTilt },
    { geo: box(0.05, 0.06, rockerLen), x: -0.47, y: 0.29, z: -0.23, rx: -rockerTilt },
    // ── mast: tapered 4-gon post, wide enough not to alias ───────────────
    { geo: box(0.2, 0.1, 0.22), y: 0.39, z: 0.32 }, // mount block
    { geo: cyl(0.055, 0.1, 0.5, 4), y: 0.6, z: 0.32, ry: Math.PI / 4 },
    // ── aft high-gain panel — reads at match zoom; a pin does not ────────
    { geo: box(0.06, 0.18, 0.06), x: 0.3, y: 0.72, z: -0.58 },
    { geo: box(0.3, 0.22, 0.03), x: 0.3, y: 0.87, z: -0.58, rx: -0.5 },
    // ── tail hitch: marks the back end at any zoom ───────────────────────
    { geo: box(0.24, 0.09, 0.1), y: 0.28, z: -0.74 },
  ]);
}

/**
 * Sensor head on the mast. Pivot-local; +Z is the aperture / beam axis.
 *
 * Deliberately 2.7:1 in plan (0.24 wide × 0.64 long). A head that's square in
 * plan can rotate a full 90° from the match camera and barely change silhouette
 * — which throws away the one thing the turret is for, telling you what the rover
 * is pointed at. Elongation is what makes the yaw legible from above.
 *
 * No eye: the forward feature is a flush hex aperture under a sun hood, not a
 * lens (LORE.md — Operators signal capability, not alertness).
 */
export function makeWorkerOpsTurretGeo() {
  return mergeParts([
    { geo: box(0.22, 0.17, 0.4), y: 0.05 }, // housing
    { geo: box(0.15, 0.13, 0.14), y: 0.04, z: 0.26 }, // aperture snout
    { geo: flatHex(0.055), y: 0.04, z: 0.332, rx: Math.PI / 2 },
    { geo: box(0.24, 0.025, 0.16), y: 0.135, z: 0.26 }, // sun hood
    { geo: box(0.13, 0.11, 0.1), y: 0.05, z: -0.25 }, // comms / counterweight
  ]);
}

/**
 * Raider — Operators fast light attack buggy. **Ground unit** (`defs.ts`: no
 * air, attacks ground only, range 1.4, hp 70, the fastest thing on wheels in the
 * game). The concept plate went through a spacecraft phase; ignore that. This is
 * a wheeled machine and nothing on it may read as a wing or a fin.
 *
 * Everything is aimed at the match camera (~40–55° down):
 *
 * 1. **Heading reads in plan because the planform is a dart.** Half-width runs
 *    0.12 at the nose → 0.30 at the shoulder → 0.325 at the hip → 0.245 at the
 *    transom, so the outline is acute forward and boat-tailed aft. Mass is
 *    asymmetric to match — short armored prow forward, power pack and stalked
 *    dish aft.
 * 2. **The hull top is closed, and "closed" means no ledge.** Two earlier revs
 *    failed this differently. The first left an open trough (gunwale rails +
 *    recessed pan). The second stacked a narrower deck on a wider pan, which is
 *    subtler and just as wrong: the strip of pan top left showing all the way
 *    round *is* a gunwale, and the match camera reads any continuous horizontal
 *    rim as the lip of an open tub no matter what is underneath it. So the hull
 *    is now one thick faceted slab carrying the full dart planform, with a roof
 *    inset only ~0.035 — a chamfer, ~4px at review zoom, which reads as a bevel
 *    on a solid body rather than a rail around a hole.
 * 3. **The dorsal turret is the weapon.** Not a dish on a stalk: that read as a
 *    radar mushroom, and with the prow gun gone the raider had nothing that
 *    looked like it could shoot. It is a barbette ring + hex drum + short blunt
 *    mantlet — round in plan with one square-off face, which is the universal
 *    turret read and is legible at 58px in a way a flat disk is not. There is no
 *    raider turret rig in `entityUnits`, so it is baked facing +Z and does not
 *    yaw; giving it live yaw means generalising the rover's pivot rig.
 * 4. **No front gun snout.** The prow is armour and a flush sensor hex, nothing
 *    that protrudes — no receiver, barrel, muzzle collar, or instrument bar
 *    hanging off the nose. Anything that sticks out forward reads as a gun and
 *    puts the weapon back on the wrong end of the vehicle. Heading is the dart
 *    planform, not a barrel.
 * 5. **The wheels stand off the hull on exposed cross axles.** 0.16+ of daylight
 *    each side. That gap is the whole difference between this and the tank's
 *    solid track slabs at match zoom, and it is why the raider reads light.
 * 6. **It is flat for its length.** Long and low is the "fast" read; the stalked
 *    dish is the only tall token, and it sits mid-aft so it does not hide the
 *    dart outline from above.
 *
 * Plan footprints of the three ground vehicles, at their real world scales, are
 * deliberately three different shapes: rover 0.64 × 0.91 (small, squat, open
 * rectangular bed), raider ~1.05 × 1.46 (long narrow dart), tank 1.44 × 1.66
 * (wide slab). None of them is confusable at 58px.
 *
 * No eye. The only apertures are the flush hex vent on the transom and the
 * stalked uplink/weapon dish (LORE.md — Operators signal capability, not
 * alertness). Nothing here is thinner than 0.055 model units
 * (≈0.058 world at scale 1.05).
 */
export function makeRaiderGeo() {
  const NOSE_X = 0.12;
  const NOSE_Z = 0.84;

  // Dart stations, shared by hull and roof so the two outlines agree in plan.
  const HULL: [number, number][] = [
    [NOSE_X, NOSE_Z],
    [0.3, 0.28],
    [0.325, -0.24],
    [0.245, -0.58],
    [-0.245, -0.58],
    [-0.325, -0.24],
    [-0.3, 0.28],
    [-NOSE_X, NOSE_Z],
  ];
  // Roof: the same dart drawn ~0.035 in on every edge. Inset *toward the
  // interior*, not by subtracting a constant from z — that would push the
  // transom out past the hull and hand the rim straight back. See note 2
  // before widening this.
  const ROOF: [number, number][] = [
    [0.095, 0.8],
    [0.265, 0.27],
    [0.29, -0.23],
    [0.215, -0.545],
    [-0.215, -0.545],
    [-0.29, -0.23],
    [-0.265, 0.27],
    [-0.095, 0.8],
  ];

  return mergeParts([
    // ── hull: one thick faceted slab, full dart planform ─────────────────
    { geo: plate(HULL, 0.26), y: 0.33 },
    // ── roof: closes the top, inset only enough to bevel ─────────────────
    { geo: plate(ROOF, 0.12), y: 0.52 },
    // ── prow: flush sensor hex on the nose deck. Nothing protrudes. ──────
    { geo: flatHex(0.075), y: 0.581, z: 0.5 },
    // ── aft power pack + transom vent, sunk into the roof line ───────────
    { geo: box(0.42, 0.14, 0.3), y: 0.62, z: -0.34 },
    { geo: box(0.42, 0.07, 0.14), y: 0.64, z: -0.5 },
    { geo: flatHex(0.09), y: 0.677, z: -0.5 },
    // ── dorsal turret, mid-aft: barbette + drum + blunt mantlet. Baked
    //    facing +Z; no raider turret rig in entityUnits. ─────────────────
    { geo: cyl(0.2, 0.22, 0.06, 6), y: 0.61, z: -0.02 }, // barbette ring
    { geo: cyl(0.17, 0.19, 0.16, 6), y: 0.72, z: -0.02 }, // drum
    // Mantlet has to break the drum's outline in *plan* or the turret reads as
    // a hex nut from the match camera — that flat is the facing cue.
    { geo: box(0.19, 0.13, 0.2), y: 0.71, z: 0.2 },
    { geo: cyl(0.12, 0.13, 0.05, 6), y: 0.82, z: -0.02 }, // hatch cap
    // ── running gear: cross axles carry the wheels 0.16+ clear of the hull.
    //    Front axle sits well forward (z 0.48) so the nose overhang stays
    //    short — a long unsupported prow reads as a boat, not a buggy. ─────
    //    The rear tyre, not the transom, is the aft extreme of the model
    //    (z -0.62 against the hull's -0.58) — that is what the Raider Bay's
    //    park offset has to clear, so do not push this axle back.
    { geo: box(1.0, 0.08, 0.1), y: 0.185, z: 0.48 },
    { geo: box(1.0, 0.08, 0.1), y: 0.185, z: -0.42 },
    { geo: cyl(0.2, 0.2, 0.12, 6), x: 0.5, y: 0.2, z: 0.48, rz: Math.PI / 2 },
    { geo: cyl(0.2, 0.2, 0.12, 6), x: -0.5, y: 0.2, z: 0.48, rz: Math.PI / 2 },
    { geo: cyl(0.2, 0.2, 0.12, 6), x: 0.5, y: 0.2, z: -0.42, rz: Math.PI / 2 },
    { geo: cyl(0.2, 0.2, 0.12, 6), x: -0.5, y: 0.2, z: -0.42, rz: Math.PI / 2 },
  ]);
}

export function makeTankGeo() {
  return mergeParts([
    { geo: box(1.15, 0.35, 0.85), y: 0.4 },
    { geo: box(1.25, 0.22, 0.28), y: 0.22, z: 0.4 },
    { geo: box(1.25, 0.22, 0.28), y: 0.22, z: -0.4 },
    { geo: cyl(0.32, 0.35, 0.28, 6), y: 0.72 },
    { geo: box(0.14, 0.14, 0.7), y: 0.75, z: 0.55 },
    { geo: box(0.25, 0.15, 0.2), y: 0.95 },
  ]);
}

/**
 * Shared / non-Ops air placeholder — straight-wing gunship. Ops air split into
 * Interceptor + Bomber; keep this for other factions until they get own air.
 */
export function makeFlyerGeo() {
  return mergeParts([
    { geo: box(0.35, 0.25, 0.9), y: 0.3 },
    { geo: box(1.4, 0.08, 0.4), y: 0.28 },
    { geo: cone(0.22, 0.45, 4), y: 0.3, z: 0.55, rx: Math.PI / 2 },
    { geo: box(0.12, 0.35, 0.25), y: 0.45, z: -0.35 },
    { geo: box(0.5, 0.06, 0.18), y: 0.55, z: -0.35 },
    // twin tail bells — mouths aft, matching FLYER_BELLS
    { geo: cone(0.085, 0.18, 6), x: 0.11, y: 0.3, z: -0.45, rx: Math.PI / 2 },
    { geo: cone(0.085, 0.18, 6), x: -0.11, y: 0.3, z: -0.45, rx: Math.PI / 2 },
    // wingtip RCS blisters — small, but they give the jets something to leave from
    { geo: box(0.1, 0.07, 0.16), x: 0.63, y: 0.26, z: -0.04 },
    { geo: box(0.1, 0.07, 0.16), x: -0.63, y: 0.26, z: -0.04 },
  ]);
}

/**
 * Interceptor — Operators vacuum VTOL hover fighter (Airpad product).
 *
 * Rebuilt against `operators/interceptor.jpg`. The previous rev was a box
 * fuselage with a cone taped on the nose and a wing bolted to its side, which
 * is a different aircraft from the plate in every way that matters. The plate
 * is a **lifting body**: there is no join between fuselage and wing, the nose
 * is a long fairing that grows out of the centreline, and the machine's whole
 * identity is the cranked delta plan plus two big ventral cones slung under it.
 *
 * Four things carry the read, in order of how much they cost to lose:
 *
 * 1. **Cranked delta, not a triangle.** A narrow strake runs most of the nose
 *    before the leading edge breaks outboard into the wing. The kink is what
 *    separates this from the scout, which is the other triangle-in-plan in the
 *    Ops kit — the scout is a small arrowhead with a notched trailing edge and
 *    no fuselage; this is a long cranked delta with a spine down the middle, a
 *    boat-tail sticking out past the trailing edge, and a fin standing over it.
 *    At 58px the fin and the ventral cones are the tiebreak, so neither is
 *    decoration.
 * 2. **The ventral cones are the signature.** Big (r 0.135), outboard at ±0.34,
 *    tips down. On the plate they are the first thing you see. They are sized
 *    to bottom out at unit y≈0.02 so an Airpad-parked interceptor still clears
 *    the deck resting on its thrust — do not grow them without retuning
 *    `PRODUCT_PARK.airpad.y`.
 * 3. **One tall centreline fin.** The old twin stubs read as greeble at match
 *    zoom. The plate has a single tall trapezoid and it is the only thing that
 *    gives this airframe a height silhouette.
 * 4. **Solid nose.** No canopy, no eye (LORE.md — Operators signal capability,
 *    not alertness). The plate's forward booms are below the ~0.055 minimum
 *    part gauge and are deliberately dropped rather than drawn as shimmer.
 *
 * Nothing on this airframe is a slab. The body is a `loftRings` stack, the wing
 * carries a chamfered root, and the tip pods are hex cylinders — because a
 * single extruded plate has vertical sides, and vertical sides are what made
 * every earlier rev of this read as a brick with a point on it no matter how
 * good the plan outline got. See `loftRings`.
 *
 * Main bells + wingtip pods match INTERCEPTOR_BELLS / INTERCEPTOR_RCS.
 */
export function makeInterceptorGeo() {
  // Lifting body. The nose is *in* this outline, not a cone stuck on the end —
  // the outer loft slices pull `sz` toward the pivot, which tapers the snout in
  // profile as well as plan and is what makes it a fairing instead of a spike.
  const BODY: [number, number][] = [
    [0, 0.9],
    [0.075, 0.4],
    [0.13, -0.1],
    [0.15, -0.4],
    [0.13, -0.62],
    [-0.13, -0.62],
    [-0.15, -0.4],
    [-0.13, -0.1],
    [-0.075, 0.4],
  ];
  const WING: [number, number][] = [
    [0, 0.92],
    [0.1, 0.36],
    [0.58, -0.36],
    [0.6, -0.58],
    [-0.6, -0.58],
    [-0.58, -0.36],
    [-0.1, 0.36],
  ];
  // Fin profile authored as [height, z]; rz=90° stands it up, thickness → X.
  const fin = plate(
    [
      [0, 0.22],
      [0, -0.24],
      [0.44, -0.18],
      [0.42, 0.02],
    ],
    0.06,
  );

  return mergeParts([
    // ── cranked delta, chamfered: full-span skin + thickened root ────────
    ...loftRings(
      WING,
      [
        { y: 0.29, t: 0.05 },
        { y: 0.335, t: 0.05, sx: 0.72, sz: 0.88 },
      ],
      -0.1,
    ),
    // ── lifting body: four slices, narrow → beam → narrow ────────────────
    ...loftRings(
      BODY,
      [
        { y: 0.32, t: 0.07, sx: 0.6, sz: 0.9 },
        { y: 0.4, t: 0.11 },
        { y: 0.49, t: 0.08, sx: 0.78, sz: 0.94 },
        { y: 0.56, t: 0.07, sx: 0.46, sz: 0.82 },
      ],
      -0.1,
    ),
    { geo: sph(0.055), y: 0.59, z: 0.08 }, // flush sensor blister
    // ── single tall fin ──────────────────────────────────────────────────
    { geo: fin, y: 0.53, z: -0.24, rz: Math.PI / 2 },
    // ── ventral lift cones, blended straight into the wing underside.
    //    Bases sit inside the wing skin so there is no pylon box to read as
    //    a peg; tips bottom out at y≈0.02 for the Airpad park. ────────────
    { geo: cone(0.14, 0.3, 6), x: 0.34, y: 0.17, z: 0.02, rx: Math.PI },
    { geo: cone(0.14, 0.3, 6), x: -0.34, y: 0.17, z: 0.02, rx: Math.PI },
    // ── twin aft bells — mouths aft, matching INTERCEPTOR_BELLS ──────────
    { geo: cone(0.085, 0.18, 6), x: 0.115, y: 0.42, z: -0.66, rx: Math.PI / 2 },
    { geo: cone(0.085, 0.18, 6), x: -0.115, y: 0.42, z: -0.66, rx: Math.PI / 2 },
    // ── wingtip pods: tapered hex cylinders, not boxes (RCS ports) ───────
    { geo: cyl(0.05, 0.07, 0.3, 6), x: 0.585, y: 0.31, z: -0.44, rx: Math.PI / 2 },
    { geo: cyl(0.05, 0.07, 0.3, 6), x: -0.585, y: 0.31, z: -0.44, rx: Math.PI / 2 },
  ]);
}

/**
 * Bomber — Operators heavy strike airframe (Bomber Works product).
 *
 * Rebuilt against `operators/bomber.jpg`. The previous rev was the interceptor's
 * grammar scaled up — flat slab wing, pods tucked against the fuselage, twin
 * stub verticals — and from above it read as a table. The plate is a different
 * *class* of machine, and class is carried by four things the old geo had none
 * of:
 *
 * 1. **Deep, blunt, round fuselage.** The plan outline is fat all the way to a
 *    rounded snout, and the section is a five-slice `loftRings` stack, not an
 *    extruded plate. This is the difference that mattered most: a slab body has
 *    vertical flanks running its whole length and reads as a shipping crate no
 *    matter how round you draw the plan. Bulk is the whole reason you can tell
 *    this from the interceptor at 58px, and bulk means depth in *two* axes.
 *    The snout is two tapering hex barrels rather than one flat-capped one, for
 *    the same reason — a cylinder that stops dead is another flat face.
 * 2. **Nacelles sit on the wing, well outboard.** Not pods hugging the tail.
 *    Big Z-axis cylinders straddling the wing at ±0.56 with the intake proud of
 *    the leading edge and the bell behind the trailing edge. This is the single
 *    strongest silhouette cue on the plate and it is why BOMBER_BELLS moved off
 *    the fuselage — the plumes have to leave from the nacelles or the whole read
 *    collapses back to "big fighter".
 * 3. **One tall centreline fin plus tailplane.** Same lesson as the interceptor:
 *    twin stubs vanish, a single tall fin does not.
 * 4. **Visible ordnance load.** Four munitions a side on a spanwise rack, plus
 *    tip rails. Under-wing stores are the plate's loudest "this is the bomber"
 *    statement, and they hang low enough to be seen from the match camera.
 *
 * Solid uncrewed nose — no canopy, no eye. Vacuum VTOL, no landing gear.
 * Bomber Works parks one; `PRODUCT_PARK.bomber_works.y` has to clear the
 * munitions (bottom ≈ 0.16 unit-local), not the wing.
 */
export function makeBomberGeo() {
  // Underwing munition — one forward cone per station. Readable at match zoom;
  // individual pylons would be under gauge, so a shared rack bar carries them.
  const munition = (x: number) => ({
    geo: cone(0.06, 0.32, 5),
    x,
    y: 0.22,
    z: 0.04,
    rx: Math.PI / 2,
  });

  // Fin profile authored as [height, z]; rz=90° stands it up, thickness → X.
  const fin = plate(
    [
      [0, 0.26],
      [0, -0.24],
      [0.42, -0.2],
      [0.4, 0.06],
    ],
    0.075,
  );

  const FUSE: [number, number][] = [
    [0.22, 0.78],
    [0.29, 0.46],
    [0.3, -0.28],
    [0.21, -0.74],
    [-0.21, -0.74],
    [-0.3, -0.28],
    [-0.29, 0.46],
    [-0.22, 0.78],
  ];
  // Cranked and tapered on purpose. A constant-chord wing plus a nacelle laid
  // along it merges into one rectangle in plan, which is most of what "blocky"
  // meant here — the tip has to lose chord for the outline to have any shape.
  const WING: [number, number][] = [
    [0.28, 0.38],
    [0.72, 0.28],
    [0.98, 0.04],
    [0.98, -0.26],
    [0.72, -0.4],
    [0.28, -0.48],
    [-0.28, -0.48],
    [-0.72, -0.4],
    [-0.98, -0.26],
    [-0.98, 0.04],
    [-0.72, 0.28],
    [-0.28, 0.38],
  ];

  return mergeParts([
    // ── deep fuselage: five slices, belly → beam → crown ─────────────────
    ...loftRings(FUSE, [
      { y: 0.2, t: 0.1, sx: 0.6, sz: 0.9 },
      { y: 0.29, t: 0.1, sx: 0.85, sz: 0.97 },
      { y: 0.42, t: 0.18 },
      { y: 0.55, t: 0.1, sx: 0.88, sz: 0.96 },
      { y: 0.64, t: 0.1, sx: 0.62, sz: 0.88 },
    ]),
    // ── rounded snout: two tapering barrels, no flat cap. No canopy. ─────
    { geo: cyl(0.2, 0.26, 0.18, 6), y: 0.42, z: 0.84, rx: Math.PI / 2 },
    { geo: cyl(0.1, 0.2, 0.14, 6), y: 0.42, z: 1.0, rx: Math.PI / 2 },
    { geo: sph(0.065), y: 0.71, z: 0.22 }, // flush sensor blister
    // ── wide straight wing, squared tips, thickened root. Chord is
    //    deliberately longer than the nacelle: at match zoom a wing the
    //    nacelle covers end-to-end stops reading as a wing at all. ───────
    ...loftRings(
      WING,
      [
        { y: 0.4, t: 0.07 },
        { y: 0.45, t: 0.05, sx: 0.66, sz: 0.84 },
        { y: 0.35, t: 0.05, sx: 0.66, sz: 0.84 },
      ],
      -0.05,
    ),
    // ── nacelles straddling the wing at ±0.56: flared intake proud of the
    //    leading edge, bell well behind the trailing edge ────────────────
    { geo: cyl(0.18, 0.155, 0.07, 6), x: 0.56, y: 0.5, z: 0.34, rx: Math.PI / 2 },
    { geo: cyl(0.18, 0.155, 0.07, 6), x: -0.56, y: 0.5, z: 0.34, rx: Math.PI / 2 },
    { geo: cyl(0.155, 0.17, 0.56, 6), x: 0.56, y: 0.5, z: 0.02, rx: Math.PI / 2 },
    { geo: cyl(0.155, 0.17, 0.56, 6), x: -0.56, y: 0.5, z: 0.02, rx: Math.PI / 2 },
    // bells — mouths aft, matching BOMBER_BELLS
    { geo: cone(0.15, 0.24, 6), x: 0.56, y: 0.5, z: -0.42, rx: Math.PI / 2 },
    { geo: cone(0.15, 0.24, 6), x: -0.56, y: 0.5, z: -0.42, rx: Math.PI / 2 },
    // ── single tall fin + tapered tailplane ──────────────────────────────
    { geo: fin, y: 0.62, z: -0.5, rz: Math.PI / 2 },
    {
      geo: plate(
        [
          [0.1, -0.6],
          [0.38, -0.68],
          [0.38, -0.82],
          [0.1, -0.8],
          [-0.1, -0.8],
          [-0.38, -0.82],
          [-0.38, -0.68],
          [-0.1, -0.6],
        ],
        0.07,
      ),
      y: 0.5,
    },
    // ── ordnance: spanwise rack + four stations a side ───────────────────
    { geo: box(0.6, 0.07, 0.1), x: 0.6, y: 0.29, z: 0.0 },
    { geo: box(0.6, 0.07, 0.1), x: -0.6, y: 0.29, z: 0.0 },
    munition(0.36),
    munition(0.52),
    munition(0.68),
    munition(0.84),
    munition(-0.36),
    munition(-0.52),
    munition(-0.68),
    munition(-0.84),
    // ── wingtip rails: tapered hex barrels (also the RCS ports) ──────────
    { geo: cyl(0.055, 0.075, 0.34, 6), x: 0.98, y: 0.36, z: -0.08, rx: Math.PI / 2 },
    { geo: cyl(0.055, 0.075, 0.34, 6), x: -0.98, y: 0.36, z: -0.08, rx: Math.PI / 2 },
  ]);
}

export function makeUnitGeos() {
  return {
    worker: makeWorkerGeo(),
    workerOps: makeWorkerOpsGeo(),
    workerOpsTurret: makeWorkerOpsTurretGeo(),
    raider: makeRaiderGeo(),
    tank: makeTankGeo(),
    flyer: makeFlyerGeo(),
    interceptor: makeInterceptorGeo(),
    bomber: makeBomberGeo(),
    scout: makeScoutGeo(),
    pip: sph(0.14),
    box: box(1, 1, 1),
  };
}
