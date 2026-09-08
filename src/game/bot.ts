/* ------------------------------------------------------------------ */
/*  ŽOLÍKY — bot AI                                                   */
/* ------------------------------------------------------------------ */

import { Card, Suit, penaltyValue } from "./core";
import {
  GameState,
  draw,
  layMeld,
  layoff,
  swapJoker,
  discardUseful,
} from "./engine";
import {
  bestPacking,
  findFirstMeld,
  canAddToMeld,
  findJokerSwap,
  findAllMelds,
} from "./melds";

export type BotAction =
  | { kind: "draw"; from: "stock" | "discard" }
  | { kind: "meld"; cardIds: number[] }
  | { kind: "layoff"; cardId: number; meldId: string }
  | { kind: "swap"; cardId: number; meldId: string; jokerCardId: number }
  | { kind: "discard"; cardId: number };

const meOf = (s: GameState) => s.players[s.current];

/* ------------------------------------------------------------------ */
/*  Draw decision                                                      */
/* ------------------------------------------------------------------ */

function shouldTakeDiscard(s: GameState): boolean {
  const me = meOf(s);
  const top = s.discard[s.discard.length - 1];
  if (!top) return false;
  const difficulty = me.difficulty ?? "medium";
  const canLayoff =
    me.melded && s.melds.some((m) => canAddToMeld(m, top) !== null);
  if (difficulty === "easy") {
    if (canLayoff) return true;
    if (!me.melded && findFirstMeld([...me.hand, top])) return true;
    return false;
  }
  return discardUseful(me.hand, top, s.melds, me.melded);
}

/* ------------------------------------------------------------------ */
/*  Discard decision                                                   */
/* ------------------------------------------------------------------ */

function chooseDiscard(s: GameState): Card {
  const me = meOf(s);
  const difficulty = me.difficulty ?? "medium";
  const nonJokers = me.hand.filter((c) => !c.joker);
  if (nonJokers.length === 0) return me.hand[0];

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

  // 1) draw (skipped by the předák, who starts the round with a discard)
  if (!sim.skipDraw) {
    const from = shouldTakeDiscard(sim) ? "discard" : "stock";
    actions.push({ kind: "draw", from });
    const res = draw(sim, from);
    sim = res.state;
  }

  // 2) main combos (with optional re-planning after swaps)
  let guard = 0;
  let changed = true;
  while (changed && guard++ < 3) {
    changed = false;
    const me = meOf(sim);

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

    // layoffs (only after the bot has melded)
    let layAny = false;
    if (meOf(sim).melded) {
      for (const card of [...meOf(sim).hand]) {
        const m = sim.melds.find((x) => canAddToMeld(x, card) !== null);
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

    // joker swaps (hard: always; medium: only if the joker helps a meld)
    if (!isEasy) {
      const swap = findJokerSwap(sim.melds, meOf(sim).hand);
      if (swap) {
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
