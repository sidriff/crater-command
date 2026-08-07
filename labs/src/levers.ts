export type LeverKind = "range" | "toggle";

export interface LeverDef {
  id: string;
  label: string;
  kind: LeverKind;
  /** Default for range; 0/1 for toggle */
  value: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /** What you give up by turning this. Makes the panel a design doc. */
  tradesAgainst?: string;
  section?: string;
}

export class LeverRegistry {
  private defs = new Map<string, LeverDef>();
  private values = new Map<string, number>();
  private listeners = new Set<(id: string, value: number) => void>();

  clear() {
    this.defs.clear();
    this.values.clear();
  }

  register(defs: readonly LeverDef[]) {
    for (const d of defs) {
      this.defs.set(d.id, d);
      if (!this.values.has(d.id)) this.values.set(d.id, d.value);
    }
  }

  get(id: string): number {
    return this.values.get(id) ?? this.defs.get(id)?.value ?? 0;
  }

  /**
   * Set a lever value.
   * Range levers: by default **not** clamped to min/max so the number box can
   * override the slider. Pass `clamp: true` when the source is the range thumb.
   */
  set(id: string, value: number, silent = false, opts?: { clamp?: boolean }) {
    const def = this.defs.get(id);
    let v = value;
    if (!Number.isFinite(v)) return;
    if (def?.kind === "toggle") {
      v = value >= 0.5 ? 1 : 0;
    } else if (def?.kind === "range" && opts?.clamp) {
      const min = def.min ?? 0;
      const max = def.max ?? 1;
      v = Math.min(max, Math.max(min, v));
    }
    this.values.set(id, v);
    if (!silent) {
      for (const fn of this.listeners) fn(id, v);
    }
  }

  bool(id: string): boolean {
    return this.get(id) >= 0.5;
  }

  list(): LeverDef[] {
    return [...this.defs.values()];
  }

  onChange(fn: (id: string, value: number) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

/** Generate a phosphor-style panel from the registry. */
export function mountLeverPanel(
  host: HTMLElement,
  levers: LeverRegistry,
  opts?: { onChange?: (id: string, value: number) => void },
): { destroy(): void; refresh(): void } {
  host.replaceChildren();
  host.classList.add("lab-levers");

  const bySection = new Map<string, LeverDef[]>();
  for (const d of levers.list()) {
    const sec = d.section ?? "Tuning";
    let list = bySection.get(sec);
    if (!list) {
      list = [];
      bySection.set(sec, list);
    }
    list.push(d);
  }

  const rangeSliders = new Map<string, HTMLInputElement>();
  const numInputs = new Map<string, HTMLInputElement>();
  const toggleInputs = new Map<string, HTMLInputElement>();

  const formatNum = (d: LeverDef, v: number) => {
    if (d.step != null && d.step >= 1) return String(Math.round(v));
    const places = d.step != null && d.step <= 0.01 ? 2 : d.step != null && d.step < 1 ? 2 : 1;
    return Number(v.toFixed(places)).toString();
  };

  for (const [section, defs] of bySection) {
    const h = document.createElement("div");
    h.className = "lab-section-title";
    h.textContent = section;
    host.appendChild(h);

    for (const d of defs) {
      const row = document.createElement("div");
      row.className = "lab-lever" + (d.kind === "toggle" ? " lab-lever-toggle" : "");
      row.dataset.id = d.id;

      const head = document.createElement("div");
      head.className = "lab-lever-head";
      const name = document.createElement("span");
      name.className = "lab-lever-label";
      name.textContent = d.label;
      head.appendChild(name);

      if (d.kind === "toggle") {
        const val = document.createElement("span");
        val.className = "lab-lever-val";
        head.appendChild(val);

        const input = document.createElement("input");
        input.id = `lever-${d.id}`;
        input.type = "checkbox";
        input.checked = levers.get(d.id) >= 0.5;
        toggleInputs.set(d.id, input);

        const writeVal = () => {
          const v = levers.get(d.id);
          val.textContent = v >= 0.5 ? "ON" : "OFF";
          row.classList.toggle("is-on", v >= 0.5);
        };
        writeVal();

        input.addEventListener("change", () => {
          levers.set(d.id, input.checked ? 1 : 0);
          writeVal();
          opts?.onChange?.(d.id, levers.get(d.id));
        });

        const label = document.createElement("label");
        label.className = "lab-lever-toggle-row";
        label.htmlFor = input.id;
        label.append(input, head);
        row.appendChild(label);
      } else {
        // Editable number + unit — type exacts; may go outside slider min/max
        const min = d.min ?? 0;
        const max = d.max ?? 1;
        const numWrap = document.createElement("span");
        numWrap.className = "lab-lever-num-wrap";

        const num = document.createElement("input");
        num.type = "number";
        num.className = "lab-lever-num";
        num.id = `lever-num-${d.id}`;
        // No min/max attrs — browser must not block overrides past the slider
        num.step = String(d.step ?? 0.01);
        num.value = formatNum(d, levers.get(d.id));
        num.title = "Type exact value (can exceed slider range)";
        numInputs.set(d.id, num);

        numWrap.appendChild(num);
        if (d.unit) {
          const unit = document.createElement("span");
          unit.className = "lab-lever-unit";
          unit.textContent = d.unit;
          numWrap.appendChild(unit);
        }
        head.appendChild(numWrap);

        const slider = document.createElement("input");
        slider.id = `lever-${d.id}`;
        slider.type = "range";
        slider.min = String(min);
        slider.max = String(max);
        slider.step = String(d.step ?? 0.01);
        slider.value = String(levers.get(d.id));
        rangeSliders.set(d.id, slider);

        const syncFromRegistry = () => {
          const v = levers.get(d.id);
          const outside = v < min || v > max;
          // Thumb parks at the edge when value is outside slider domain
          slider.value = String(Math.min(max, Math.max(min, v)));
          slider.classList.toggle("is-overridden", outside);
          num.classList.toggle("is-overridden", outside);
          if (document.activeElement !== num) num.value = formatNum(d, v);
        };
        syncFromRegistry();

        const commit = (raw: number, fromSlider: boolean) => {
          if (!Number.isFinite(raw)) {
            syncFromRegistry();
            return;
          }
          levers.set(d.id, raw, false, fromSlider ? { clamp: true } : undefined);
          syncFromRegistry();
          opts?.onChange?.(d.id, levers.get(d.id));
        };

        slider.addEventListener("input", () => commit(parseFloat(slider.value), true));
        // change = blur / enter-like; input alone is noisy while typing
        num.addEventListener("change", () => commit(parseFloat(num.value), false));
        num.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(parseFloat(num.value), false);
            num.blur();
          }
        });

        // Range: don't wrap in <label> (label-click jumps the thumb to click pos)
        row.append(head, slider);
      }
      if (d.tradesAgainst) {
        const trade = document.createElement("div");
        trade.className = "lab-lever-trade";
        trade.textContent = d.tradesAgainst;
        row.appendChild(trade);
      }
      host.appendChild(row);
    }
  }

  return {
    destroy() {
      host.replaceChildren();
      host.classList.remove("lab-levers");
    },
    refresh() {
      for (const d of levers.list()) {
        const v = levers.get(d.id);
        const row = host.querySelector(`[data-id="${d.id}"]`);
        if (!row) continue;
        if (d.kind === "toggle") {
          const input = toggleInputs.get(d.id);
          if (input) input.checked = v >= 0.5;
          row.classList.toggle("is-on", v >= 0.5);
          const valEl = row.querySelector(".lab-lever-val");
          if (valEl) valEl.textContent = v >= 0.5 ? "ON" : "OFF";
        } else {
          const slider = rangeSliders.get(d.id);
          const num = numInputs.get(d.id);
          const min = d.min ?? 0;
          const max = d.max ?? 1;
          const outside = v < min || v > max;
          if (slider) {
            slider.value = String(Math.min(max, Math.max(min, v)));
            slider.classList.toggle("is-overridden", outside);
          }
          if (num && document.activeElement !== num) {
            num.value = formatNum(d, v);
            num.classList.toggle("is-overridden", outside);
          }
        }
      }
    },
  };
}
