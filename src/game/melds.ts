/* ------------------------------------------------------------------ */
/*  ŽOLÍKY — meld validation, joker resolution & search helpers       */
/* ------------------------------------------------------------------ */

import {
  Card,
  PlacedCard,
  Suit,
  ACE,
  RULES,
  meldValue,
  penaltyValue,
} from "./core";

export interface Meld {
  id: string;
  type: "set" | "run";
  suit?: Suit; // runs
  rank?: number; // sets
  lo: number; // runs: lowest slot
  owner?: number; // player id who created it (for display)
  cards: PlacedCard[];
}

export const isCleanRun = (m: Meld): boolean =>
  m.type === "run" && m.cards.every((c) => !c.joker);

export const meldPoints = (m: Meld): number =>
  m.cards.reduce((s, c) => s + meldValue(c), 0);

export const sumPenalty = (hand: Card[]): number =>
  hand.reduce((s, c) => s + penaltyValue(c), 0);

/* ------------------------------------------------------------------ */
/*  Creation of a meld from a hand selection                           */
/* ------------------------------------------------------------------ */

let meldSeq = 0;
export const nextMeldId = (): string => `M${++meldSeq}_${Math.random().toString(36).slice(2, 7)}`;

export function tryCreateMeld(cards: Card[]): Meld | null {
  if (cards.length < RULES.SET_MIN) return null;
  return tryMakeSet(cards) ?? tryMakeRun(cards);
}

function tryMakeSet(cards: Card[]): Meld | null {
  const n = cards.length;
  if (n < RULES.SET_MIN || n > RULES.SET_MAX) return null;
  const naturals = cards.filter((c) => !c.joker);
  const jokers = cards.filter((c) => c.joker);
  if (naturals.length === 0) return null;
  if (jokers.length >= naturals.length) return null;
  const rank = naturals[0].rank;
  if (!naturals.every((c) => c.rank === rank)) return null;
  const suits = new Set(naturals.map((c) => c.suit));
  if (suits.size !== naturals.length) return null;
  return {
    id: nextMeldId(),
    type: "set",
    rank,
    lo: 0,
    cards: cards.map((c) => ({ ...c, jokerAs: c.joker ? rank : undefined })),
  };
}

/**
 * Try to interpret the cards as a same-suit run. Aces may act as 1 or 14.
 * Jokers fill the remaining slots of the best-fitting window.
 */
function tryMakeRun(cards: Card[]): Meld | null {
  const n = cards.length;
  if (n < RULES.RUN_MIN || n > 13) return null; // 13 distinct ranks max (A..K)
  const naturals = cards.filter((c) => !c.joker);
  const jokers = cards.filter((c) => c.joker);
  if (naturals.length === 0) return null;
  if (jokers.length >= naturals.length) return null; // jokers fewer than naturals
  const suit = naturals[0].suit;
  if (!naturals.every((c) => c.suit === suit)) return null;
  const ranks = new Set(naturals.map((c) => c.rank));
  if (ranks.size !== naturals.length) return null; // distinct ranks only

  // Candidate windows, best first (jokers at the ends, then higher).
  // Windows where two jokers would sit side by side are illegal.
  const cands: { lo: number; ends: number }[] = [];
  for (let lo = 1; lo <= 15 - n; lo++) {
    const hi = lo + n - 1;
    let ok = true;
    for (const c of naturals) {
      if (c.rank === ACE) {
        const fitsAsLow = lo <= 1 && 1 <= hi;
        const fitsAsHigh = lo <= 14 && 14 <= hi;
        if (!fitsAsLow && !fitsAsHigh) { ok = false; break; }
      } else if (c.rank < lo || c.rank > hi) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const filled = new Set<number>();
    for (const c of naturals) {
      if (c.rank === ACE) filled.add(lo <= 1 && 1 <= hi ? 1 : 14);
      else filled.add(c.rank);
    }
    const missing: number[] = [];
    for (let s = lo; s <= hi; s++) if (!filled.has(s)) missing.push(s);
    // two jokers may never sit next to each other
    let adjacent = false;
    for (let i = 1; i < missing.length; i++) {
      if (missing[i] === missing[i - 1] + 1) { adjacent = true; break; }
    }
    if (adjacent) continue;
    let ends = 0;
    for (let s = lo; s <= hi; s++) {
      if (!filled.has(s) && (s === lo || s === hi)) ends++;
    }
    cands.push({ lo, ends });
  }
  cands.sort((a, b) => b.ends - a.ends || b.lo - a.lo);
  const best = cands[0] ?? null;
  if (!best) return null;

  const lo = best.lo;
  const hi = lo + n - 1;
  const slotOf = new Map<number, number>(); // card id -> slot
  const usedSlots = new Set<number>();
  for (const c of naturals) {
    const slot = c.rank === ACE ? (lo <= 1 && 1 <= hi ? 1 : 14) : c.rank;
    slotOf.set(c.id, slot);
    usedSlots.add(slot);
  }
  const missing: number[] = [];
  for (let s = lo; s <= hi; s++) if (!usedSlots.has(s)) missing.push(s);
  const placed: PlacedCard[] = cards.map((c) => {
    if (!c.joker) return { ...c, slot: slotOf.get(c.id) };
    const as = missing.shift()!;
    return { ...c, jokerAs: as, slot: as };
  });
  placed.sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));
  return { id: nextMeldId(), type: "run", suit, lo, cards: placed };
}

/* ------------------------------------------------------------------ */
/*  Laying off onto an existing meld                                   */
/* ------------------------------------------------------------------ */

/** Returns the placed card (with resolved slot/jokerAs) or null. */
export function canAddToMeld(meld: Meld, card: Card): PlacedCard | null {
  if (card.joker) {
    // joker can extend a run, or join a set if jokers stay < naturals
    if (meld.type === "set") {
      const nats = meld.cards.filter((c) => !c.joker).length;
      const joks = meld.cards.length - nats;
      if (meld.cards.length + 1 > RULES.SET_MAX) return null;
      if (joks + 1 >= nats) return null;
      return { ...card, jokerAs: meld.rank! };
    }
    // run: extend right if possible, else left (never next to another joker)
    const len = meld.cards.length;
    if (len >= 13) return null; // full A..K — cannot be extended
    const hi = meld.lo + len - 1;
    const bySlot = new Map(meld.cards.map((c) => [c.slot, c]));
    if (hi < 14 && !bySlot.get(hi)?.joker) {
      return { ...card, jokerAs: hi + 1, slot: hi + 1 };
    }
    if (meld.lo > 1 && !bySlot.get(meld.lo)?.joker) {
      return { ...card, jokerAs: meld.lo - 1, slot: meld.lo - 1 };
    }
    return null;
  }

  if (meld.type === "set") {
    if (card.rank !== meld.rank) return null;
    if (meld.cards.some((c) => !c.joker && c.suit === card.suit)) return null;
    if (meld.cards.length + 1 > RULES.SET_MAX) return null;
    const nats = meld.cards.filter((c) => !c.joker).length;
    const joks = meld.cards.length - nats;
    if (joks >= nats + 1) return null;
    return { ...card };
  }

  // run: natural card must extend left or right
  const len = meld.cards.length;
  if (len >= 13) return null; // full A..K — cannot be extended
  const hi = meld.lo + len - 1;
  const rank = card.rank;
  if (card.suit !== meld.suit) return null;
  const trySlot = (s: number): boolean => {
    if (rank === ACE) return s === 1 || s === 14;
    return rank === s;
  };
  if (meld.lo > 1 && trySlot(meld.lo - 1)) {
    return { ...card, slot: meld.lo - 1 };
  }
  if (hi < 14 && trySlot(hi + 1)) {
    return { ...card, slot: hi + 1 };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Joker swap                                                         */
/* ------------------------------------------------------------------ */

export interface JokerSwap {
  meldId: string;
  jokerCardId: number;
  replacement: Card;
  as: number;
}

export function findJokerSwap(
  melds: Meld[],
  hand: Card[]
): JokerSwap | null {
  for (const meld of melds) {
    for (const mc of meld.cards) {
      if (!mc.joker || mc.jokerAs === undefined) continue;
      const as = mc.jokerAs;
      for (const c of hand) {
        if (c.joker) continue;
        if (meld.type === "set") {
          if (c.rank !== meld.rank) continue;
          // a set only releases its joker once all 4 suits are present:
          // exactly 3 distinct natural suits + the replacement completes them
          const nats = meld.cards.filter((x) => !x.joker);
          if (nats.length !== RULES.SET_MAX - 1) continue;
          if (new Set(nats.map((x) => x.suit)).size !== nats.length) continue;
          if (nats.some((x) => x.suit === c.suit)) continue;
          return { meldId: meld.id, jokerCardId: mc.id, replacement: c, as };
        }
        // run
        if (c.suit !== meld.suit) continue;
        if (as === 1 || as === 14) {
          if (c.rank !== ACE) continue;
        } else if (c.rank !== as) continue;
        return { meldId: meld.id, jokerCardId: mc.id, replacement: c, as };
      }
    }
  }
  return null;
}

/** Apply a joker swap to a meld (returns a new meld). */
export function applyJokerSwap(meld: Meld, swap: JokerSwap): Meld {
  const cards = meld.cards.map((c) => ({ ...c }));
  const idx = cards.findIndex((c) => c.id === swap.jokerCardId);
  if (idx < 0) return meld;
  const rep: PlacedCard = {
    ...swap.replacement,
    slot: meld.type === "run" ? swap.as : undefined,
    jokerAs: undefined,
  };
  cards[idx] = rep;
  if (meld.type === "run") {
    cards.sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));
    const lo = Math.min(...cards.map((c) => c.slot ?? (c.rank === ACE ? 14 : c.rank)));
    return { ...meld, cards, lo };
  }
  return { ...meld, cards };
}

/* ------------------------------------------------------------------ */
/*  First-meld gate: 36 points + one clean run                         */
/* ------------------------------------------------------------------ */

export function firstMeldOk(melds: Meld[]): boolean {
  const total = melds.reduce((s, m) => s + meldPoints(m), 0);
  if (total < RULES.FIRST_MELD_POINTS) return false;
  return melds.some(isCleanRun);
}

/** Human-readable reason why a first meld fails (or null if OK). */
export function firstMeldProblem(melds: Meld[]): string | null {
  const total = melds.reduce((s, m) => s + meldPoints(m), 0);
  const hasClean = melds.some(isCleanRun);
  if (total >= RULES.FIRST_MELD_POINTS && hasClean) return null;
  if (total < RULES.FIRST_MELD_POINTS && !hasClean) {
    return `První výklad: minimálně ${RULES.FIRST_MELD_POINTS} bodů (máš ${total}) a čistá postupka.`;
  }
  if (total < RULES.FIRST_MELD_POINTS) {
    return `První výklad musí mít alespoň ${RULES.FIRST_MELD_POINTS} bodů (máš ${total}).`;
  }
  return "K prvnímu výkladu patří čistá postupka (3 karty za sebou bez žolíka).";
}

/* ------------------------------------------------------------------ */
/*  Subset search (bots + hints)                                       */
/* ------------------------------------------------------------------ */

export interface MeldCandidate {
  mask: number;
  points: number;
  clean: boolean;
  meld: Meld;
}

/** All valid melds that can be formed from subsets of the hand. */
export function findAllMelds(hand: Card[], maxSize = 6): MeldCandidate[] {
  const n = hand.length;
  const out: MeldCandidate[] = [];
  const limit = Math.min(maxSize, n);
  for (let k = RULES.SET_MIN; k <= limit; k++) {
    const combo: number[] = [];
    const rec = (start: number, depth: number) => {
      if (depth === k) {
        const cards = combo.map((i) => hand[i]);
        const meld = tryCreateMeld(cards);
        if (meld) {
          let mask = 0;
          for (const i of combo) mask |= 1 << i;
          out.push({ mask, points: meldPoints(meld), clean: isCleanRun(meld), meld });
        }
        return;
      }
      for (let i = start; i < n; i++) {
        combo.push(i);
        rec(i + 1, depth + 1);
        combo.pop();
      }
    };
    rec(0, 0);
  }
  return out;
}

export interface Packing {
  masks: number[];
  points: number;
  clean: boolean;
  melds: Meld[];
}

/**
 * Best disjoint packing of melds from the hand.
 * If requireClean, only packings containing a clean run are considered.
 */
export function bestPacking(
  hand: Card[],
  requireClean: boolean,
  minPoints = 0
): Packing | null {
  const cands = findAllMelds(hand);
  const n = hand.length;
  const size = 1 << n;
  const dp = new Int16Array(size).fill(-1);
  const hasClean = new Uint8Array(size);
  const pick = new Int32Array(size).fill(-1);
  dp[0] = 0;
  for (let mask = 0; mask < size; mask++) {
    if (dp[mask] < 0) continue;
    for (const cand of cands) {
      if (mask & cand.mask) continue;
      const next = mask | cand.mask;
      const pts = dp[mask] + cand.points;
      const clean = hasClean[mask] || (cand.clean ? 1 : 0);
      if (pts > dp[next] || (pts === dp[next] && clean > hasClean[next])) {
        dp[next] = pts;
        hasClean[next] = clean;
        pick[next] = mask;
      }
    }
  }
  let bestMask = -1;
  let bestPts = -1;
  for (let mask = 0; mask < size; mask++) {
    if (dp[mask] < minPoints) continue;
    if (requireClean && !hasClean[mask]) continue;
    if (dp[mask] > bestPts) {
      bestPts = dp[mask];
      bestMask = mask;
    }
  }
  if (bestMask < 0) return null;
  const masks: number[] = [];
  let cur = bestMask;
  while (cur > 0) {
    const prev = pick[cur];
    if (prev < 0) break;
    masks.push(cur ^ prev);
    cur = prev;
  }
  const melds = masks.map((m) => cands.find((c) => c.mask === m)!.meld);
  return {
    masks,
    points: bestPts,
    clean: hasClean[bestMask] === 1,
    melds,
  };
}

/** Find a first-meld packing meeting 36 + clean run. */
export function findFirstMeld(hand: Card[]): Packing | null {
  return bestPacking(hand, true, RULES.FIRST_MELD_POINTS);
}

/**
 * Best disjoint packing that MUST use the card at hand index mustIdx
 * (e.g. a discard-pile card that has to be laid immediately, or a joker
 * taken from the table that has to be used this turn).
 */
export function bestPackingIncluding(
  hand: Card[],
  requireClean: boolean,
  minPoints: number,
  mustIdx: number
): Packing | null {
  const mustBit = 1 << mustIdx;
  const cands = findAllMelds(hand);
  if (!cands.some((c) => c.mask & mustBit)) return null;
  const n = hand.length;
  const size = 1 << n;
  const dp = new Int16Array(size).fill(-1);
  const hasClean = new Uint8Array(size);
  const pick = new Int32Array(size).fill(-1);
  dp[0] = 0;
  for (let mask = 0; mask < size; mask++) {
    if (dp[mask] < 0) continue;
    for (const cand of cands) {
      if (mask & cand.mask) continue;
      const next = mask | cand.mask;
      const pts = dp[mask] + cand.points;
      const clean = hasClean[mask] || (cand.clean ? 1 : 0);
      if (pts > dp[next] || (pts === dp[next] && clean > hasClean[next])) {
        dp[next] = pts;
        hasClean[next] = clean;
        pick[next] = mask;
      }
    }
  }
  // Pack over all candidates; the must-use card is enforced by keeping
  // only final masks that contain mustBit, so a must-meld can combine
  // with other melds to reach the point gate.
  let bestMask = -1;
  let bestPts = -1;
  for (let mask = 0; mask < size; mask++) {
    if (!(mask & mustBit)) continue;
    if (dp[mask] < minPoints) continue;
    if (requireClean && !hasClean[mask]) continue;
    if (dp[mask] > bestPts) {
      bestPts = dp[mask];
      bestMask = mask;
    }
  }
  if (bestMask < 0) return null;
  const masks: number[] = [];
  let cur = bestMask;
  while (cur > 0) {
    const prev = pick[cur];
    if (prev < 0) break;
    masks.push(cur ^ prev);
    cur = prev;
  }
  const melds = masks.map((m) => cands.find((c) => c.mask === m)!.meld);
  return {
    masks,
    points: bestPts,
    clean: hasClean[bestMask] === 1,
    melds,
  };
}

/**
 * Partition ALL given cards into valid melds (every card must be used).
 * Returns the melds or null if full coverage is impossible.
 */
export function coverAll(cards: Card[]): Meld[] | null {
  if (cards.length < RULES.SET_MIN) return null;
  const cands = findAllMelds(cards);
  const n = cards.length;
  const full = (1 << n) - 1;
  const parent = new Int32Array(1 << n).fill(-1);
  const pickMask = new Int32Array(1 << n).fill(0);
  const reachable = new Uint8Array(1 << n);
  reachable[0] = 1;
  for (let mask = 0; mask <= full; mask++) {
    if (!reachable[mask]) continue;
    for (const cand of cands) {
      if (mask & cand.mask) continue;
      const next = mask | cand.mask;
      if (!reachable[next]) {
        reachable[next] = 1;
        parent[next] = mask;
        pickMask[next] = cand.mask;
      }
    }
  }
  if (!reachable[full]) return null;
  const melds: Meld[] = [];
  let cur = full;
  while (cur > 0) {
    const pm = pickMask[cur];
    const idxs: number[] = [];
    for (let i = 0; i < n; i++) if (pm & (1 << i)) idxs.push(i);
    const meld = tryCreateMeld(idxs.map((i) => cards[i]));
    if (!meld) return null;
    melds.push(meld);
    cur = parent[cur];
  }
  return melds;
}

/**
 * Jolly Hand closes by melding all but one card and discarding the last one.
 * Returns an index into `cards` whose removal leaves a fully coverable rest,
 * or -1 when no such discard exists.
 */
export function jollyDiscardIndex(cards: Card[]): number {
  for (let i = 0; i < cards.length; i++) {
    const rest = cards.filter((_, j) => j !== i);
    if (coverAll(rest) !== null) return i;
  }
  return -1;
}

/** True when the hand can close as a Jolly Hand via one final discard. */
export function canJollyClose(cards: Card[]): boolean {
  return jollyDiscardIndex(cards) >= 0;
}

/** All table melds this card could be laid off onto. */
export function layoffTargets(card: Card, melds: Meld[]): Meld[] {
  return melds.filter((m) => canAddToMeld(m, card) !== null);
}
