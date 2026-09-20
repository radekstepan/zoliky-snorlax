import { describe, expect, it } from "vitest";
import {
  applyJokerSwap,
  bestPacking,
  bestPackingIncluding,
  canAddToMeld,
  coverAll,
  findAllMelds,
  findFirstMeld,
  findJokerSwap,
  firstMeldOk,
  firstMeldProblem,
  isCleanRun,
  layoffTargets,
  meldPoints,
  tryCreateMeld,
} from "../melds";
import type { Meld } from "../melds";
import type { Card } from "../core";
import { JOKER_RANK, RULES } from "../core";

let id = 1000;
const c = (rank: number, suit: Card["suit"] = "h"): Card => ({ id: id++, suit, rank });
const joker = (): Card => ({ id: id++, suit: "s", rank: JOKER_RANK, joker: true });

const meldOf = (cards: Card[]): Meld => {
  const m = tryCreateMeld(cards);
  if (!m) throw new Error("expected a valid meld");
  return m;
};

describe("tryCreateMeld — sets", () => {
  it("accepts three of a kind in distinct suits", () => {
    const m = meldOf([c(7, "h"), c(7, "d"), c(7, "s")]);
    expect(m.type).toBe("set");
    expect(m.rank).toBe(7);
  });

  it("accepts a four-of-a-kind and a set completed by a joker", () => {
    expect(meldOf([c(9, "h"), c(9, "d"), c(9, "s"), c(9, "c")]).type).toBe("set");
    const m = meldOf([c(9, "h"), c(9, "d"), joker()]);
    expect(m.type).toBe("set");
    expect(m.cards.find((x) => x.joker)?.jokerAs).toBe(9);
  });

  it("rejects short, oversized, mixed-rank and duplicate-suit selections", () => {
    expect(tryCreateMeld([c(7, "h"), c(7, "d")])).toBeNull();
    expect(
      tryCreateMeld([c(7, "h"), c(7, "d"), c(7, "s"), c(7, "c"), c(8, "h")])
    ).toBeNull();
    expect(tryCreateMeld([c(7, "h"), c(7, "d"), c(8, "s")])).toBeNull();
    expect(tryCreateMeld([c(7, "h"), c(7, "d"), c(7, "h")])).toBeNull();
  });

  it("requires jokers to be fewer than the natural cards", () => {
    expect(tryCreateMeld([c(7, "h"), joker(), joker()])).toBeNull();
    expect(tryCreateMeld([joker(), joker(), joker()])).toBeNull();
  });
});

describe("tryCreateMeld — runs", () => {
  it("accepts a clean run", () => {
    const m = meldOf([c(7, "h"), c(8, "h"), c(9, "h")]);
    expect(m.type).toBe("run");
    expect(m.suit).toBe("h");
    expect(m.lo).toBe(7);
    expect(isCleanRun(m)).toBe(true);
  });

  it("lets an ace play low (A-2-3) or high (Q-K-A), never around the corner", () => {
    const low = meldOf([c(14, "h"), c(2, "h"), c(3, "h")]);
    expect(low.lo).toBe(1);
    expect(meldPoints(low)).toBe(1 + 2 + 3);

    const high = meldOf([c(12, "h"), c(13, "h"), c(14, "h")]);
    expect(high.lo).toBe(12);
    expect(meldPoints(high)).toBe(30);

    expect(tryCreateMeld([c(13, "h"), c(14, "h"), c(2, "h")])).toBeNull();
  });

  it("fills a single gap with a joker, preferring the higher end", () => {
    const m = meldOf([c(8, "h"), c(9, "h"), joker()]);
    expect(m.lo).toBe(8);
    const j = m.cards.find((x) => x.joker);
    expect(j?.jokerAs).toBe(10);
    expect(isCleanRun(m)).toBe(false);
  });

  it("fills an inner gap with a joker", () => {
    const m = meldOf([c(7, "s"), c(8, "s"), joker(), c(10, "s"), c(11, "s")]);
    expect(meldPoints(m)).toBe(7 + 8 + 9 + 10 + 10);
  });

  it("forbids two jokers side by side", () => {
    // 7-8-_-_-J: the only fitting window needs adjacent jokers.
    expect(tryCreateMeld([c(7, "h"), c(8, "h"), c(11, "h"), joker(), joker()])).toBeNull();
  });

  it("rejects mixed suits and duplicate ranks", () => {
    expect(tryCreateMeld([c(7, "h"), c(8, "h"), c(9, "d")])).toBeNull();
    expect(tryCreateMeld([c(7, "h"), c(7, "h"), c(8, "h")])).toBeNull();
  });
});

describe("first-meld gate", () => {
  const bigClean = () => meldOf([c(12, "h"), c(13, "h"), c(14, "h")]); // 30
  const sevens = () => meldOf([c(7, "h"), c(7, "d"), c(7, "s")]); // 21

  it("passes with 36+ points including a clean run", () => {
    expect(firstMeldOk([bigClean(), sevens()])).toBe(true);
    expect(firstMeldProblem([bigClean(), sevens()])).toBeNull();
  });

  it("fails without a clean run", () => {
    expect(firstMeldOk([sevens(), sevens()])).toBe(false);
    expect(firstMeldProblem([sevens(), sevens()])).toMatch(/čistá postupka/);
  });

  it("fails below 36 points even with a clean run", () => {
    const small = meldOf([c(7, "h"), c(8, "h"), c(9, "h")]); // 24
    expect(firstMeldOk([small])).toBe(false);
    expect(firstMeldProblem([small])).toMatch(/36/);
  });
});

describe("canAddToMeld", () => {
  it("extends a set with the missing suit only", () => {
    const m = meldOf([c(7, "h"), c(7, "d"), c(7, "s")]);
    expect(canAddToMeld(m, c(7, "c"))).not.toBeNull();
    expect(canAddToMeld(m, c(7, "h"))).toBeNull();
    expect(canAddToMeld(m, c(8, "c"))).toBeNull();
  });

  it("refuses to overfill a four-of-a-kind", () => {
    const m = meldOf([c(7, "h"), c(7, "d"), c(7, "s"), c(7, "c")]);
    expect(canAddToMeld(m, c(7, "h"))).toBeNull();
  });

  it("extends a run to the left or right, aces only at the ends", () => {
    const m = meldOf([c(7, "h"), c(8, "h"), c(9, "h")]);
    expect(canAddToMeld(m, c(6, "h"))?.slot).toBe(6);
    expect(canAddToMeld(m, c(10, "h"))?.slot).toBe(10);
    expect(canAddToMeld(m, c(6, "d"))).toBeNull();
    expect(canAddToMeld(m, c(14, "h"))).toBeNull();
  });

  it("extends a low run past the ace side only when the ace is high", () => {
    const high = meldOf([c(12, "h"), c(13, "h"), c(14, "h")]);
    expect(canAddToMeld(high, c(11, "h"))?.slot).toBe(11);
    expect(canAddToMeld(high, c(14, "d"))).toBeNull();
  });

  it("lets a joker extend a run but not sit next to another joker", () => {
    const m = meldOf([c(7, "h"), c(8, "h"), c(9, "h")]);
    const right = canAddToMeld(m, joker());
    expect(right?.slot).toBe(10);
  });

  it("lets a joker join a set while jokers stay outnumbered", () => {
    const trio = meldOf([c(7, "h"), c(7, "d"), c(7, "s")]);
    expect(canAddToMeld(trio, joker())).not.toBeNull();
    const pair = meldOf([c(7, "h"), c(7, "d"), joker()]);
    expect(canAddToMeld(pair, joker())).toBeNull();
  });

  it("offers no layoff or swap target for an unrelated jack", () => {
    // table shapes from a real game: clubs run ending in a joker-as-8,
    // and a hearts J-Q-K-A run — a selected J♠/J♦ fits neither
    const clubs = meldOf([c(4, "c"), c(5, "c"), c(6, "c"), c(7, "c"), joker()]);
    const hearts = meldOf([c(11, "h"), c(12, "h"), c(13, "h"), c(14, "h")]);
    for (const jack of [c(11, "s"), c(11, "d")]) {
      expect(canAddToMeld(clubs, jack)).toBeNull();
      expect(canAddToMeld(hearts, jack)).toBeNull();
      expect(findJokerSwap([clubs, hearts], [jack])).toBeNull();
    }
  });
});

describe("joker swaps", () => {
  it("finds and applies a run swap for the exact card", () => {
    const m = meldOf([c(7, "h"), c(8, "h"), joker()]); // joker as 9
    const jokerId = m.cards.find((x) => x.joker)!.id;
    const hand = [c(5, "d"), c(9, "h")];
    const swap = findJokerSwap([m], hand);
    expect(swap?.jokerCardId).toBe(jokerId);
    const next = applyJokerSwap(m, swap!);
    expect(next.cards.some((x) => x.joker)).toBe(false);
    expect(next.cards.some((x) => !x.joker && x.rank === 9)).toBe(true);
    expect(findJokerSwap([m], [c(5, "d")])).toBeNull();
  });

  it("releases a set joker only once all four suits would be present", () => {
    const m = meldOf([c(7, "h"), c(7, "d"), c(7, "s"), joker()]);
    const jokerId = m.cards.find((x) => x.joker)!.id;
    const full = findJokerSwap([m], [c(7, "c")]);
    expect(full?.jokerCardId).toBe(jokerId);
    expect(findJokerSwap([m], [c(7, "h")])).toBeNull();
    const trio = meldOf([c(7, "h"), c(7, "d"), joker()]);
    expect(findJokerSwap([trio], [c(7, "c")])).toBeNull();
  });
});

describe("subset search", () => {
  const hand = () => [
    c(7, "h"), c(8, "h"), c(9, "h"), // clean run (24)
    c(5, "d"), c(5, "s"), c(5, "c"), // set (15)
    c(2, "c"), c(13, "d"),
  ];

  it("findAllMelds lists melds formable from the hand", () => {
    const cands = findAllMelds(hand());
    expect(cands.length).toBeGreaterThan(0);
    expect(cands.every((x) => x.points > 0)).toBe(true);
  });

  it("bestPacking packs disjoint melds with the top score", () => {
    const p = bestPacking(hand(), false, 0)!;
    expect(p).not.toBeNull();
    expect(p.clean).toBe(true);
    expect(p.points).toBe(24 + 15);
    expect(p.melds).toHaveLength(2);
  });

  it("findFirstMeld enforces the 36-point clean gate", () => {
    expect(findFirstMeld(hand())?.points).toBeGreaterThanOrEqual(
      RULES.FIRST_MELD_POINTS
    );
    expect(findFirstMeld([c(7, "h"), c(7, "d"), c(7, "s")])).toBeNull();
  });

  it("bestPackingIncluding forces the must-use card into the packing", () => {
    const h = hand();
    const mustIdx = h.findIndex((x) => x.rank === 5 && x.suit === "d");
    const p = bestPackingIncluding(h, false, 0, mustIdx)!;
    expect(p).not.toBeNull();
    const used = p.melds.flatMap((m) => m.cards.map((x) => x.id));
    expect(used).toContain(h[mustIdx].id);
    expect(bestPackingIncluding([c(2, "c"), c(13, "d"), c(9, "s")], false, 0, 0)).toBeNull();
  });

  it("bestPackingIncluding combines the must-use meld with others to reach 36", () => {
    // J-Q-K spades (30) alone is below the first-meld gate; together with
    // 8-9-10 diamonds (27) it reaches 57 with a clean run.
    const h = [c(11, "s"), c(13, "s"), c(8, "d"), c(9, "d"), c(10, "d"), c(12, "s")];
    const mustIdx = h.length - 1; // Q♠ — the discard-pile card
    const p = bestPackingIncluding(h, true, RULES.FIRST_MELD_POINTS, mustIdx);
    expect(p).not.toBeNull();
    expect(p!.points).toBeGreaterThanOrEqual(RULES.FIRST_MELD_POINTS);
    expect(p!.clean).toBe(true);
    const used = p!.melds.flatMap((m) => m.cards.map((x) => x.id));
    expect(used).toContain(h[mustIdx].id);
    expect(p!.melds).toHaveLength(2);
  });

  it("coverAll partitions every card or fails", () => {
    const ok = coverAll([c(7, "h"), c(8, "h"), c(9, "h"), c(5, "d"), c(5, "s"), c(5, "c")]);
    expect(ok).toHaveLength(2);
    expect(coverAll([c(7, "h"), c(8, "h")])).toBeNull();
    expect(coverAll([c(7, "h"), c(8, "h"), c(9, "d")])).toBeNull();
  });

  it("layoffTargets lists only fitting table melds", () => {
    const run = meldOf([c(7, "h"), c(8, "h"), c(9, "h")]);
    const set = meldOf([c(5, "d"), c(5, "s"), c(5, "c")]);
    expect(layoffTargets(c(10, "h"), [run, set])).toEqual([run]);
    expect(layoffTargets(c(2, "c"), [run, set])).toEqual([]);
  });
});
