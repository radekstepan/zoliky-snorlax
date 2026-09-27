/** Per-card hover/lift affordance for table melds (pure, unit-tested).
 *
 * Regression: 6c-10c run with a 7-joker + selected 5c made the whole meld
 * `targetable` (gold border), and every card in it was `hoverable`, so
 * naturals like 8/9 lifted under a resting cursor (`whileHover y:-14`)
 * and read as highlighted. Only a genuine joker-swap target may lift —
 * layoff intent stays on the meld container.
 */

export interface MeldCardLike {
  id: number;
  joker?: boolean;
}

export interface MeldCardAffordance {
  /** this card is the joker that can be swapped with the selected hand card */
  isSwapTarget: boolean;
  /** PlayingCard `target` prop (gold dashed outline + pulse) */
  target: boolean;
  /** PlayingCard `hoverable` prop (pointer cursor) */
  hoverable: boolean;
  /** PlayingCard `hoverLift` prop (slide-up on hover) */
  hoverLift: boolean;
}

export function getMeldCardAffordance(
  card: MeldCardLike,
  opts: { interactive: boolean; swapJokerId: number | null; hoverLift: boolean }
): MeldCardAffordance {
  const isSwapTarget = !!card.joker && card.id === opts.swapJokerId;
  const hoverable = opts.interactive && isSwapTarget;
  return {
    isSwapTarget,
    target: isSwapTarget,
    hoverable,
    hoverLift: hoverable && opts.hoverLift,
  };
}

/** Meld container stays the layoff/swap destination cue (gold border + pointer). */
export function isMeldHot(opts: { targetable: boolean; swapJokerId: number | null }): boolean {
  return opts.targetable || opts.swapJokerId !== null;
}
