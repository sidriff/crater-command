/**
 * Bake catalog thumbnails from live geos.
 * Regenerated each mesh-lab open so thumbs track geo edits without a file pipeline.
 */
import { MESHES, type MeshPacks } from "./catalog";
import { MeshViewer } from "./viewer";

const THUMB_PX = 144;

/** mesh id → PNG data URL */
export type MeshThumbMap = Record<string, string>;

/**
 * Offscreen MeshViewer pass: one frame per catalog entry, black + phosphor.
 * Safe to call after createPacks(); disposes its own viewer.
 */
export function bakeMeshThumbs(
  packs: MeshPacks,
  size = THUMB_PX,
): MeshThumbMap {
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = [
    "position:fixed",
    "left:-10000px",
    "top:0",
    `width:${size}px`,
    `height:${size}px`,
    "overflow:hidden",
    "pointer-events:none",
  ].join(";");
  document.body.appendChild(host);

  const view = new MeshViewer({ container: host });
  view.setAutoSpin(false);
  view.setShowGround(false);
  view.setShowHull(true);
  view.setShowWire(true);

  const out: MeshThumbMap = {};
  for (const m of MESHES) {
    try {
      view.setMesh(m, packs);
      view.fitFraming();
      out[m.id] = view.snapshotDataUrl(size);
    } catch {
      /* leave missing — card shows placeholder */
    }
  }

  view.dispose();
  host.remove();
  return out;
}
