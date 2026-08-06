// TEMP verification sheet.
import * as THREE from "three";
import { makeBuildingGeos } from "@game/render/buildingGeos";
import { makeRaiderGeo } from "@game/render/unitGeos";

const VIEWS: [string, number, number][] = [
  ["3/4", 0.9, 0.42],
  ["side", 0.0, 0.1],
  ["match cam", 0.55, 1.02],
  ["plan", 0.0, 1.45],
];

const sheet = document.getElementById("sheet")!;

export function render(
  geo: THREE.BufferGeometry,
  tag: string,
  sxz: number,
  sy: number,
  dist: number,
  look = 0.5,
) {
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const edges = new THREE.EdgesGeometry(geo, 18);
  console.log(
    `${tag} W=${(bb.max.x - bb.min.x).toFixed(2)} H=${(bb.max.y - bb.min.y).toFixed(2)} ` +
      `D=${(bb.max.z - bb.min.z).toFixed(2)} segs=${edges.attributes.position.count / 2}`,
  );
  for (const [size, sizeTag] of [[300, "big"], [58, "px"]] as [number, string][]) {
    const row = document.createElement("div");
    row.className = "row";
    for (const [label, az, el] of VIEWS) {
      const cell = document.createElement("div");
      cell.className = "cell";
      const r = new THREE.WebGLRenderer({ antialias: true });
      r.setPixelRatio(1);
      r.setSize(size, size);
      r.setClearColor(0x000000, 1);
      const scene = new THREE.Scene();
      const grp = new THREE.Group();
      grp.scale.set(sxz, sy, sxz);
      grp.add(
        new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x031a10 })),
        new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x2dff8c })),
      );
      scene.add(grp, new THREE.GridHelper(8, 16, 0x0d5c38, 0x073a24));
      const cam = new THREE.PerspectiveCamera(35, 1, 0.1, 200);
      cam.position.set(
        Math.sin(az) * Math.cos(el) * dist,
        Math.sin(el) * dist,
        Math.cos(az) * Math.cos(el) * dist,
      );
      cam.lookAt(0, look, 0);
      r.render(scene, cam);
      cell.appendChild(r.domElement);
      const b = document.createElement("b");
      b.textContent = `${tag} ${sizeTag} ${label}`;
      cell.appendChild(b);
      row.appendChild(cell);
    }
    sheet.appendChild(row);
  }
}

const bg = makeBuildingGeos();
render(makeRaiderGeo(), "raider", 1.05, 1.05, 4.2, 0.4);
render(bg.barracksStaged, "bay+raider", 1.15, 1.15, 5.6, 0.5);
(window as unknown as { ccReady: boolean }).ccReady = true;
