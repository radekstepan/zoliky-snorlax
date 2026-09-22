/* ------------------------------------------------------------------ */
/*  ŽOLÍKY — core types, deck & card utilities                        */
/* ------------------------------------------------------------------ */

export type Suit = "s" | "h" | "d" | "c";

export const SUITS: Suit[] = ["s", "h", "d", "c"];

export const SUIT_SYMBOL: Record<Suit, string> = {
  s: "♠",
  h: "♥",
  d: "♦",
  c: "♣",
};

export const SUIT_NAME: Record<Suit, string> = {
  s: "Piky",
  h: "Srdce",
  d: "Káry",
  c: "Kříže",
};

export const RED_SUITS: Suit[] = ["h", "d"];

export const RANK_LABEL: Record<number, string> = {
  11: "J",
  12: "Q",
  13: "K",
  14: "A",
};

export const JOKER_RANK = 0;
export const ACE = 14;

export interface Card {
  id: number;
  suit: Suit;
  rank: number; // 2..14, joker = 0
  joker?: boolean;
}

export interface PlacedCard extends Card {
  /** rank this joker stands in for (runs: rank, sets: set rank) */
  jokerAs?: number;
  /** resolved position inside a run (1..14) */
  slot?: number;
}

export const rankLabel = (r: number): string =>
  r <= 10 ? String(r) : RANK_LABEL[r] ?? "?";

export const cardName = (c: Card): string =>
  c.joker ? "Žolík" : `${rankLabel(c.rank)} ${SUIT_SYMBOL[c.suit]}`;

/**
 * Heuristic weight of a card (high cards are good discard candidates).
 * Not used for round scoring — rounds score -1 per card (-2 for Jolly Hand).
 */
export const penaltyValue = (c: Card): number => {
  if (c.joker) return 50;
  if (c.rank >= 10) return 10; // 10, J, Q, K, A
  return c.rank;
};

/**
 * Value used for the 36-point first-meld threshold.
 * A Low Ace (slot 1, as in A-2-3) counts 1; a High Ace (slot 14) counts 10.
 * A joker counts as the card it stands in for.
 */
export const meldValue = (c: PlacedCard): number => {
  if (c.joker) {
    const as = c.jokerAs ?? 14;
    if (as === 1) return 1;
    return as >= 10 ? 10 : as;
  }
  if (c.rank === ACE && c.slot === 1) return 1;
  return penaltyValue(c);
};

/* ------------------------------------------------------------------ */
/*  Deck                                                               */
/* ------------------------------------------------------------------ */

export function buildDeck(): Card[] {
  const cards: Card[] = [];
  let id = 0;
  for (let copy = 0; copy < 2; copy++) {
    for (const suit of SUITS) {
      for (let rank = 2; rank <= 14; rank++) {
        cards.push({ id: id++, suit, rank });
      }
    }
  }
  for (let j = 0; j < 4; j++) {
    cards.push({ id: id++, suit: "s", rank: JOKER_RANK, joker: true });
  }
  return cards;
}

/** Fisher–Yates shuffle (returns a new array). */
export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ------------------------------------------------------------------ */
/*  Ruleset constants                                                  */
/* ------------------------------------------------------------------ */

export const RULES = {
  TARGET_SCORE: 30,
  FIRST_MELD_POINTS: 36,
  HAND_SIZE: 12,
  SET_MIN: 3,
  SET_MAX: 4,
  RUN_MIN: 3,
  /** Full table rounds that must pass before anyone may lay cards. */
  MELD_WAIT_ROUNDS: 3,
} as const;

export const BOT_NAMES = ["Karel", "Jana", "Pepa", "Eva", "Míra", "Alena"];

export const AVATAR_HUES = [265, 185, 330, 20, 120, 35];
