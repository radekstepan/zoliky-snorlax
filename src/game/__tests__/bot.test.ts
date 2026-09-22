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

  it("mid-turn replan (after a draw) never emits another draw", () => {
    // Regression: the App re-plans from the live state after any stale
    // action. A replan from turnPhase==="action" must not start with a
    // draw — engine.draw would reject it with "Už jsi táhl(a)." and the
    // bot chain would spin forever (frozen "si bere z hromádky…" status).
    for (let i = 0; i < 20; i++) {
      let s = createGame({ playerCount: 4, difficulty: "medium", target: 300 });
      s.current = 1;
      s.turnCount = RULES.MELD_WAIT_ROUNDS * s.players.length;
      s.skipDraw = false;
      s.turnPhase = "draw";
      const d = draw(s, "stock");
      expect(d.events.map((e) => e.type)).not.toContain("invalid");
      s = d.state;
      const replan = planBotTurn(s);
      expect(
        replan.filter((a) => a.kind === "draw" || a.kind === "jolly")
      ).toHaveLength(0);
      const { types } = runPlan(s);
      expect(types).not.toContain("invalid");
    }
  });

  it("replan from a předák (skipDraw) state never emits a draw", () => {
    const s = createGame({ playerCount: 2, difficulty: "medium", target: 300 });
    s.current = 1;
    s.turnPhase = "action";
    s.skipDraw = true;
    const plan = planBotTurn(s);
    expect(
      plan.filter((a) => a.kind === "draw" || a.kind === "jolly")
    ).toHaveLength(0);
  });

  it("replanned turns after pile takes always complete legally", () => {
    // Mirrors the App: apply the planned draw, then replan the rest of the
    // turn from the live state (stale-plan recovery). Every turn — pile
    // takes included — must finish with a discard or a close, never with
    // an illegal action (previously: "Už jsi táhl(a)." loops and turns
    // stuck on "musí ji hned vyložit").
    let pileTakes = 0;
    const problems: string[] = [];
    for (let g = 0; g < 2 && problems.length === 0; g++) {
      let s = createGame({ playerCount: 4, difficulty: "medium", target: 300 });
      let steps = 0;
      while (steps++ < 400 && problems.length === 0) {
        if (s.phase === "roundEnd") break; // single-round sample is enough
        if (s.phase !== "play") break;
        const me = s.players[s.current];
        if (!me.isBot) {
          // naive human: stock draw, lay what packs, dump priciest card
          if (s.skipDraw) {
            const card = me.hand.reduce((a, b) =>
              penaltyValue(a) >= penaltyValue(b) ? a : b
            );
            s = discard(s, card.id).state;
            continue;
          }
          if (s.turnPhase === "draw") s = draw(s, "stock").state;
          if (s.phase === "play" && s.current === me.id) {
            const h = s.players[s.current].hand;
            const packing = s.players[s.current].melded
              ? bestPacking(h, false, 0)
              : findFirstMeld(h);
            if (packing && packing.melds.length > 0) {
              s = layMeld(s, packing.melds.flatMap((m) => m.cards.map((x) => x.id))).state;
            }
          }
          if (s.phase !== "play" || s.current !== me.id) continue;
          const rest = s.players[s.current].hand;
          if (rest.length === 0) break;
          const card = rest.reduce((a, b) =>
            penaltyValue(a) >= penaltyValue(b) ? a : b
          );
          s = discard(s, card.id).state;
          continue;
        }
        const owner = s.current;
        const plan = planBotTurn(s);
        if (plan.length === 0) {
          problems.push(`empty plan for player ${owner}`);
          break;
        }
        const first = plan[0];
        if (first.kind === "jolly") {
          // atomic in the App: take-meld-discard with no replan between
          for (const a of plan) {
            const r = apply(s, a);
            if (r.events.some((e) => e.type === "invalid")) {
              problems.push(`jolly plan invalid at ${a.kind}`);
              break;
            }
            s = r.state;
            if (s.phase !== "play" || s.current !== owner) break;
          }
          continue;
        }
        const d = apply(s, first);
        if (d.events.some((e) => e.type === "invalid")) {
          problems.push(`first action invalid: ${first.kind}`);
          break;
        }
        s = d.state;
        if (s.phase !== "play" || s.current !== owner) continue;
        if (first.kind === "draw" && first.from === "discard") pileTakes++;
        const replan = planBotTurn(s);
        let i = 0;
        while (i < replan.length) {
          if (s.phase !== "play" || s.current !== owner) break;
          const r = apply(s, replan[i]);
          if (r.events.some((e) => e.type === "invalid")) {
            const msg = (r.events.find((e) => e.type === "invalid") as { message?: string })?.message;
            problems.push(`${msg} [after=${first.kind} at=${replan[i].kind}]`);
            break;
          }
          s = r.state;
          i++;
        }
        if (problems.length === 0 && s.phase === "play" && s.current === owner) {
          problems.push(`turn did not advance for player ${owner}`);
          break;
        }
      }
    }
    expect(pileTakes).toBeGreaterThan(0);
    expect(problems).toHaveLength(0);
  }, 60000);
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
