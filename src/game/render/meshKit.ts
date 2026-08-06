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
