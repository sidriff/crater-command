import * as THREE from "three";
import type { FloatEvent, PlayerId, SimSnapshot } from "../sim/types";
import { mapToWorld } from "./planetMath";

const FLOAT_LIFE = 1.35;

type FloaterVis = {
  id: number;
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  map: THREE.CanvasTexture;
  amountKey: string;
};

/** CRT-style rising +energy labels at deposit. */
export class PlanetFloaterLayer {
  private root = new THREE.Group();
  private pool: FloaterVis[] = [];
  private live = new Map<number, FloaterVis>();
  private texCache = new Map<string, THREE.CanvasTexture>();
  private _p = new THREE.Vector3();
  private _n = new THREE.Vector3();

  constructor(private scene: THREE.Scene) {
    this.scene.add(this.root);
    this.root.renderOrder = 20;
  }

  sync(
    snap: SimSnapshot,
    viewer: PlayerId,
    isVisible: (x: number, y: number) => boolean,
  ) {
    const keep = new Set<number>();
    for (const f of snap.floaters ?? []) {
      if (f.owner !== viewer && !isVisible(f.x, f.y)) continue;
      const age = snap.t - f.born;
      if (age < 0 || age >= FLOAT_LIFE) continue;
      keep.add(f.id);
      let vis = this.live.get(f.id);
      if (!vis) {
        vis = this.acquire(f);
        this.live.set(f.id, vis);
        this.root.add(vis.sprite);
      }
      this.place(vis, f, age);
    }
    for (const [id, vis] of this.live) {
      if (keep.has(id)) continue;
      this.live.delete(id);
      this.release(vis);
    }
  }

  private amountKey(amount: number) {
    // Ops 7.28, blight 7.42, base 7 — show one decimal only if needed
    const r = Math.round(amount * 100) / 100;
    if (Math.abs(r - Math.round(r)) < 1e-6) return `+${Math.round(r)}`;
    return `+${r.toFixed(1)}`;
  }

  private textureFor(text: string): THREE.CanvasTexture {
    let tex = this.texCache.get(text);
    if (tex) return tex;
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, 128, 64);
    // soft phosphor glow
    ctx.font = "bold 28px 'Space Mono', 'VT323', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "#00ffaa";
    ctx.shadowBlur = 12;
    ctx.fillStyle = "#00ffaa";
    ctx.fillText(text, 64, 32);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#b8ffe8";
    ctx.fillText(text, 64, 32);
    tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    this.texCache.set(text, tex);
    return tex;
  }

  private acquire(f: FloatEvent): FloaterVis {
    const key = this.amountKey(f.amount);
    const map = this.textureFor(key);
    let vis = this.pool.pop();
    if (!vis) {
      const mat = new THREE.SpriteMaterial({
        map,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        toneMapped: false,
        blending: THREE.AdditiveBlending,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.center.set(0.5, 0.2);
      sprite.renderOrder = 25;
      vis = { id: f.id, sprite, mat, map, amountKey: key };
    } else {
      vis.id = f.id;
      vis.amountKey = key;
      vis.map = map;
      vis.mat.map = map;
      vis.mat.needsUpdate = true;
      vis.sprite.visible = true;
    }
    return vis;
  }

  private release(vis: FloaterVis) {
    vis.sprite.visible = false;
    this.root.remove(vis.sprite);
    this.pool.push(vis);
  }

  private place(vis: FloaterVis, f: FloatEvent, age: number) {
    const t = age / FLOAT_LIFE;
    // ease out rise
    const rise = 0.35 + t * 2.1;
    const baseElev = f.elev ?? 1.15;
    mapToWorld(f.x, f.y, this._p);
    if (this._p.lengthSq() < 1e-12) this._n.set(0, 1, 0);
    else this._n.copy(this._p).normalize();
    vis.sprite.position.copy(this._p).addScaledVector(this._n, baseElev + rise);
    const sc = 1.35 + t * 0.35;
    vis.sprite.scale.set(sc * 1.6, sc * 0.8, 1);
    // fade in fast, hold, fade out
    let opac = 1;
    if (t < 0.12) opac = t / 0.12;
    else if (t > 0.55) opac = 1 - (t - 0.55) / 0.45;
    vis.mat.opacity = Math.max(0, Math.min(1, opac)) * 0.95;
  }

  dispose() {
    for (const vis of this.live.values()) {
      vis.mat.dispose();
    }
    for (const vis of this.pool) {
      vis.mat.dispose();
    }
    for (const tex of this.texCache.values()) tex.dispose();
    this.live.clear();
    this.pool.length = 0;
    this.texCache.clear();
    this.scene.remove(this.root);
  }
}
