import * as THREE from "three";
import {
  DIST_MAX,
  DIST_MIN,
  EL_MAX,
  EL_MIN,
  ORBIT_SENS,
  PAN_MOM_MAX,
  PAN_SCROLL,
} from "./planetMath";

export type PlanetInputHost = {
  container: HTMLElement;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  globeMesh: THREE.Mesh | null;
  /** Mutable camera targets */
  azT: number;
  elT: number;
  distT: number;
  dist: number;
  panEast: THREE.Vector3;
  panNorth: THREE.Vector3;
  focus: THREE.Vector3;
  /** World-space pan velocity for fling momentum (mutated by input + view). */
  panMom: THREE.Vector3;
  projectToSurface: (v: THREE.Vector3, out: THREE.Vector3) => void;
  isUi: (t: EventTarget | null) => boolean;
};

/**
 * Bind orbit / pan / pinch on the canvas.
 * One-finger pan with mobile-style fling momentum.
 */
export function bindPlanetInput(host: PlanetInputHost): () => void {
  const el = host.renderer.domElement;
  const pointers = new Map<number, { x: number; y: number; button: number }>();
  let pinchStart: { dist: number; camDist: number } | null = null;
  let twoFingerMid: { x: number; y: number } | null = null;
  let twoFingerAngle: number | null = null;
  let lastMoveT = 0;
  let draggingPan = false;
  // recent screen-space velocity samples (px/s) for fling
  let vx = 0;
  let vy = 0;

  const panScale = () => {
    const screenH = Math.max(1, host.container.clientHeight);
    return (host.dist / screenH) * PAN_SCROLL;
  };

  const applyPan = (dx: number, dy: number) => {
    const scale = panScale();
    host.focus
      .addScaledVector(host.panEast, dx * scale)
      .addScaledVector(host.panNorth, dy * scale);
    host.projectToSurface(host.focus, host.focus);
  };

  const applyOrbit = (dx: number, dy: number) => {
    host.azT += dx * ORBIT_SENS;
    host.elT = THREE.MathUtils.clamp(host.elT + dy * ORBIT_SENS, EL_MIN, EL_MAX);
  };

  const onDown = (e: PointerEvent) => {
    if (host.isUi(e.target)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button });
    el.setPointerCapture?.(e.pointerId);
    lastMoveT = performance.now();
    vx = 0;
    vy = 0;
    // Kill coast when grabbing again
    host.panMom.set(0, 0, 0);
    draggingPan = false;

    if (pointers.size === 2) {
      const pts = [...pointers.values()];
      const a = pts[0]!;
      const b = pts[1]!;
      pinchStart = {
        dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        camDist: host.distT,
      };
      twoFingerMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      twoFingerAngle = Math.atan2(b.y - a.y, b.x - a.x);
      host.panMom.set(0, 0, 0);
    }
  };

  const onMove = (e: PointerEvent) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: prev.button });

    const now = performance.now();
    const dt = Math.max(1 / 240, Math.min(0.05, (now - lastMoveT) / 1000));
    lastMoveT = now;

    if (pointers.size >= 2) {
      host.panMom.set(0, 0, 0);
      vx = 0;
      vy = 0;
      const pts = [...pointers.values()];
      const a = pts[0]!;
      const b = pts[1]!;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      if (twoFingerAngle != null) {
        let dAng = angle - twoFingerAngle;
        if (dAng > Math.PI) dAng -= Math.PI * 2;
        if (dAng < -Math.PI) dAng += Math.PI * 2;
        host.azT += dAng;
        if (twoFingerMid) {
          host.elT = THREE.MathUtils.clamp(
            host.elT + (mid.y - twoFingerMid.y) * ORBIT_SENS,
            EL_MIN,
            EL_MAX,
          );
        }
      }
      twoFingerAngle = angle;
      twoFingerMid = mid;
      if (pinchStart) {
        host.distT = THREE.MathUtils.clamp(
          pinchStart.camDist / (d / pinchStart.dist),
          DIST_MIN,
          DIST_MAX,
        );
      }
      return;
    }

    if (pointers.size === 1) {
      const orbit = prev.button === 2 || prev.button === 1 || e.altKey || e.buttons === 2;
      if (orbit) {
        applyOrbit(dx, dy);
        host.panMom.set(0, 0, 0);
        draggingPan = false;
      } else {
        // Screen: drag right → pan content right → focus left in view: -dx
        applyPan(-dx, dy);
        draggingPan = true;
        // Screen velocity → world pan velocity along current basis
        const sx = -dx / dt;
        const sy = dy / dt;
        // Light EMA so a fling isn't a single noisy sample
        vx = vx * 0.35 + sx * 0.65;
        vy = vy * 0.35 + sy * 0.65;
        const scale = panScale();
        host.panMom
          .copy(host.panEast)
          .multiplyScalar(vx * scale)
          .addScaledVector(host.panNorth, vy * scale);
        const sp = host.panMom.length();
        if (sp > PAN_MOM_MAX) host.panMom.multiplyScalar(PAN_MOM_MAX / sp);
      }
    }
  };

  const onUp = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) {
      pinchStart = null;
      twoFingerMid = null;
      twoFingerAngle = null;
    }
    // Fling: keep panMom if we were panning with meaningful speed
    if (pointers.size === 0 && draggingPan) {
      const sp = host.panMom.length();
      if (sp < 6) host.panMom.set(0, 0, 0);
    } else if (pointers.size === 0) {
      host.panMom.set(0, 0, 0);
    }
    draggingPan = false;
  };

  const onWheel = (e: WheelEvent) => {
    if (host.isUi(e.target)) return;
    e.preventDefault();
    const scale = e.deltaMode === 1 ? 18 : e.deltaMode === 2 ? 80 : 1;
    host.distT = THREE.MathUtils.clamp(
      host.distT * Math.exp(e.deltaY * scale * 0.0014),
      DIST_MIN,
      DIST_MAX,
    );
  };
  const onCtx = (ev: Event) => ev.preventDefault();

  el.addEventListener("pointerdown", onDown);
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointercancel", onUp);
  el.addEventListener("wheel", onWheel, { passive: false });
  el.addEventListener("contextmenu", onCtx);

  return () => {
    el.removeEventListener("pointerdown", onDown);
    el.removeEventListener("pointermove", onMove);
    el.removeEventListener("pointerup", onUp);
    el.removeEventListener("pointercancel", onUp);
    el.removeEventListener("wheel", onWheel);
    el.removeEventListener("contextmenu", onCtx);
  };
}
