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

/** Penalty value of a card left in hand at the end of a round. */
export const penaltyValue = (c: Card): number => {
  if (c.joker) return 50;
  if (c.rank >= 10) return 10; // 10, J, Q, K, A
  return c.rank;
};

/** Value used for the 51-point first-meld threshold. */
export const meldValue = (c: PlacedCard): number => {
  if (c.joker) {
    const as = c.jokerAs ?? 14;
    return as >= 10 ? 10 : as;
  }
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
  TARGET_SCORE: 300,
  FIRST_MELD_POINTS: 51,
  HAND_SIZE: 14,
  SET_MIN: 3,
  SET_MAX: 4,
  RUN_MIN: 3,
  JOKER_PENALTY: 50,
} as const;

export const BOT_NAMES = ["Karel", "Jana", "Pepa", "Eva", "Míra", "Alena"];

export const AVATAR_HUES = [265, 185, 330, 20, 120, 35];
