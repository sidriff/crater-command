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

  set(id: string, value: number, silent = false) {
    const def = this.defs.get(id);
    let v = value;
    if (def?.kind === "range") {
      const min = def.min ?? 0;
      const max = def.max ?? 1;
      v = Math.min(max, Math.max(min, v));
    } else if (def?.kind === "toggle") {
      v = value >= 0.5 ? 1 : 0;
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

  const inputs = new Map<string, HTMLInputElement>();

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
      const val = document.createElement("span");
      val.className = "lab-lever-val";
      head.append(name, val);

      const input = document.createElement("input");
      input.id = `lever-${d.id}`;
      if (d.kind === "toggle") {
        input.type = "checkbox";
        input.checked = levers.get(d.id) >= 0.5;
      } else {
        input.type = "range";
        input.min = String(d.min ?? 0);
        input.max = String(d.max ?? 1);
        input.step = String(d.step ?? 0.01);
        input.value = String(levers.get(d.id));
      }
      inputs.set(d.id, input);

      const writeVal = () => {
        const v = levers.get(d.id);
        if (d.kind === "toggle") {
          val.textContent = v >= 0.5 ? "ON" : "OFF";
          row.classList.toggle("is-on", v >= 0.5);
        } else {
          const shown =
            d.step != null && d.step >= 1 ? String(Math.round(v)) : v.toFixed(2);
          val.textContent = d.unit ? `${shown}${d.unit}` : shown;
        }
      };
      writeVal();

      const onInput = () => {
        if (d.kind === "toggle") {
          levers.set(d.id, input.checked ? 1 : 0);
        } else {
          levers.set(d.id, parseFloat(input.value));
        }
        writeVal();
        opts?.onChange?.(d.id, levers.get(d.id));
      };
      // range: live drag; toggle: change (avoids double-fire from input+change)
      input.addEventListener(d.kind === "toggle" ? "change" : "input", onInput);

      if (d.kind === "toggle") {
        // Clickable row: label associates with checkbox without double-wrap issues
        const label = document.createElement("label");
        label.className = "lab-lever-toggle-row";
        label.htmlFor = input.id;
        label.append(input, head);
        row.appendChild(label);
      } else {
        // Range: don't wrap in <label> (label-click jumps the thumb to click pos)
        row.append(head, input);
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
      for (const [id, input] of inputs) {
        const d = levers.list().find((x) => x.id === id);
        if (!d) continue;
        const v = levers.get(id);
        if (d.kind === "toggle") input.checked = v >= 0.5;
        else input.value = String(v);
        const row = host.querySelector(`[data-id="${id}"]`);
        if (!row) continue;
        if (d.kind === "toggle") row.classList.toggle("is-on", v >= 0.5);
        const valEl = row.querySelector(".lab-lever-val");
        if (valEl) {
          if (d.kind === "toggle") valEl.textContent = v >= 0.5 ? "ON" : "OFF";
          else {
            const shown =
              d.step != null && d.step >= 1 ? String(Math.round(v)) : v.toFixed(2);
            valEl.textContent = d.unit ? `${shown}${d.unit}` : shown;
          }
        }
      }
    },
  };
}
