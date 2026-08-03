/** Imperative typewriter — no React. */

export type TypewriterHandle = {
  stop: () => void;
  done: boolean;
};

export function typewrite(
  el: HTMLElement,
  text: string,
  cps: number,
  onDone?: () => void,
): TypewriterHandle {
  let i = 0;
  let done = false;
  el.textContent = "";
  const ms = Math.max(12, Math.floor(1000 / Math.max(1, cps)));
  const id = window.setInterval(() => {
    i += 1;
    el.textContent = text.slice(0, i);
    if (i >= text.length) {
      window.clearInterval(id);
      done = true;
      onDone?.();
    }
  }, ms);
  return {
    get done() {
      return done;
    },
    stop() {
      window.clearInterval(id);
      done = true;
    },
  };
}
