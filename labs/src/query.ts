/**
 * Deep-link query helpers for labs (model-friendly, shareable URLs).
 *
 * Examples:
 *   /?lab=mesh&mesh=u:scout
 *   /?lab=mesh&mesh=scout
 *   /?lab=readability&board=identity
 *   /?lab=concept&concept=rover
 *   /?lab=dispatch&dispatch=scout_works
 */

export type LabQuery = {
  lab: string | null;
  mesh: string | null;
  board: string | null;
  concept: string | null;
  dispatch: string | null;
};

export function readLabQuery(search = location.search): LabQuery {
  const q = new URLSearchParams(search);
  return {
    lab: emptyToNull(q.get("lab") ?? q.get("l")),
    mesh: emptyToNull(q.get("mesh") ?? q.get("m")),
    board: emptyToNull(q.get("board") ?? q.get("b")),
    concept: emptyToNull(q.get("concept") ?? q.get("c")),
    dispatch: emptyToNull(q.get("dispatch") ?? q.get("d")),
  };
}

export function writeLabQuery(
  patch: Partial<LabQuery>,
  opts?: { replace?: boolean },
) {
  const url = new URL(location.href);
  const q = url.searchParams;

  const setOrDel = (keys: string[], value: string | null | undefined) => {
    if (value === undefined) return;
    for (const k of keys) q.delete(k);
    if (value != null && value !== "") q.set(keys[0]!, value);
  };

  setOrDel(["lab", "l"], patch.lab === undefined ? undefined : patch.lab);
  setOrDel(["mesh", "m"], patch.mesh === undefined ? undefined : patch.mesh);
  setOrDel(["board", "b"], patch.board === undefined ? undefined : patch.board);
  setOrDel(["concept", "c"], patch.concept === undefined ? undefined : patch.concept);
  setOrDel(
    ["dispatch", "d"],
    patch.dispatch === undefined ? undefined : patch.dispatch,
  );

  const next = `${url.pathname}${q.toString() ? `?${q}` : ""}${url.hash}`;
  if (opts?.replace === false) history.pushState(null, "", next);
  else history.replaceState(null, "", next);
}

function emptyToNull(v: string | null): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t ? t : null;
}
