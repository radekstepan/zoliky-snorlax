/**
 * True when the primary input can hover (mouse/trackpad).
 * Touch taps have no hover leave: framer-motion hover state set by a tap
 * stays stuck on the card, which then looks highlighted/selected.
 */
export function deviceHovers(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function")
    return false;
  return window.matchMedia("(hover: hover)").matches;
}
