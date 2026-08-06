/**
 * Unit mesh catalog — procedural Three.js geometries for match + labs mesh browser.
 */
import { box, cone, cyl, flatHex, mergeParts, plate, sph } from "./meshKit";

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
 * a wheeled machine and nothing on it may read as a wing, a fin or a canopy.
 *
 * Everything is aimed at the match camera (~40–55° down):
 *
 * 1. **Heading reads in plan because the planform is a dart.** Half-width runs
 *    0.12 at the nose → 0.30 at the shoulder → 0.325 at the hip → 0.245 at the
 *    transom, so the outline is acute forward and boat-tailed aft. The old hull
 *    was a rectangle with a cone glued on the front, which is exactly the failure
 *    the rover pass diagnosed: a nose cone does not give you a heading if the
 *    plan outline is still a box. Mass is asymmetric to match — gun forward,
 *    power module and uplink aft.
 * 2. **The frame is visibly open from above.** The deck is a *trough*: a recessed
 *    pan (top 0.30) between two gunwale rails (top 0.54), with the gun bedded in
 *    the front of the trough, the power module recessed into the back of it, and
 *    a 0.42-long window of daylight between them. The two cross sleepers in that
 *    window are not decoration: without something whose edges sit 0.18 *below*
 *    the rail line the window is black on black and reads as a hole punched in
 *    the deck rather than a floor under it. Rail, sleeper, floor — that layered
 *    stack is what sells a hollow frame.
 * 3. **The wheels stand off the hull on exposed cross axles.** 0.16 of daylight
 *    each side at the rear axle, 0.20 at the front. That gap is the whole
 *    difference between this and the tank's solid track slabs at match zoom, and
 *    it is why the raider reads light: you can see through its running gear.
 * 4. **It is flat for its length.** 0.68 world tall over 1.66 long — a height:
 *    length of 0.41, against the rover's 0.64 and the tank's 0.63. Long and low
 *    is the "fast" read, and every millimetre of height would be paid for in deck
 *    legibility from above.
 *
 * Plan footprints of the three ground vehicles, at their real world scales, are
 * deliberately three different shapes: rover 0.64 × 0.91 (small, squat, open
 * rectangular bed), raider 1.18 × 1.66 (long narrow dart), tank 1.44 × 1.66
 * (wide slab). None of them is confusable at 58px.
 *
 * The gun does not yaw (there is no raider turret rig — see `entityUnits`), so it
 * is mounted fixed fore-aft and elongated ~2.9:1 in plan on purpose: it doubles
 * as the heading cue, which a squat turret pod could never do.
 *
 * No eye. The forward feature is a gun with a plain muzzle collar; the only
 * apertures are the flush hex vent on the aft deck and the flat uplink disk that
 * teleoperates the thing (LORE.md — Operators signal capability, not alertness).
 * Nothing here is thinner than 0.055 model units (≈0.058 world at scale 1.05).
 */
export function makeRaiderGeo() {
  // Shared planform. Right-hand vertices; the hull, prow and both rails are all
  // cut from these four stations so every outline in plan agrees with the others.
  const NOSE_X = 0.12;
  const NOSE_Z = 0.84;
  const SPLIT_Z = 0.6; // where the solid prow ends and the open trough begins
  const SPLIT_X = 0.197; // hull half-width at SPLIT_Z (on the nose→shoulder line)
  const RAIL_W = 0.11; // gunwale rail thickness, measured inboard in X

  return mergeParts([
    // ── hull pan: the trough floor, full dart planform ───────────────────
    {
      geo: plate(
        [
          [NOSE_X, NOSE_Z],
          [0.3, 0.28],
          [0.325, -0.24],
          [0.245, -0.58],
          [-0.245, -0.58],
          [-0.325, -0.24],
          [-0.3, 0.28],
          [-NOSE_X, NOSE_Z],
        ],
        0.1,
      ),
      y: 0.25,
    },
    // ── prow blade: solid forward of the trough, and deliberately 0.08 lower
    //    than the rail tops so the nose steps down away from the camera ────
    {
      geo: plate(
        [
          [NOSE_X, NOSE_Z],
          [SPLIT_X, SPLIT_Z],
          [-SPLIT_X, SPLIT_Z],
          [-NOSE_X, NOSE_Z],
        ],
        0.16,
      ),
      y: 0.38,
    },
    // ── gunwale rails: outer edge follows the hull, inner edge inset RAIL_W.
    //    Mirrored by hand rather than sx:-1 — the hull material is FrontSide,
    //    and a negative scale would flip the winding and punch a hole in it.
    {
      geo: plate(
        [
          [SPLIT_X, SPLIT_Z],
          [0.3, 0.28],
          [0.325, -0.24],
          [0.245, -0.58],
          [0.245 - RAIL_W, -0.58],
          [0.325 - RAIL_W, -0.24],
          [0.3 - RAIL_W, 0.28],
          [SPLIT_X - RAIL_W, SPLIT_Z],
        ],
        0.24,
      ),
      y: 0.42,
    },
    {
      geo: plate(
        [
          [-SPLIT_X, SPLIT_Z],
          [-0.3, 0.28],
          [-0.325, -0.24],
          [-0.245, -0.58],
          [-(0.245 - RAIL_W), -0.58],
          [-(0.325 - RAIL_W), -0.24],
          [-(0.3 - RAIL_W), 0.28],
          [-(SPLIT_X - RAIL_W), SPLIT_Z],
        ],
        0.24,
      ),
      y: 0.42,
    },
    // ── cross sleepers on the pan floor, 0.18 below the rail tops. Without
    //    these the open window is just black-on-black and reads as a hole in
    //    the deck rather than a floor under it. ────────────────────────────
    { geo: box(0.46, 0.06, 0.09), y: 0.33, z: 0.18 },
    { geo: box(0.46, 0.06, 0.09), y: 0.33, z: -0.02 },
    // ── gun: receiver bedded in the front of the trough, barrel lying on the
    //    prow blade. 0.26 x 0.70 in plan including the barrel. ─────────────
    { geo: box(0.26, 0.26, 0.34), y: 0.43, z: 0.44 },
    { geo: box(0.115, 0.115, 0.36), y: 0.5, z: 0.78 },
    { geo: box(0.19, 0.17, 0.08), y: 0.5, z: 0.925 }, // muzzle collar
    // ── aft: power module recessed into the trough, uplink over it ────────
    { geo: box(0.4, 0.16, 0.3), y: 0.41, z: -0.3 },
    { geo: box(0.11, 0.12, 0.11), y: 0.55, z: -0.3 },
    // Flat hex disk, not a dish on a stalk: the plate's stalked dish is a tall
    // circle that occludes the deck it sits over. Laid flat it still reads as
    // the teleoperation link — the one thing every Operators machine needs —
    // and gives the raider a plan token neither rover nor tank has.
    { geo: cyl(0.17, 0.155, 0.055, 6), y: 0.645, z: -0.3, ry: 0.26 },
    // ── transom deck, flush with the rail tops, with a flush vent ─────────
    { geo: box(0.46, 0.07, 0.16), y: 0.505, z: -0.5 },
    { geo: flatHex(0.1), y: 0.542, z: -0.5 },
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

/** Ops Airpad product — same family as flyer for now; silhouette can diverge later. */
export function makeInterceptorGeo() {
  return makeFlyerGeo();
}

/** Ops Bomber Works product — bulkier fuselage, wider wing, heavier bells. */
export function makeBomberGeo() {
  return mergeParts([
    { geo: box(0.48, 0.32, 1.15), y: 0.32 },
    { geo: box(1.75, 0.1, 0.55), y: 0.3 },
    { geo: cone(0.28, 0.5, 4), y: 0.32, z: 0.7, rx: Math.PI / 2 },
    { geo: box(0.16, 0.28, 0.35), y: 0.48, z: -0.4 },
    { geo: box(0.65, 0.08, 0.22), y: 0.58, z: -0.4 },
    { geo: cone(0.11, 0.22, 6), x: 0.14, y: 0.32, z: -0.55, rx: Math.PI / 2 },
    { geo: cone(0.11, 0.22, 6), x: -0.14, y: 0.32, z: -0.55, rx: Math.PI / 2 },
    { geo: box(0.12, 0.09, 0.2), x: 0.78, y: 0.28, z: -0.05 },
    { geo: box(0.12, 0.09, 0.2), x: -0.78, y: 0.28, z: -0.05 },
    // ventral munition bay hint
    { geo: box(0.28, 0.1, 0.45), y: 0.14, z: 0.05 },
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
