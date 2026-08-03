/**
 * Lightweight title-orbit globe — raw Three.js (no R3F).
 * Loaded only after the typewriter finishes.
 */
import * as THREE from "three";
import { GLOBE_RADIUS } from "../game/sim/defs";
import { isPlanetGeometryReady, warmPlanetGeometry } from "../game/render/planetMath";

export type TitleGlobeHandle = {
  setZoom: (z: number) => void;
  dispose: () => void;
  meshReady: () => boolean;
};

export function mountTitleGlobe(container: HTMLElement): TitleGlobeHandle {
  const w = Math.max(1, container.clientWidth);
  const h = Math.max(1, container.clientHeight);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(44, w / h, 0.5, 2000);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setSize(w, h, false);
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  container.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xa8d0c0, 0.55));
  const sun = new THREE.DirectionalLight(0xfff0d8, 1.4);
  sun.position.set(60, 90, 40);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x6688aa, 0.4);
  fill.position.set(-40, -10, -60);
  scene.add(fill);

  // star points
  {
    const COUNT = 1800;
    const positions = new Float32Array(COUNT * 3);
    const colors = new Float32Array(COUNT * 3);
    const c = new THREE.Color();
    for (let i = 0; i < COUNT; i++) {
      const u = Math.random();
      const v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      const r = 420 + Math.random() * 500;
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);
      if (Math.random() < 0.12) c.set("#88ffcc");
      else if (Math.random() < 0.3) c.set("#aaccff");
      else c.set("#e8fff4");
      c.multiplyScalar(0.4 + Math.random() * 0.6);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    scene.add(
      new THREE.Points(
        geo,
        new THREE.PointsMaterial({
          size: 0.85,
          vertexColors: true,
          sizeAttenuation: true,
          transparent: true,
          opacity: 0.8,
          depthWrite: false,
          toneMapped: false,
        }),
      ),
    );
  }

  const group = new THREE.Group();
  scene.add(group);

  const stub = new THREE.Mesh(
    new THREE.IcosahedronGeometry(GLOBE_RADIUS, 2),
    new THREE.MeshBasicMaterial({
      color: "#00ffaa",
      wireframe: true,
      transparent: true,
      opacity: 0.28,
      toneMapped: false,
    }),
  );
  group.add(stub);

  let zoom = 0;
  let running = true;
  let raf = 0;
  let last = performance.now();
  let planet: THREE.Mesh | null = null;

  const placeCamera = () => {
    // Far approach → still a wide high-orbit settle (more rock in frame than play cam)
    const dist = THREE.MathUtils.lerp(GLOBE_RADIUS * 28, GLOBE_RADIUS * 3.85, zoom);
    const elev = THREE.MathUtils.lerp(0.45, 0.28, zoom);
    camera.position.set(dist * 0.5, dist * elev, dist);
    camera.lookAt(0, 0, 0);
  };
  placeCamera();

  void warmPlanetGeometry()
    .then((geo) => {
      if (!running) return;
      const mat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        flatShading: true,
        roughness: 0.85,
        metalness: 0.05,
      });
      planet = new THREE.Mesh(geo, mat);
      group.add(planet);
      const wire = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({
          color: "#00ffaa",
          wireframe: true,
          transparent: true,
          opacity: 0.08,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      group.add(wire);
      stub.visible = false;
    })
    .catch(() => {});

  const ro = new ResizeObserver(() => {
    const ww = Math.max(1, container.clientWidth);
    const hh = Math.max(1, container.clientHeight);
    camera.aspect = ww / hh;
    camera.updateProjectionMatrix();
    renderer.setSize(ww, hh, false);
  });
  ro.observe(container);

  const loop = (now: number) => {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    group.rotation.y += dt * 0.12;
    group.rotation.x = Math.sin(now * 0.00015) * 0.08;
    placeCamera();
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  return {
    setZoom(z: number) {
      zoom = THREE.MathUtils.clamp(z, 0, 1);
    },
    meshReady() {
      return isPlanetGeometryReady() || planet != null;
    },
    dispose() {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
