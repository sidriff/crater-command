/**
 * Bake Construction catalog thumbnails from live stage geos.
 * Regenerated each lab open so thumbs track geo edits.
 */
import { CARDS } from "./catalog";
import { ConstructionViewer } from "./viewer";

const THUMB_PX = 144;

/** card id → PNG data URL */
export type ConstructionThumbMap = Record<string, string>;

/**
 * Offscreen ConstructionViewer pass: mid-construct or parked unit egress.
 */
export function bakeConstructionThumbs(size = THUMB_PX): ConstructionThumbMap {
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

  const view = new ConstructionViewer({ container: host });
  view.setShowGround(false);
  view.setShowHull(true);
  view.setShowWire(true);
  view.setShowPlumes(false);
  view.setShowScaffold(true);
  view.setTint("#2dff8c");

  const out: ConstructionThumbMap = {};
  for (const c of CARDS) {
    try {
      view.setCard(c, c.mode);
      if (c.mode === "construct") {
        // Mid-kit so parts + scaffold read in the thumb
        const mid = Math.max(0.35, (c.buildTime || 8) * 0.08);
        view.setConstructTuning({ constructDur: Math.max(2, c.buildTime || 8) });
        view.applyTime(mid);
      } else {
        // Parked product on finished producer
        view.applyTime(0);
      }
      view.fitFraming();
      out[c.id] = view.snapshotDataUrl(size);
    } catch {
      /* leave missing — card shows placeholder */
    }
  }

  view.dispose();
  host.remove();
  return out;
}
