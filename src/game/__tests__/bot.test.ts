import { describe, expect, it } from "vitest";
import { planBotTurn } from "../bot";
import type { BotAction } from "../bot";
import {
  createGame,
  discard,
  draw,
  layMeld,
  layoff,
  meldsLocked,
  swapJoker,
  takeJolly,
} from "../engine";
import type { ActionResult, GameState } from "../engine";
import { bestPacking, canAddToMeld, findFirstMeld } from "../melds";
import { RULES } from "../core";
import { penaltyValue } from "../core";

function apply(state: GameState, a: BotAction): ActionResult {
  switch (a.kind) {
    case "draw":
      return draw(state, a.from);
    case "jolly":
      return takeJolly(state);
    case "meld":
      return layMeld(state, a.cardIds);
    case "layoff":
      return layoff(state, a.cardId, a.meldId);
    case "swap":
      return swapJoker(state, a.cardId, a.meldId, a.jokerCardId);
    case "discard":
      return discard(state, a.cardId);
  }
}

/** Applies a whole bot plan, returning every event type seen. */
function runPlan(state: GameState): { state: GameState; types: string[] } {
  let s = state;
  const types: string[] = [];
  for (const a of planBotTurn(s)) {
    const r = apply(s, a);
    types.push(...r.events.map((e) => e.type));
    s = r.state;
    if (s.phase !== "play") break;
  }
  return { state: s, types };
}

describe("planBotTurn", () => {
  for (const difficulty of ["easy", "medium", "hard"] as const) {
    it(`[${difficulty}] předák opens with a legal discard`, () => {
      const s = createGame({ playerCount: 2, difficulty, target: 300 });
      s.current = 1; // hand the opening to the bot
      s.turnPhase = "action";
      s.skipDraw = true;
      const { state: next, types } = runPlan(s);
      expect(types).not.toContain("invalid");
      expect(types).toContain("discard");
      expect(next.current).toBe(0);
    });

    it(`[${difficulty}] mid-game bot turns stay legal across fresh deals`, () => {
      for (let seed = 0; seed < 5; seed++) {
        let s = createGame({ playerCount: 2, difficulty, target: 300 });
        s.current = 1;
        s.turnCount = RULES.MELD_WAIT_ROUNDS * s.players.length;
        s.skipDraw = false;
        s.turnPhase = "draw";
        const { types } = runPlan(s);
        expect(types).not.toContain("invalid");
      }
    });
  }

  it("a bot turn ends with a discard or closes the round", () => {
    const s = createGame({ playerCount: 2, difficulty: "medium", target: 300 });
    s.current = 1;
    s.turnCount = RULES.MELD_WAIT_ROUNDS * s.players.length;
    s.skipDraw = false;
    s.turnPhase = "draw";
    const { state: next, types } = runPlan(s);
    expect(types).not.toContain("invalid");
    const closed = types.includes("close") || types.includes("roundEnd");
    expect(closed || types.at(-1) === "discard").toBe(true);
    if (!closed) expect(next.current).toBe(0);
    void next;
  });
});

describe("full game simulation (bot plans + naive legal human)", () => {
  it("plays without a single illegal action", () => {
    let s = createGame({ playerCount: 3, difficulty: "medium", target: 300 });
    let illegal = 0;
    let steps = 0;
    while (s.phase === "play" && steps++ < 400) {
      const me = s.players[s.current];
      if (me.isBot) {
        for (const a of planBotTurn(s)) {
          const r = apply(s, a);
          if (r.events.some((e) => e.type === "invalid")) illegal++;
          s = r.state;
          if (s.phase !== "play" || s.current !== me.id) break;
        }
        continue;
      }
      // naive human: stock draw, lay what packs, dump the priciest card
      if (s.skipDraw) {
        const card = me.hand.reduce((a, b) =>
          penaltyValue(a) >= penaltyValue(b) ? a : b
        );
        const r = discard(s, card.id);
        if (r.events.some((e) => e.type === "invalid")) illegal++;
        s = r.state;
        continue;
      }
      if (s.turnPhase === "draw") {
        const r = draw(s, "stock");
        if (r.events.some((e) => e.type === "invalid")) illegal++;
        s = r.state;
      }
      // lay melds once laying unlocks (first meld must pass the gate)
      if (!meldsLocked(s) && s.phase === "play") {
        const h = s.players[s.current].hand;
        const packing = s.players[s.current].melded
          ? bestPacking(h, false, 0)
          : findFirstMeld(h);
        if (packing && packing.melds.length > 0) {
          const ids = packing.melds.flatMap((m) => m.cards.map((x) => x.id));
          const r = layMeld(s, ids);
          if (r.events.some((e) => e.type === "invalid")) illegal++;
          s = r.state;
        }
      }
      // layoffs for melded humans
      if (!meldsLocked(s) && s.players[s.current].melded && s.phase === "play") {
        for (const card of [...s.players[s.current].hand]) {
          const m = s.melds.find((x) => canAddToMeld(x, card) !== null);
          if (!m) continue;
          const r = layoff(s, card.id, m.id);
          if (r.events.some((e) => e.type === "invalid")) illegal++;
          s = r.state;
          if (s.phase !== "play") break;
        }
      }
      if (s.phase !== "play" || s.players[s.current].hand.length === 0) break;
      const rest = s.players[s.current].hand;
      if (rest.length === 0) break;
      const card = rest.reduce((a, b) =>
        penaltyValue(a) >= penaltyValue(b) ? a : b
      );
      const r = discard(s, card.id);
      if (r.events.some((e) => e.type === "invalid")) illegal++;
      s = r.state;
    }
    expect(illegal).toBe(0);
  });
});
