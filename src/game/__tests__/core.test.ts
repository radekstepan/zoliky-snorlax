import { describe, expect, it } from "vitest";
import {
  ACE,
  JOKER_RANK,
  RULES,
  buildDeck,
  cardName,
  meldValue,
  penaltyValue,
  rankLabel,
  shuffle,
} from "../core";
import type { Card, PlacedCard } from "../core";

const card = (rank: number, suit: Card["suit"] = "h"): Card => ({
  id: rank,
  suit,
  rank,
});
const joker = (id = 999): Card => ({ id, suit: "s", rank: JOKER_RANK, joker: true });

describe("buildDeck", () => {
  it("builds 108 cards: two full decks plus four jokers", () => {
    const deck = buildDeck();
    expect(deck).toHaveLength(108);
    expect(deck.filter((c) => c.joker)).toHaveLength(4);
    expect(deck.filter((c) => !c.joker)).toHaveLength(104);
  });

  it("assigns unique ids and two copies of every suit/rank", () => {
    const deck = buildDeck();
    expect(new Set(deck.map((c) => c.id)).size).toBe(108);
    for (const suit of ["s", "h", "d", "c"] as const) {
      for (let rank = 2; rank <= ACE; rank++) {
        expect(
          deck.filter((c) => !c.joker && c.suit === suit && c.rank === rank)
        ).toHaveLength(2);
      }
    }
  });
});

describe("shuffle", () => {
  it("returns a new array with the same cards and leaves the input alone", () => {
    const deck = buildDeck();
    const copy = [...deck];
    const out = shuffle(deck);
    expect(out).not.toBe(deck);
    expect(out).toHaveLength(deck.length);
    expect([...out].sort((a, b) => a.id - b.id)).toEqual(
      [...deck].sort((a, b) => a.id - b.id)
    );
    expect(deck).toEqual(copy);
  });
});

describe("labels", () => {
  it("rankLabel names face cards and falls back to '?'", () => {
    expect(rankLabel(7)).toBe("7");
    expect(rankLabel(10)).toBe("10");
    expect(rankLabel(11)).toBe("J");
    expect(rankLabel(12)).toBe("Q");
    expect(rankLabel(13)).toBe("K");
    expect(rankLabel(ACE)).toBe("A");
    expect(rankLabel(99)).toBe("?");
  });

  it("cardName prints jokers and suited cards", () => {
    expect(cardName(joker())).toBe("Žolík");
    expect(cardName(card(14, "s"))).toBe("A ♠");
    expect(cardName(card(9, "d"))).toBe("9 ♦");
  });
});

describe("penaltyValue", () => {
  it("prices jokers, broadway cards and pips", () => {
    expect(penaltyValue(joker())).toBe(50);
    expect(penaltyValue(card(14))).toBe(10);
    expect(penaltyValue(card(10))).toBe(10);
    expect(penaltyValue(card(9))).toBe(9);
    expect(penaltyValue(card(2))).toBe(2);
  });
});

describe("meldValue", () => {
  it("counts a low ace as 1 and a high ace as 10", () => {
    const low: PlacedCard = { ...card(14, "h"), slot: 1 };
    const high: PlacedCard = { ...card(14, "h"), slot: 14 };
    expect(meldValue(low)).toBe(1);
    expect(meldValue(high)).toBe(10);
  });

  it("counts a joker as the card it stands in for", () => {
    const asSeven: PlacedCard = { ...joker(), jokerAs: 7, slot: 7 };
    const asLowAce: PlacedCard = { ...joker(), jokerAs: 1, slot: 1 };
    const asKing: PlacedCard = { ...joker(), jokerAs: 13, slot: 13 };
    const bare: PlacedCard = { ...joker() };
    expect(meldValue(asSeven)).toBe(7);
    expect(meldValue(asLowAce)).toBe(1);
    expect(meldValue(asKing)).toBe(10);
    expect(meldValue(bare)).toBe(10);
  });
});

describe("RULES", () => {
  it("keeps the first-meld gate at 36 points with a 3-round wait", () => {
    expect(RULES.FIRST_MELD_POINTS).toBe(36);
    expect(RULES.MELD_WAIT_ROUNDS).toBe(3);
    expect(RULES.HAND_SIZE).toBe(12);
  });
});
