/** Portrait phone stage (desktop letterbox). */

export function mountShell(root: HTMLElement): HTMLElement {
  root.innerHTML = "";
  root.className = "";

  const outer = document.createElement("div");
  outer.className = "phone-shell-outer";

  const stage = document.createElement("div");
  stage.className = "phone-shell-stage";

  const notch = document.createElement("div");
  notch.className = "phone-notch";
  notch.setAttribute("aria-hidden", "true");
  notch.innerHTML = "<span></span>";

  const inner = document.createElement("div");
  inner.className = "phone-inner";
  inner.id = "stage";

  stage.append(notch, inner);
  outer.append(stage);
  root.append(outer);
  return inner;
}

export function clearStage(stage: HTMLElement) {
  stage.replaceChildren();
}
