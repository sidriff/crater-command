import { useEffect, useState } from "react";

/**
 * rAF-driven typewriter. Uses wall-clock time so a long main-thread hitch
 * catches up instead of stalling on a frozen setInterval queue.
 */
export function useTypewriter(text: string, cps: number, start: boolean) {
  const [n, setN] = useState(0);

  useEffect(() => {
    if (!start) {
      setN(0);
      return;
    }
    setN(0);
    if (!text.length) return;

    const startAt = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const chars = Math.min(text.length, Math.floor(((now - startAt) / 1000) * cps));
      setN(chars);
      if (chars < text.length) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, cps, start]);

  return {
    visible: text.slice(0, n),
    done: n >= text.length && text.length > 0,
  };
}
