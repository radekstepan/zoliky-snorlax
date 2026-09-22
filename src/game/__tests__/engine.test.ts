import { describe, expect, it } from "vitest";
import {
  createGame,
  discard,
  discardUseful,
  draw,
  findDrawnId,
  layMeld,
  layoff,
  meldsLocked,
  nextRound,
  reorderHand,
  sortCards,
  sortHand,
  swapJoker,
  takeJolly,
  undoPickup,
} from "../engine";
import type { GameState } from "../engine";
import { tryCreateMeld } from "../melds";
import type { Card } from "../core";
import { JOKER_RANK, RULES } from "../core";

let id = 5000;
const c = (rank: number, suit: Card["suit"] = "h"): Card => ({ id: id++, suit, rank });
const joker = (): Card => ({ id: id++, suit: "s", rank: JOKER_RANK, joker: true });

const invalidOf = (events: { type: string }[]) =>
  events.filter((e) => e.type === "invalid");

/** Fresh game with the turn handed to controllable, lock-free defaults. */
function unlocked(game: GameState): GameState {
  const s = structuredClone(game);
  s.turnCount = RULES.MELD_WAIT_ROUNDS * s.players.length;
  s.skipDraw = false;
  return s;
}

function handIds(s: GameState, player = s.current): number[] {
  return s.players[player].hand.map((x) => x.id);
}

describe("createGame", () => {
  it("deals 13 to the předák and 12 to everyone else", () => {
    const s = createGame({ playerCount: 3, difficulty: "medium", target: 300 });
    expect(s.players).toHaveLength(3);
    expect(s.players[0].isBot).toBe(false);
    expect(s.players[1].isBot).toBe(true);
    expect(s.players[s.current].hand).toHaveLength(13);
    for (const p of s.players) {
      if (p.id !== s.current) expect(p.hand).toHaveLength(12);
    }
    expect(s.turnPhase).toBe("action");
    expect(s.skipDraw).toBe(true);
    expect(s.phase).toBe("play");
  });

  it("clamps player count to 2..4 and keeps all 108 cards in play", () => {
    const s = createGame({ playerCount: 9, difficulty: "easy", target: 200 });
    expect(s.players).toHaveLength(4);
    const inHands = s.players.reduce((n, p) => n + p.hand.length, 0);
    const total =
      inHands + s.deck.length + s.discard.length + (s.jollyCard ? 1 : 0);
    expect(total).toBe(108);
  });

  it("locks laying for the first three table rounds", () => {
    const s = createGame({ playerCount: 2, difficulty: "easy", target: 300 });
    expect(meldsLocked(s)).toBe(true);
    expect(meldsLocked(unlocked(s))).toBe(false);
  });
});

describe("discard / draw cycle", () => {
  it("the předák opens by discarding, then the next player draws stock", () => {
    let s = createGame({ playerCount: 2, difficulty: "easy", target: 300 });
    const first = s.players[s.current].hand[0].id;
    let r = discard(s, first);
    expect(invalidOf(r.events)).toHaveLength(0);
    s = r.state;
    expect(s.discard).toHaveLength(1);
    expect(s.turnPhase).toBe("draw");
    expect(s.skipDraw).toBe(false);

    const before = s.players[s.current].hand.length;
    r = draw(s, "stock");
    expect(invalidOf(r.events)).toHaveLength(0);
    expect(r.state.players[s.current].hand).toHaveLength(before + 1);
    expect(r.state.turnPhase).toBe("action");
  });

  it("rejects discarding a card that is not in hand (state untouched)", () => {
    const s = createGame({ playerCount: 2, difficulty: "easy", target: 300 });
    const r = discard(s, -12345);
    expect(invalidOf(r.events)).toHaveLength(1);
    expect(r.state).toBe(s);
  });

  it("rejects drawing twice and drawing before the opening discard", () => {
    const s = createGame({ playerCount: 2, difficulty: "easy", target: 300 });
    expect(invalidOf(draw(s, "stock").events)).toHaveLength(1); // action phase
    let next = discard(s, s.players[s.current].hand[0].id).state;
    next = draw(next, "stock").state;
    expect(invalidOf(draw(next, "stock").events)).toHaveLength(1);
  });

  it("rejects taking from the discard pile while laying is locked", () => {
    let s = createGame({ playerCount: 2, difficulty: "easy", target: 300 });
    s = discard(s, s.players[s.current].hand[0].id).state;
    const r = draw(s, "discard");
    expect(invalidOf(r.events)).toHaveLength(1);
  });

  it("lets a melded player take a layable pile card, flagging it pending", () => {
    let s = unlocked(createGame({ playerCount: 2, difficulty: "easy", target: 300 }));
    s.turnPhase = "draw";
    const table = tryCreateMeld([c(7, "h"), c(8, "h"), c(9, "h")])!;
    s.melds = [table];
    s.players[s.current].melded = true;
    const top = c(10, "h");
    s.discard = [c(2, "c"), top];
    const r = draw(s, "discard");
    expect(invalidOf(r.events)).toHaveLength(0);
    expect(r.state.pendingLayId).toBe(top.id);
  });

  it("rejects taking a pile card that cannot be laid at once", () => {
    let s = unlocked(createGame({ playerCount: 2, difficulty: "easy", target: 300 }));
    s.turnPhase = "draw";
    s.melds = [];
    s.players[s.current].melded = true;
    s.players[s.current].hand = [c(2, "c"), c(13, "d")];
    s.discard = [c(9, "s")];
    const r = draw(s, "discard");
    expect(invalidOf(r.events)).toHaveLength(1);
    expect(r.state).toBe(s);
  });

  it("lets an unmelded player take a pile card that opens via two melds", () => {
    // J♠ + K♠ in hand, Q♠ on the pile: J-Q-K (30) needs 8-9-10 diamonds
    // (27) to clear the 36-point first-meld gate.
    let s = unlocked(createGame({ playerCount: 2, difficulty: "easy", target: 300 }));
    s.turnPhase = "draw";
    s.melds = [];
    s.players[s.current].melded = false;
    s.players[s.current].hand = [c(11, "s"), c(13, "s"), c(8, "d"), c(9, "d"), c(10, "d")];
    const top = c(12, "s");
    s.discard = [top];
    const r = draw(s, "discard");
    expect(invalidOf(r.events)).toHaveLength(0);
    expect(r.state.pendingLayId).toBe(top.id);
  });

  it("ends the round with no closer when stock and pile are exhausted", () => {
    let s = unlocked(createGame({ playerCount: 2, difficulty: "easy", target: 300 }));
    s.turnPhase = "draw";
    s.deck = [];
    s.discard = [c(2, "c")];
    const r = draw(s, "stock");
    expect(r.state.phase).toBe("roundEnd");
    expect(r.state.roundEndInfo?.closedBy).toBe(-1);
  });
});

describe("layMeld", () => {
  function firstMeldHand(s: GameState): GameState {
    const next = structuredClone(s);
    // clean run Q-K-A (30) + sevens set (21) = 51 ≥ 36
    next.players[next.current].hand = [
      c(12, "h"), c(13, "h"), c(14, "h"),
      c(7, "h"), c(7, "d"), c(7, "s"),
      c(2, "c"),
    ];
    next.turnPhase = "action";
    return next;
  }

  it("lays a valid first meld and marks the player melded", () => {
    let s = unlocked(createGame({ playerCount: 2, difficulty: "easy", target: 300 }));
    s = firstMeldHand(s);
    const ids = handIds(s).slice(0, 6);
    const r = layMeld(s, ids);
    expect(invalidOf(r.events)).toHaveLength(0);
    expect(r.state.melds).toHaveLength(2);
    expect(r.state.players[s.current].melded).toBe(true);
    expect(r.state.players[s.current].hand).toHaveLength(1);
  });

  it("rejects laying while locked and below the 36-point gate", () => {
    const locked = createGame({ playerCount: 2, difficulty: "easy", target: 300 });
    expect(invalidOf(layMeld(locked, []).events)).toHaveLength(1);

    let s = unlocked(createGame({ playerCount: 2, difficulty: "easy", target: 300 }));
    s.players[s.current].hand = [c(7, "h"), c(8, "h"), c(9, "h"), c(2, "c")];
    s.turnPhase = "action";
    const r = layMeld(s, handIds(s).slice(0, 3));
    expect(invalidOf(r.events)).toHaveLength(1);
    expect(r.state).toBe(s);
  });

  it("rejects selections that do not form full melds", () => {
    let s = unlocked(createGame({ playerCount: 2, difficulty: "easy", target: 300 }));
    s.players[s.current].hand = [c(7, "h"), c(8, "h"), c(2, "c")];
    s.turnPhase = "action";
    const r = layMeld(s, handIds(s));
    expect(invalidOf(r.events)).toHaveLength(1);
  });

  it("accepts a gate-meeting grouping even when cards admit a non-clean cover", () => {
    // 5-6-7♠ (clean) + 10-11♥+J: one partition has a clean run, another
    // has none. layMeld must find the gate-meeting cover — a pile card
    // taken on this promise must always be layable (bot turns depend on it).
    let s = unlocked(createGame({ playerCount: 2, difficulty: "easy", target: 300 }));
    s.players[s.current].hand = [joker(), c(5, "s"), c(10, "h"), c(7, "s"), c(11, "h"), c(6, "s")];
    s.turnPhase = "action";
    const r = layMeld(s, handIds(s));
    expect(invalidOf(r.events)).toHaveLength(0);
    expect(r.state.players[s.current].melded).toBe(true);
  });
});

describe("layoff", () => {
  it("appends a fitting card and rejects the rest", () => {
    let s = unlocked(createGame({ playerCount: 2, difficulty: "easy", target: 300 }));
    const table = tryCreateMeld([c(7, "h"), c(8, "h"), c(9, "h")])!;
    s.melds = [table];
    const me = s.players[s.current];
    me.melded = true;
    const good = c(10, "h");
    const bad = c(10, "d");
    me.hand = [good, bad];
    s.turnPhase = "action";

    const ok = layoff(s, good.id, table.id);
    expect(invalidOf(ok.events)).toHaveLength(0);
    expect(ok.state.melds[0].cards).toHaveLength(4);

    const no = layoff(s, bad.id, table.id);
    expect(invalidOf(no.events)).toHaveLength(1);
  });

  it("requires the player to have melded first", () => {
    let s = unlocked(createGame({ playerCount: 2, difficulty: "easy", target: 300 }));
    const table = tryCreateMeld([c(7, "h"), c(8, "h"), c(9, "h")])!;
    s.melds = [table];
    s.players[s.current].hand = [c(10, "h")];
    s.turnPhase = "action";
    expect(invalidOf(layoff(s, s.players[s.current].hand[0].id, table.id).events)).toHaveLength(1);
  });
});

describe("swapJoker", () => {
  function swapped(s: GameState) {
    const next = structuredClone(s);
    const table = tryCreateMeld([c(7, "h"), c(8, "h"), joker()])!;
    const jokerId = table.cards.find((x) => x.joker)!.id;
    next.melds = [table];
    const rep = c(9, "h");
    next.players[next.current].hand = [rep, c(5, "d"), c(5, "s")];
    next.players[next.current].melded = true;
    next.turnPhase = "action";
    return { next, table, jokerId, rep };
  }

  it("swaps in the exact card and forces the joker to be used", () => {
    const s = unlocked(createGame({ playerCount: 2, difficulty: "easy", target: 300 }));
    const { next, table, jokerId, rep } = swapped(s);
    const r = swapJoker(next, rep.id, table.id, jokerId);
    expect(invalidOf(r.events)).toHaveLength(0);
    expect(r.state.pendingJokerId).not.toBeNull();

    // discarding is blocked until the swapped joker is laid
    const stuck = discard(r.state, c(4, "c").id);
    expect(invalidOf(stuck.events)).toHaveLength(1);

    // laying the joker in a new set clears the obligation
    const jokerIdInHand = r.state.pendingJokerId!;
    const lay = layMeld(
      r.state,
      r.state.players[r.state.current].hand
        .filter((x) => x.rank === 5 || x.id === jokerIdInHand)
        .map((x) => x.id)
    );
    expect(invalidOf(lay.events)).toHaveLength(0);
    expect(lay.state.pendingJokerId).toBeNull();
  });

  it("rejects a replacement that does not match the joker slot", () => {
    const s = unlocked(createGame({ playerCount: 2, difficulty: "easy", target: 300 }));
    const { next, table, jokerId } = swapped(s);
    next.players[next.current].hand.push(c(10, "h"));
    const r = swapJoker(next, next.players[next.current].hand.at(-1)!.id, table.id, jokerId);
    expect(invalidOf(r.events)).toHaveLength(1);
  });
});

describe("pending pile card", () => {
  it("must be laid before the turn can end", () => {
    let s = unlocked(createGame({ playerCount: 2, difficulty: "easy", target: 300 }));
    s.turnPhase = "draw";
    const table = tryCreateMeld([c(7, "h"), c(8, "h"), c(9, "h")])!;
    s.melds = [table];
    s.players[s.current].melded = true;
    s.players[s.current].hand = [c(2, "c")];
    const top = c(10, "h");
    s.discard = [top];
    s = draw(s, "discard").state;
    expect(s.pendingLayId).toBe(top.id);

    const blocked = discard(s, s.players[s.current].hand[0].id);
    expect(invalidOf(blocked.events)).toHaveLength(1);

    s = layoff(s, top.id, table.id).state;
    expect(s.pendingLayId).toBeNull();
    const done = discard(s, s.players[s.current].hand[0].id);
    expect(invalidOf(done.events)).toHaveLength(0);
  });

  it("melded player may take the pile card for a brand-new meld", () => {
    let s = unlocked(createGame({ playerCount: 2, difficulty: "easy", target: 300 }));
    s.turnPhase = "draw";
    const table = tryCreateMeld([c(7, "h"), c(8, "h"), c(9, "h")])!;
    s.melds = [table];
    s.players[s.current].melded = true;
    // two aces in hand, third ace (other suit) on the pile — no table layoff fits
    s.players[s.current].hand = [c(14, "h"), c(14, "d"), c(2, "c")];
    const top = c(14, "s");
    s.discard = [top];
    const r = draw(s, "discard");
    expect(invalidOf(r.events)).toHaveLength(0);
    expect(r.state.pendingLayId).toBe(top.id);
    // …and the new set can actually be laid
    const laid = layMeld(r.state, [s.players[s.current].hand[0].id, s.players[s.current].hand[1].id, top.id]);
    expect(invalidOf(laid.events)).toHaveLength(0);
  });
});

describe("undo discard pickup", () => {
  /** Melded player with a layable pile top, already picked up. */
  function pickedUp(): GameState {
    let s = unlocked(createGame({ playerCount: 2, difficulty: "easy", target: 300 }));
    s.turnPhase = "draw";
    const table = tryCreateMeld([c(7, "h"), c(8, "h"), c(9, "h")])!;
    s.melds = [table];
    s.players[s.current].melded = true;
    s.players[s.current].hand = [c(2, "c")];
    const top = c(10, "h");
    s.discard = [top];
    const r = draw(s, "discard");
    expect(invalidOf(r.events)).toHaveLength(0);
    expect(r.state.pendingLayId).toBe(top.id);
    return r.state;
  }

  it("returns the card to the pile top and resumes the draw step", () => {
    const s = pickedUp();
    const topId = s.pendingLayId!;
    const handBefore = handIds(s).length;
    const r = undoPickup(s);
    expect(invalidOf(r.events)).toHaveLength(0);
    expect(r.events).toContainEqual(
      expect.objectContaining({ type: "undoPickup", player: s.current })
    );
    const next = r.state;
    expect(next.pendingLayId).toBeNull();
    expect(next.turnPhase).toBe("draw");
    expect(handIds(next)).toHaveLength(handBefore - 1);
    expect(handIds(next)).not.toContain(topId);
    // the exact card is back on top of the pile, pile order preserved
    expect(next.discard[next.discard.length - 1].id).toBe(topId);
    // the player can draw again — the soft-lock is gone
    const again = draw(next, "stock");
    expect(invalidOf(again.events)).toHaveLength(0);
    expect(again.state.turnPhase).toBe("action");
  });

  it("unblocks a turn stuck on the must-lay rule", () => {
    const s = pickedUp();
    // any discard is blocked while the pickup is pending …
    const blocked = discard(s, s.players[s.current].hand[0].id);
    expect(invalidOf(blocked.events)).toHaveLength(1);
    // … but after the undo the turn can proceed normally
    const undone = undoPickup(s).state;
    const drawn = draw(undone, "stock").state;
    const done = discard(drawn, drawn.players[drawn.current].hand[0].id);
    expect(invalidOf(done.events)).toHaveLength(0);
  });

  it("rejects undo with no pending pickup (state untouched)", () => {
    const plain = unlocked(createGame({ playerCount: 2, difficulty: "easy", target: 300 }));
    plain.turnPhase = "action";
    expect(invalidOf(undoPickup(plain).events)).toHaveLength(1);
    expect(undoPickup(plain).state).toBe(plain);

    // stock draws never create a pending pickup
    let s = unlocked(createGame({ playerCount: 2, difficulty: "easy", target: 300 }));
    s.turnPhase = "draw";
    s = draw(s, "stock").state;
    expect(s.pendingLayId).toBeNull();
    expect(invalidOf(undoPickup(s).events)).toHaveLength(1);
    expect(undoPickup(s).state).toBe(s);
  });

  it("rejects undo once anything has been laid after the pickup", () => {
    const s = pickedUp();
    const table = s.melds[0];
    const laid = layoff(s, s.pendingLayId!, table.id).state;
    expect(laid.pendingLayId).toBeNull();
    // pending card already used — nothing to return
    expect(invalidOf(undoPickup(laid).events)).toHaveLength(1);

    // laying an unrelated card also locks the pickup in
    const s2 = pickedUp();
    const otherTable = tryCreateMeld([c(4, "d"), c(5, "d"), c(6, "d")])!;
    s2.melds.push(otherTable);
    s2.players[s2.current].hand.push(c(7, "d"));
    const laidOther = layoff(s2, s2.players[s2.current].hand.at(-1)!.id, otherTable.id).state;
    expect(laidOther.pendingLayId).not.toBeNull();
    const stuck = undoPickup(laidOther);
    expect(invalidOf(stuck.events)).toHaveLength(1);
    expect(stuck.state).toBe(laidOther);
  });
});

describe("closing, scoring and next round", () => {
  it("closing face-down banks 0 for the closer and -1 per card for others", () => {
    let s = unlocked(createGame({ playerCount: 2, difficulty: "easy", target: 300 }));
    const me = s.current;
    const other = (me + 1) % 2;
    s.players[me].hand = [c(2, "c")];
    s.players[other].hand = [c(3, "d"), c(4, "s"), joker()];
    s.turnPhase = "action";
    const r = discard(s, s.players[me].hand[0].id);
    expect(r.state.phase).toBe("roundEnd");
    expect(r.state.roundEndInfo?.closedBy).toBe(me);
    expect(r.state.players[me].roundDelta).toBe(0);
    // the joker is stashed for next round, not penalized
    expect(r.state.players[other].roundDelta).toBe(-2);
    expect(r.state.players[other].stash).toHaveLength(1);
  });

  it("a Jolly Hand lays the whole hand and doubles everyone else", () => {
    let s = unlocked(createGame({ playerCount: 2, difficulty: "easy", target: 300 }));
    s.turnPhase = "draw";
    const me = s.current;
    const other = (me + 1) % 2;
    s.players[me].hand = [
      c(7, "h"), c(7, "d"), c(7, "s"),
      c(8, "h"), c(8, "d"), c(8, "s"),
      c(9, "h"), c(9, "d"), c(9, "s"),
      c(12, "h"), c(13, "h"), c(14, "h"),
    ];
    s.players[other].hand = [c(3, "d"), c(4, "s")];
    s.jollyCard = joker(); // completes the sevens into a four-set: 3+3+3+4 = 13
    const taken = takeJolly(s);
    expect(invalidOf(taken.events)).toHaveLength(0);
    expect(taken.state.jollyRush).toBe(true);
    const laid = layMeld(taken.state, taken.state.players[me].hand.map((x) => x.id));
    expect(invalidOf(laid.events)).toHaveLength(0);
    expect(laid.state.phase).toBe("roundEnd");
    expect(laid.state.roundEndInfo?.jolly).toBe(true);
    expect(laid.state.players[other].roundDelta).toBe(-4);
  });

  it("a Jolly Hand closes by melding 12 and discarding the last card", () => {
    let s = unlocked(createGame({ playerCount: 2, difficulty: "easy", target: 300 }));
    s.turnPhase = "draw";
    const me = s.current;
    const other = (me + 1) % 2;
    const spades = [c(10, "s"), c(11, "s"), c(12, "s"), c(13, "s")];
    const sevens = [c(7, "h"), c(7, "d"), c(7, "s")];
    const hearts = [c(10, "h"), c(11, "h"), c(12, "h"), c(13, "h"), c(14, "h")];
    s.players[me].hand = [...spades, ...sevens, ...hearts];
    s.players[other].hand = [c(3, "d"), c(4, "s")];
    s.jollyCard = c(3, "c"); // odd card out — meld the rest, discard it
    const taken = takeJolly(s);
    expect(invalidOf(taken.events)).toHaveLength(0);
    expect(taken.state.jollyRush).toBe(true);
    // discarding mid-rush is blocked until a single card is left
    const early = discard(taken.state, taken.state.players[me].hand[0].id);
    expect(invalidOf(early.events)).toHaveLength(1);
    // lay in parts, then discard the last card to close
    const ids = (cards: Card[]) => cards.map((x) => x.id);
    const lay1 = layMeld(taken.state, ids(spades));
    expect(invalidOf(lay1.events)).toHaveLength(0);
    const lay2 = layMeld(lay1.state, ids(sevens));
    expect(invalidOf(lay2.events)).toHaveLength(0);
    const lay3 = layMeld(lay2.state, ids(hearts));
    expect(invalidOf(lay3.events)).toHaveLength(0);
    expect(lay3.state.phase).toBe("play");
    expect(lay3.state.players[me].hand).toHaveLength(1);
    const closed = discard(lay3.state, lay3.state.players[me].hand[0].id);
    expect(invalidOf(closed.events)).toHaveLength(0);
    expect(closed.state.phase).toBe("roundEnd");
    expect(closed.state.roundEndInfo?.jolly).toBe(true);
    expect(closed.events).toContainEqual(
      expect.objectContaining({ type: "close", player: me, jolly: true })
    );
    expect(closed.state.players[other].roundDelta).toBe(-4);
  });

  it("takeJolly rejects unlayable hands", () => {
    let s = unlocked(createGame({ playerCount: 2, difficulty: "easy", target: 300 }));
    s.turnPhase = "draw";
    s.players[s.current].hand = [c(2, "c"), c(13, "d")];
    while (s.players[s.current].hand.length < RULES.HAND_SIZE) {
      s.players[s.current].hand.push(c(4, "s"));
    }
    s.jollyCard = c(9, "s");
    expect(invalidOf(takeJolly(s).events)).toHaveLength(1);
  });

  it("nextRound redeals and ends the game past the target", () => {
    let s = unlocked(createGame({ playerCount: 2, difficulty: "easy", target: 10 }));
    s.players[0].score = -9;
    s.players[1].score = -9;
    const me = s.current;
    s.players[me].hand = [c(2, "c")];
    s.players[(me + 1) % 2].hand = [c(3, "d"), c(4, "s")];
    s.turnPhase = "action";
    const closed = discard(s, s.players[me].hand[0].id);
    expect(closed.state.phase).toBe("gameEnd");
    expect(closed.state.winner).toBe(me);

    // ...while a calm round just advances the deal
    let calm = unlocked(createGame({ playerCount: 2, difficulty: "easy", target: 300 }));
    const cme = calm.current;
    calm.players[cme].hand = [c(2, "c")];
    calm.players[(cme + 1) % 2].hand = [c(3, "d")];
    calm.turnPhase = "action";
    const end = discard(calm, calm.players[cme].hand[0].id);
    expect(end.state.phase).toBe("roundEnd");
    const round = nextRound(end.state);
    expect(round.state.phase).toBe("play");
    expect(round.state.round).toBe(2);
  });

  it("nextRound rejoins stashed jokers with fresh ids (no deck collision)", () => {
    // Stashed jokers keep last round's ids, which the freshly built deck
    // reuses — rejoining must re-assign ids above the deck range, or two
    // physical cards would share an id and id-based removal would drop both.
    let s = createGame({ playerCount: 2, difficulty: "easy", target: 300 });
    s.phase = "roundEnd";
    s.players[0].stash = [{ id: 5, suit: "s", rank: JOKER_RANK, joker: true }];
    const r = nextRound(s);
    expect(invalidOf(r.events)).toHaveLength(0);
    expect(r.state.players[0].hand.some((x) => x.joker)).toBe(true);
    const ids = [
      ...r.state.deck.map((x) => x.id),
      ...r.state.discard.map((x) => x.id),
      ...r.state.players.flatMap((p) => p.hand.map((x) => x.id)),
      ...(r.state.jollyCard ? [r.state.jollyCard.id] : []),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("sortHand and discardUseful", () => {
  it("sortHand groups suits and parks jokers at the end", () => {
    let s = unlocked(createGame({ playerCount: 2, difficulty: "easy", target: 300 }));
    s.players[s.current].hand = [c(9, "h"), joker(), c(2, "d"), c(5, "h"), c(3, "d")];
    const r = sortHand(s);
    const hand = r.state.players[s.current].hand;
    expect(hand.at(-1)!.joker).toBe(true);
    const suits = hand.filter((x) => !x.joker).map((x) => x.suit);
    expect(new Set(suits).size).toBeLessThanOrEqual(2);
    for (let i = 1; i < suits.length; i++) {
      if (suits[i] !== suits[0]) {
        expect(suits.slice(i).every((x) => x === suits[i])).toBe(true);
        break;
      }
    }
  });

  it("sortCards slots a newly drawn card into sorted order", () => {
    const hand = [c(9, "h"), c(2, "d"), c(5, "h"), c(3, "d")];
    const sorted = sortCards(hand);
    // a new card appended to a sorted hand re-sorts to the same order as sorting all at once
    const newcomer = c(4, "d");
    expect(sortCards([...sorted, newcomer])).toEqual(sortCards([...hand, newcomer]));
    // pure: input untouched, jokers still parked last
    expect(sortCards([...sorted, joker()]).at(-1)!.joker).toBe(true);
    expect(hand).toHaveLength(4);
  });

  it("findDrawnId spots the newcomer even after an auto-sort", () => {
    const sorted = sortCards([c(9, "h"), c(2, "d"), c(5, "h"), c(3, "d")]);
    const newcomer = c(4, "d");
    // appended → last; re-sorted → mid-hand; both must resolve to newcomer
    expect(findDrawnId(sorted, [...sorted, newcomer])).toBe(newcomer.id);
    expect(findDrawnId(sorted, sortCards([...sorted, newcomer]))).toBe(newcomer.id);
    // jolly-style insert that sorts somewhere in the middle
    const j = joker();
    expect(findDrawnId(sorted, sortCards([...sorted, j]))).toBe(j.id);
    // no newcomer → null
    expect(findDrawnId(sorted, [...sorted])).toBeNull();
    expect(findDrawnId(sorted, sortCards([...sorted]))).toBeNull();
  });

  it("reorderHand reapplies a dragged card order without touching the cards", () => {
    let s = unlocked(createGame({ playerCount: 2, difficulty: "easy", target: 300 }));
    s.players[s.current].hand = [c(2, "h"), c(5, "d"), c(9, "s")];
    const ids = handIds(s);
    // drag the last card to the front
    const r = reorderHand(s, [ids[2], ids[0], ids[1]]);
    expect(r.events).toHaveLength(0);
    expect(handIds(r.state)).toEqual([ids[2], ids[0], ids[1]]);
    // same card objects, input state untouched
    expect(r.state.players[s.current].hand[0]).toEqual(s.players[s.current].hand[2]);
    expect(handIds(s)).toEqual(ids);
  });

  it("reorderHand ignores unchanged, incomplete or duplicated orders", () => {
    let s = unlocked(createGame({ playerCount: 2, difficulty: "easy", target: 300 }));
    s.players[s.current].hand = [c(2, "h"), c(5, "d"), c(9, "s")];
    const ids = handIds(s);
    expect(reorderHand(s, [...ids]).state).toBe(s);
    expect(reorderHand(s, [ids[0], ids[1]]).state).toBe(s);
    expect(reorderHand(s, [ids[0], ids[0], ids[1]]).state).toBe(s);
    expect(reorderHand(s, [ids[0], ids[1], 999999]).state).toBe(s);
  });

  it("discardUseful spots layoffs and 3-card completions", () => {
    const table = tryCreateMeld([c(7, "h"), c(8, "h"), c(9, "h")])!;
    expect(discardUseful([], c(10, "h"), [table], true)).toBe(true);
    expect(discardUseful([c(7, "d"), c(7, "s")], c(7, "c"), [], false)).toBe(true);
    expect(discardUseful([c(2, "c"), c(13, "d")], c(9, "s"), [], false)).toBe(false);
  });
});
