/* ------------------------------------------------------------------ */
/*  ŽOLÍKY — bot AI                                                   */
/* ------------------------------------------------------------------ */

import { Card, Suit, penaltyValue, RULES } from "./core";
import {
  GameState,
  draw,
  takeJolly,
  layMeld,
  layoff,
  swapJoker,
  meldsLocked,
  discardUseful,
} from "./engine";
import {
  bestPacking,
  bestPackingIncluding,
  findFirstMeld,
  canAddToMeld,
  coverAll,
  canJollyClose,
  jollyDiscardIndex,
  findJokerSwap,
  findAllMelds,
} from "./melds";

export type BotAction =
  | { kind: "draw"; from: "stock" | "discard" }
  | { kind: "jolly" }
  | { kind: "meld"; cardIds: number[] }
  | { kind: "layoff"; cardId: number; meldId: string }
  | { kind: "swap"; cardId: number; meldId: string; jokerCardId: number }
  | { kind: "discard"; cardId: number };

const meOf = (s: GameState) => s.players[s.current];

/** Card id that must leave the hand via a lay this turn (or null). */
function mustUseId(s: GameState): number | null {
  const me = meOf(s);
  if (
    s.pendingLayId !== null &&
    me.hand.some((c) => c.id === s.pendingLayId)
  )
    return s.pendingLayId;
  if (
    s.pendingJokerId !== null &&
    me.hand.some((c) => c.id === s.pendingJokerId)
  )
    return s.pendingJokerId;
  return null;
}

/* ------------------------------------------------------------------ */
/*  Draw decision                                                      */
/* ------------------------------------------------------------------ */

function shouldTakeJolly(s: GameState): boolean {
  const me = meOf(s);
  if (!s.jollyCard || me.hand.length !== RULES.HAND_SIZE) return false;
  const pool = [...me.hand, s.jollyCard];
  return coverAll(pool) !== null || canJollyClose(pool);
}

function shouldTakeDiscard(s: GameState): boolean {
  const me = meOf(s);
  const top = s.discard[s.discard.length - 1];
  if (!top) return false;
  if (meldsLocked(s)) return false; // a taken card must be laid at once
  // Mirror the engine: the pile card must be layable THIS turn.
  if (me.melded) {
    if (!s.melds.some((m) => canAddToMeld(m, top) !== null)) return false;
  } else {
    const pool = [...me.hand, top];
    if (
      !bestPackingIncluding(pool, true, RULES.FIRST_MELD_POINTS, pool.length - 1)
    )
      return false;
  }
  const difficulty = me.difficulty ?? "medium";
  if (difficulty === "easy") return true;
  return discardUseful(me.hand, top, s.melds, me.melded);
}

/* ------------------------------------------------------------------ */
/*  Discard decision                                                   */
/* ------------------------------------------------------------------ */

function chooseDiscard(s: GameState): Card {
  const me = meOf(s);
  const difficulty = me.difficulty ?? "medium";
  // Pending cards must be laid, never discarded.
  const locked = new Set(
    [s.pendingLayId, s.pendingJokerId].filter((x) => x !== null)
  );
  const free = me.hand.filter((c) => !locked.has(c.id));
  const nonJokers = free.filter((c) => !c.joker);
  if (nonJokers.length === 0) return free[0] ?? me.hand[0];

  if (difficulty === "easy") {
    return nonJokers.reduce((a, b) =>
      penaltyValue(a) >= penaltyValue(b) ? a : b
    );
  }

  const cands = findAllMelds(me.hand);
  const inMeld = new Map<number, number>();
  for (const c of cands) {
    for (const i of c.meld.cards.map((x) => x.id)) {
      inMeld.set(i, (inMeld.get(i) ?? 0) + 1);
    }
  }
  let best = nonJokers[0];
  let bestScore = Infinity;
  for (const c of nonJokers) {
    const keep = (inMeld.get(c.id) ?? 0) * 20 + (50 - penaltyValue(c));
    if (keep < bestScore || (keep === bestScore && penaltyValue(c) > penaltyValue(best))) {
      bestScore = keep;
      best = c;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/*  Main planner — simulates the turn with the real engine             */
/* ------------------------------------------------------------------ */

export function planBotTurn(initial: GameState): BotAction[] {
  const actions: BotAction[] = [];
  let sim = structuredClone(initial);
  const difficulty = meOf(sim).difficulty ?? "medium";
  const isEasy = difficulty === "easy";
  const isHard = difficulty === "hard";
  // Melds created mid-plan get fresh ids on live re-application, so layoffs
  // and swaps may only target melds that pre-date this plan (stable ids).
  const tableIds = new Set(initial.melds.map((m) => m.id));

  // 1) draw (skipped by the předák, who starts the round with a discard)
  if (!sim.skipDraw) {
    if (shouldTakeJolly(sim)) {
      // Jolly Hand: take the bottom card, lay everything but one card,
      // then discard the last card to close.
      const res = takeJolly(sim);
      if (!res.events.some((e) => e.type === "invalid")) {
        sim = res.state;
        actions.push({ kind: "jolly" });
        const hand = meOf(sim).hand;
        if (coverAll(hand) !== null) {
          const ids = hand.map((c) => c.id);
          const r = layMeld(sim, ids);
          sim = r.state;
          actions.push({ kind: "meld", cardIds: ids });
        } else {
          const di = jollyDiscardIndex(hand);
          if (di >= 0) {
            const restIds = hand.filter((_, i) => i !== di).map((c) => c.id);
            const r = layMeld(sim, restIds);
            if (!r.events.some((e) => e.type === "invalid")) {
              sim = r.state;
              actions.push({ kind: "meld", cardIds: restIds });
              const last = meOf(sim).hand[0];
              if (last) actions.push({ kind: "discard", cardId: last.id });
            }
          }
        }
        return actions; // round over, or take failed (unreachable)
      }
    }
    const from = shouldTakeDiscard(sim) ? "discard" : "stock";
    actions.push({ kind: "draw", from });
    const res = draw(sim, from);
    sim = res.state;
  }

  // 2) main combos (with optional re-planning after swaps)
  let guard = 0;
  let changed = true;
  const locked = meldsLocked(sim);
  while (changed && guard++ < 6) {
    changed = false;
    if (sim.phase !== "play") return actions; // closed
    if (locked) break; // first 3 rounds: no laying at all
    const me = meOf(sim);

    // A card taken from the pile (or a swapped joker) must be laid first —
    // packings are forced to include it so the turn can legally end.
    if (mustUseId(sim) !== null) {
      const used = useMustCard(sim, tableIds);
      if (used) {
        sim = used.state;
        actions.push(used.action);
        changed = true;
        if (sim.phase !== "play") return actions; // closed
        continue;
      }
      break; // stuck (unreachable — layability was checked at draw/swap)
    }

    // first meld or full packing
    const packing = me.melded
      ? bestPacking(me.hand, false, 0)
      : findFirstMeld(me.hand);
    if (packing && packing.melds.length > 0) {
      const ids = packing.melds.flatMap((m) => m.cards.map((c) => c.id));
      const r = layMeld(sim, ids);
      if (!r.events.some((e) => e.type === "invalid")) {
        sim = r.state;
        actions.push({ kind: "meld", cardIds: ids });
        changed = true;
        if (sim.phase !== "play") return actions; // closed
        continue;
      }
    }

    // layoffs (only after the bot has melded; pre-existing melds only)
    let layAny = false;
    if (meOf(sim).melded) {
      for (const card of [...meOf(sim).hand]) {
        const m = sim.melds.find(
          (x) => tableIds.has(x.id) && canAddToMeld(x, card) !== null
        );
        if (!m) continue;
        const r = layoff(sim, card.id, m.id);
        if (!r.events.some((e) => e.type === "invalid")) {
          sim = r.state;
          actions.push({ kind: "layoff", cardId: card.id, meldId: m.id });
          layAny = true;
          if (sim.phase !== "play") return actions; // closed
        }
      }
    }
    if (layAny) {
      changed = true;
      continue;
    }

    // joker swaps (hard: always usable; medium: only if the joker helps)
    if (!isEasy) {
      const swap = findJokerSwap(
        sim.melds.filter((m) => tableIds.has(m.id)),
        meOf(sim).hand
      );
      if (swap && jokerUsableAfterSwap(sim, swap.replacement.id, tableIds)) {
        let doSwap = isHard;
        if (!doSwap) {
          const me = meOf(sim);
          const fakeJoker: Card = { id: -1, suit: "s" as Suit, rank: 0, joker: true };
          const handAfter = [
            ...me.hand.filter((c) => c.id !== swap.replacement.id),
            fakeJoker,
          ];
          const before = bestPacking(me.hand, false, 0)?.points ?? 0;
          const after = bestPacking(handAfter, false, 0)?.points ?? 0;
          doSwap = after > before;
        }
        if (doSwap) {
          const r = swapJoker(
            sim,
            swap.replacement.id,
            swap.meldId,
            swap.jokerCardId
          );
          if (!r.events.some((e) => e.type === "invalid")) {
            sim = r.state;
            actions.push({
              kind: "swap",
              cardId: swap.replacement.id,
              meldId: swap.meldId,
              jokerCardId: swap.jokerCardId,
            });
            changed = true;
            continue;
          }
        }
      }
    }
  }

  if (sim.phase !== "play") return actions; // closed already

  // 3) discard
  const me = meOf(sim);
  if (me.hand.length > 0) {
    const card = chooseDiscard(sim);
    actions.push({ kind: "discard", cardId: card.id });
  }
  return actions;
}

/**
 * Lay the must-use card (taken pile card or swapped joker): prefer a direct
 * layoff, else a packing forced to include it.
 */
function useMustCard(
  sim: GameState,
  tableIds: Set<string>
): { state: GameState; action: BotAction } | null {
  const me = meOf(sim);
  const mustId = mustUseId(sim);
  if (mustId === null) return null;
  const card = me.hand.find((c) => c.id === mustId)!;
  if (me.melded || sim.jollyRush) {
    const m = sim.melds.find(
      (x) => tableIds.has(x.id) && canAddToMeld(x, card) !== null
    );
    if (m) {
      const r = layoff(sim, card.id, m.id);
      if (!r.events.some((e) => e.type === "invalid"))
        return {
          state: r.state,
          action: { kind: "layoff", cardId: card.id, meldId: m.id },
        };
    }
    if (!me.melded) return null;
  }
  const idx = me.hand.findIndex((c) => c.id === mustId);
  const packing = me.melded
    ? bestPackingIncluding(me.hand, false, 0, idx)
    : bestPackingIncluding(me.hand, true, RULES.FIRST_MELD_POINTS, idx);
  if (packing && packing.melds.length > 0) {
    const ids = packing.melds.flatMap((m) => m.cards.map((c) => c.id));
    const r = layMeld(sim, ids);
    if (!r.events.some((e) => e.type === "invalid"))
      return { state: r.state, action: { kind: "meld", cardIds: ids } };
  }
  return null;
}

/** Would the swapped-in joker be immediately usable (as required)? */
function jokerUsableAfterSwap(
  sim: GameState,
  replacementId: number,
  tableIds: Set<string>
): boolean {
  const me = meOf(sim);
  const fakeJoker: Card = { id: -1, suit: "s" as Suit, rank: 0, joker: true };
  const handAfter = [
    ...me.hand.filter((c) => c.id !== replacementId),
    fakeJoker,
  ];
  if (
    me.melded &&
    sim.melds.some(
      (m) => tableIds.has(m.id) && canAddToMeld(m, fakeJoker) !== null
    )
  )
    return true;
  const idx = handAfter.length - 1;
  return (
    bestPackingIncluding(
      handAfter,
      me.melded ? false : true,
      me.melded ? 0 : RULES.FIRST_MELD_POINTS,
      idx
    ) !== null
  );
}
