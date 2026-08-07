/**
 * Procedural mesh helpers — merge part lists into BufferGeometry / CRT kits.
 * Unit and building catalogs live in unitGeos.ts / buildingGeos.ts.
 */
import * as THREE from "three";

export type PartSpec = {
  geo: THREE.BufferGeometry;
  x?: number;
  y?: number;
  z?: number;
  sx?: number;
  sy?: number;
  sz?: number;
  rx?: number;
  ry?: number;
  rz?: number;
};

/** Apply local transform; returns a new BufferGeometry. */
export function materializePart(p: PartSpec): THREE.BufferGeometry {
  const g = p.geo.clone();
  g.rotateX(p.rx ?? 0);
  g.rotateY(p.ry ?? 0);
  g.rotateZ(p.rz ?? 0);
  g.scale(p.sx ?? 1, p.sy ?? 1, p.sz ?? 1);
  g.translate(p.x ?? 0, p.y ?? 0, p.z ?? 0);
  return g;
}

/** Merge already-transformed geos. If disposeParts, disposes inputs after merge. */
export function mergeGeos(geos: THREE.BufferGeometry[], disposeParts = false): THREE.BufferGeometry {
  let vCount = 0;
  let iCount = 0;
  for (const g of geos) {
    vCount += g.attributes.position.count;
    iCount += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(vCount * 3);
  const idx = new Uint32Array(iCount);
  let vo = 0;
  let io = 0;
  let vBase = 0;
  for (const g of geos) {
    const a = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < a.count; i++) {
      pos[vo++] = a.getX(i);
      pos[vo++] = a.getY(i);
      pos[vo++] = a.getZ(i);
    }
    if (g.index) {
      for (let i = 0; i < g.index.count; i++) idx[io++] = g.index.getX(i) + vBase;
    } else {
      for (let i = 0; i < a.count; i++) idx[io++] = vBase + i;
    }
    vBase += a.count;
    if (disposeParts) g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeVertexNormals();
  return out;
}

export function mergeParts(parts: PartSpec[]): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = [];
  for (const p of parts) {
    geos.push(materializePart(p));
  }
  return mergeGeos(geos, true);
}

/** Solid + per-part geo/edges for CRT assembly resolve. */
export type BuildingPartKit = {
  solid: THREE.BufferGeometry;
  parts: THREE.BufferGeometry[];
  edges: THREE.BufferGeometry[];
};

export function kitFromSpecs(specs: PartSpec[], crease = 18): BuildingPartKit {
  const parts = specs.map(materializePart);
  const solid = mergeGeos(
    parts.map((g) => g.clone()),
    true,
  );
  const edges = parts.map((g) => new THREE.EdgesGeometry(g, crease));
  return { solid, parts, edges };
}

// ── Common primitives ────────────────────────────────────────────────

export const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
export const cyl = (rt: number, rb: number, h: number, s = 6) =>
  new THREE.CylinderGeometry(rt, rb, h, s);
export const cone = (r: number, h: number, s = 5) => new THREE.ConeGeometry(r, h, s);
export const sph = (r: number) => new THREE.SphereGeometry(r, 6, 5);
export const ico = (r: number, d = 0) => new THREE.IcosahedronGeometry(r, d);

export function flatHex(r: number) {
  const g = new THREE.CircleGeometry(r, 6);
  g.rotateX(-Math.PI / 2);
  return g;
}

/** One horizontal slice of a lofted hull. */
export type HullRing = {
  /** Slice centre height. */
  y: number;
  /** Slice thickness in Y. */
  t: number;
  /** Planform scale for this slice (1 = the reference outline). */
  sx?: number;
  sz?: number;
};

/**
 * Chamfered hull — one planform sliced into stacked plates of varying width.
 *
 * A single `plate` has vertical sides, so however good its outline is the body
 * reads as a slab: flat top, flat bottom, hard 90° flanks catching light along
 * their whole length. That is the "blocky" failure, and no amount of work on
 * the *plan* outline fixes it, because the problem is the section.
 *
 * Stacking narrow → wide → narrow slices gives a faceted section instead: the
 * flanks break into bands that fall away above and below the beam line, which
 * is what a rounded fuselage looks like once you low-poly it. Pulling `sz` in
 * on the outer slices rounds the *profile* at the same time, so the nose and
 * tail taper in all three axes rather than ending in a wall.
 *
 * Three slices is the minimum that reads as chamfered; five is the most worth
 * paying for — beyond that the wire turns into a contour map at match zoom.
 *
 * Returns specs rather than a merged geo so callers fold these into their own
 * `mergeParts` alongside the rest of the machine.
 */
export function loftRings(
  pts: readonly (readonly [number, number])[],
  rings: readonly HullRing[],
  zPivot = 0,
): PartSpec[] {
  return rings.map((r) => {
    const sx = r.sx ?? 1;
    const sz = r.sz ?? 1;
    const scaled = pts.map(
      ([x, z]) => [x * sx, zPivot + (z - zPivot) * sz] as [number, number],
    );
    return { geo: plate(scaled, r.t), y: r.y };
  });
}

/**
 * Geodesic dome cap — icosphere sliced by the plane `y = cutY`, upper part kept,
 * translated so the cut sits at y=0.
 *
 * A lat/long `SphereGeometry` hemisphere is *not* a substitute here. Its quads
 * split into near-coplanar triangle pairs, so `EdgesGeometry` culls every
 * diagonal at any sane crease angle and what survives is rings + meridians —
 * a barrel of strips, not a geodesic. An icosphere's faces all meet at real
 * dihedral angles, so every strut survives and the triangulation *is* the read.
 *
 * `detail` 1 (80 faces) is the working depth: at 2 the dihedrals fall under an
 * 18° crease and the lattice dissolves back into a blob.
 *
 * Slicing (rather than scaling a whole sphere) is what gives a level base to
 * seat on a ring, and it keeps the struts evenly sized instead of squashing
 * them toward the equator.
 */
export function geoDome(r: number, detail = 1, cutY = 0) {
  const src = new THREE.IcosahedronGeometry(r, detail);
  const pos = src.attributes.position as THREE.BufferAttribute;
  const out: number[] = [];
  const at = (i: number): [number, number, number] => [pos.getX(i), pos.getY(i), pos.getZ(i)];

  for (let f = 0; f < pos.count; f += 3) {
    const tri = [at(f), at(f + 1), at(f + 2)];
    // Sutherland–Hodgman against the half-space y >= cutY.
    const kept: [number, number, number][] = [];
    for (let i = 0; i < 3; i++) {
      const a = tri[i]!;
      const b = tri[(i + 1) % 3]!;
      const da = a[1] - cutY;
      const db = b[1] - cutY;
      if (da >= 0) kept.push(a);
      if (da >= 0 !== db >= 0) {
        const t = da / (da - db);
        kept.push([a[0] + (b[0] - a[0]) * t, cutY, a[2] + (b[2] - a[2]) * t]);
      }
    }
    for (let i = 2; i < kept.length; i++) {
      out.push(...kept[0]!, ...kept[i - 1]!, ...kept[i]!);
    }
  }
  src.dispose();

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(out, 3));
  g.translate(0, -cutY, 0);
  g.computeVertexNormals();
  return g;
}

export function flatRing(inner: number, outer: number, seg = 16) {
  const g = new THREE.RingGeometry(inner, outer, seg);
  g.rotateX(-Math.PI / 2);
  return g;
}

/**
 * Flat polygon plate: `pts` are [x, z] in the XZ plane (either winding), extruded
 * `thick` along Y and centered on y=0 so it places like box(). Concave outlines
 * are fine — this is how the swept/notched planforms get built.
 */
export function plate(pts: readonly (readonly [number, number])[], thick: number) {
  const shape = new THREE.Shape();
  shape.moveTo(pts[0]![0], -pts[0]![1]);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i]![0], -pts[i]![1]);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false });
  g.rotateX(-Math.PI / 2); // shape XY → world XZ, extrude depth → +Y
  g.translate(0, -thick / 2, 0);
  return g;
}
