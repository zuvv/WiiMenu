/* ============================================================
   Wii Menu — cursor mode

   The hand has three shapes. Anything can ask for one:

     Cursor.open()    an open hand — "you can grab this"
     Cursor.grab()    a fist — "you are holding it"
     Cursor.point()   the pointing hand, the default everywhere else

   A module-level store rather than context: the globe sets this
   from pointer handlers that already run outside React's render,
   and only <WiiCursor> ever reads it.
   ============================================================ */

export type CursorMode = "point" | "open" | "grab";

let mode: CursorMode = "point";
const listeners = new Set<() => void>();

export function getCursorMode() {
  return mode;
}

export function subscribeCursor(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function set(next: CursorMode) {
  if (next === mode) return;
  mode = next;
  for (const fn of listeners) fn();
}

export const Cursor = {
  set,
  point: () => set("point"),
  open: () => set("open"),
  grab: () => set("grab"),
};
