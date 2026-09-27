import { describe, expect, it } from "vitest";
import { getMeldCardAffordance, isMeldHot } from "../meldHover";

const natural = (id: number) => ({ id, joker: false });
const joker = (id: number) => ({ id, joker: true });

describe("getMeldCardAffordance — table slide-up", () => {
  it("never lifts naturals in a targetable meld (8/9 next to 7-joker regression)", () => {
    // 6c-10c run, targetable via selected 5c, but no swap target:
    // 8 and 9 must not slide up under a resting cursor.
    for (const card of [natural(6), natural(8), natural(9)]) {
      const afford = getMeldCardAffordance(card, {
        interactive: true,
        swapJokerId: null,
        hoverLift: true,
      });
      expect(afford).toEqual({
        isSwapTarget: false,
        target: false,
        hoverable: false,
        hoverLift: false,
      });
    }
  });

  it("lifts only the swap-target joker, not sibling naturals", () => {
    const swap = getMeldCardAffordance(joker(7), {
      interactive: true,
      swapJokerId: 7,
      hoverLift: true,
    });
    expect(swap.hoverable).toBe(true);
    expect(swap.hoverLift).toBe(true);
    expect(swap.target).toBe(true);

    const sibling = getMeldCardAffordance(natural(8), {
      interactive: true,
      swapJokerId: 7,
      hoverLift: true,
    });
    expect(sibling.hoverable).toBe(false);
    expect(sibling.hoverLift).toBe(false);

    const otherJoker = getMeldCardAffordance(joker(99), {
      interactive: true,
      swapJokerId: 7,
      hoverLift: true,
    });
    expect(otherJoker.hoverable).toBe(false);
  });

  it("disables hover when not interactive or hover cannot end (touch)", () => {
    const notInteractive = getMeldCardAffordance(joker(7), {
      interactive: false,
      swapJokerId: 7,
      hoverLift: true,
    });
    expect(notInteractive.hoverable).toBe(false);
    expect(notInteractive.hoverLift).toBe(false);
    // target outline stays so the destination is still visible
    expect(notInteractive.target).toBe(true);

    const touch = getMeldCardAffordance(joker(7), {
      interactive: true,
      swapJokerId: 7,
      hoverLift: false,
    });
    expect(touch.hoverable).toBe(true);
    expect(touch.hoverLift).toBe(false);
  });

  it("keeps the meld container hot for layoff even with no per-card lift", () => {
    expect(isMeldHot({ targetable: true, swapJokerId: null })).toBe(true);
    expect(isMeldHot({ targetable: false, swapJokerId: 7 })).toBe(true);
    expect(isMeldHot({ targetable: false, swapJokerId: null })).toBe(false);
  });
});
