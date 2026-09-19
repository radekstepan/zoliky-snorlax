/* ------------------------------------------------------------------ */
/*  ŽOLÍKY — game state machine                                       */
/* ------------------------------------------------------------------ */

import {
  Card,
  buildDeck,
  shuffle,
  RULES,
  BOT_NAMES,
  AVATAR_HUES,
} from "./core";
import {
  Meld,
  canAddToMeld,
  firstMeldOk,
  firstMeldProblem,
  coverAll,
  findAllMelds,
  meldPoints,
  sumPenalty,
  tryCreateMeld,
  JokerSwap,
} from "./melds";

export type Phase = "play" | "roundEnd" | "gameEnd";
export type TurnPhase = "draw" | "action";
export type Difficulty = "easy" | "medium" | "hard";

export interface PlayerState {
  id: number;
  name: string;
  isBot: boolean;
  difficulty?: Difficulty;
  hand: Card[];
  melded: boolean;
  score: number;
  roundDelta: number;
  closedRounds: number;
  hue: number;
}

export interface LogEntry {
  id: number;
  text: string;
  kind: "info" | "good" | "bad" | "warn";
}

export interface RoundEndInfo {
  closedBy: number; // player index, -1 if no closer
  fromHand: boolean;
  deltas: { id: number; points: number; doubled: boolean }[];
}

export interface GameState {
  phase: Phase;
  players: PlayerState[];
  current: number;
  turnPhase: TurnPhase;
  skipDraw: boolean; // předák's first turn (discard only)
  deck: Card[];
  discard: Card[];
  melds: Meld[];
  round: number;
  dealer: number;
  log: LogEntry[];
  roundEndInfo: RoundEndInfo | null;
  winner: number | null;
  turnCount: number;
  target: number;
  difficulty: Difficulty;
  reshuffles: number;
}

export type GameEvent =
  | { type: "draw"; player: number; from: "stock" | "discard" }
  | { type: "discard"; player: number; card: Card }
  | { type: "meld"; player: number; points: number }
  | { type: "layoff"; player: number }
  | { type: "swap"; player: number }
  | { type: "invalid"; message: string }
  | { type: "close"; player: number; fromHand: boolean }
  | { type: "roundEnd" }
  | { type: "reshuffle" }
  | { type: "gameEnd"; winner: number };

export interface ActionResult {
  state: GameState;
  events: GameEvent[];
}

export interface GameConfig {
  playerCount: number;
  difficulty: Difficulty;
  target: number;
}

let logSeq = 0;

/* ------------------------------------------------------------------ */
/*  Setup                                                              */
/* ------------------------------------------------------------------ */

export function createGame(config: GameConfig): GameState {
  const n = Math.max(2, Math.min(4, config.playerCount));
  const players: PlayerState[] = [
    {
      id: 0,
      name: "Ty",
      isBot: false,
      hand: [],
      melded: false,
      score: 0,
      roundDelta: 0,
      closedRounds: 0,
      hue: AVATAR_HUES[0],
    },
  ];
  for (let i = 1; i < n; i++) {
    players.push({
      id: i,
      name: BOT_NAMES[(i - 1) % BOT_NAMES.length],
      isBot: true,
      difficulty: config.difficulty,
      hand: [],
      melded: false,
      score: 0,
      roundDelta: 0,
      closedRounds: 0,
      hue: AVATAR_HUES[i % AVATAR_HUES.length],
    });
  }
  const state: GameState = {
    phase: "play",
    players,
    current: 0,
    turnPhase: "draw",
    skipDraw: false,
    deck: [],
    discard: [],
    melds: [],
    round: 1,
    dealer: Math.floor(Math.random() * n),
    log: [],
    roundEndInfo: null,
    winner: null,
    turnCount: 0,
    target: config.target,
    difficulty: config.difficulty,
    reshuffles: 0,
  };
  dealRound(state);
  return state;
}

function dealRound(state: GameState): void {
  const n = state.players.length;
  state.deck = shuffle(buildDeck());
  state.discard = [];
  state.melds = [];
  state.phase = "play";
  state.roundEndInfo = null;
  state.winner = null;
  for (const p of state.players) {
    p.hand = [];
    p.melded = false;
    p.roundDelta = 0;
  }
  for (let c = 0; c < RULES.HAND_SIZE; c++) {
    for (const p of state.players) p.hand.push(state.deck.pop()!);
  }
  const predak = (state.dealer + 1) % n;
  state.players[predak].hand.push(state.deck.pop()!); // 15th card
  state.current = predak;
  state.turnCount = 0;
  state.turnPhase = "action";
  state.skipDraw = true;
  pushLog(
    state,
    `Kolo ${state.round} — ${state.players[predak].name} začíná a odhazuje kartu.`,
    "info"
  );
}

export function pushLog(
  state: GameState,
  text: string,
  kind: LogEntry["kind"] = "info"
): void {
  state.log.push({ id: ++logSeq, text, kind });
  if (state.log.length > 40) state.log.splice(0, state.log.length - 40);
}

/* ------------------------------------------------------------------ */
/*  Draw                                                               */
/* ------------------------------------------------------------------ */

export function draw(state: GameState, from: "stock" | "discard"): ActionResult {
  if (state.phase !== "play") return invalid(state, "Hra neběží.");
  if (state.turnPhase !== "draw") return invalid(state, "Už jsi táhl(a).");
  if (state.skipDraw)
    return invalid(state, "Pro zahájení kola odhoď jednu kartu.");
  const s = structuredClone(state);
  const events: GameEvent[] = [];
  const me = s.players[s.current];

  if (from === "discard") {
    if (s.discard.length === 0) return invalid(state, "Hromádka je prázdná.");
    const card = s.discard.pop()!;
    me.hand.push(card);
    pushLog(s, `${me.name} si bere kartu z hromádky.`, "info");
  } else {
    if (s.deck.length === 0) {
      // reshuffle discard (keep top card)
      if (s.discard.length <= 1) {
        // no cards left — round ends without a closer
        return endRound(s, -1, false, []);
      }
      const top = s.discard.pop()!;
      s.deck = shuffle(s.discard);
      s.discard = [top];
      s.reshuffles++;
      events.push({ type: "reshuffle" });
      pushLog(s, "Dobírací balíček byl obnoven z hromádky.", "info");
    }
    const card = s.deck.pop()!;
    me.hand.push(card);
  }
  s.turnPhase = "action";
  events.push({ type: "draw", player: s.current, from });
  return { state: s, events };
}

/* ------------------------------------------------------------------ */
/*  Lay a new meld (may contain multiple disjoint melds)               */
/* ------------------------------------------------------------------ */

export function layMeld(state: GameState, cardIds: number[]): ActionResult {
  if (state.phase !== "play") return invalid(state, "Hra neběží.");
  if (state.turnPhase !== "action")
    return invalid(state, "Nejprve si táhni kartu.");
  const me = state.players[state.current];
  const selected = me.hand.filter((c) => cardIds.includes(c.id));
  if (selected.length !== cardIds.length)
    return invalid(state, "Vyber karty z ruky.");
  if (selected.length < RULES.SET_MIN)
    return invalid(state, "Kombinace musí mít alespoň 3 karty.");

  // Partition selection into valid melds covering ALL selected cards
  const covered = coverAll(selected);
  if (!covered || covered.length === 0)
    return invalid(
      state,
      "Vybrané karty netvoří platné kombinace (musí být využity všechny)."
    );

  const s = structuredClone(state);
  const p = s.players[s.current];
  const wasMelded = p.melded;
  const newMelds = covered.map((m) => ({ ...m, owner: p.id }));

  if (!wasMelded && !firstMeldOk(newMelds)) {
    return invalid(state, firstMeldProblem(newMelds) ?? "Neplatný první výklad.");
  }

  const ids = new Set(cardIds);
  p.hand = p.hand.filter((c) => !ids.has(c.id));
  s.melds.push(...newMelds);
  p.melded = true;
  const pts = newMelds.reduce((a, m) => a + meldPoints(m), 0);
  pushLog(
    s,
    `${p.name} vykládá ${newMelds.length} kombinac${
      newMelds.length === 1 ? "i" : "e"
    } za ${pts} bodů.`,
    "good"
  );
  const events: GameEvent[] = [{ type: "meld", player: s.current, points: pts }];
  if (p.hand.length === 0) {
    return endRound(s, s.current, !wasMelded, [
      ...events,
      { type: "close", player: s.current, fromHand: !wasMelded },
    ]);
  }
  return { state: s, events };
}

/* ------------------------------------------------------------------ */
/*  Lay off onto an existing meld                                      */
/* ------------------------------------------------------------------ */

export function layoff(
  state: GameState,
  cardId: number,
  meldId: string
): ActionResult {
  if (state.phase !== "play") return invalid(state, "Hra neběží.");
  if (state.turnPhase !== "action")
    return invalid(state, "Nejprve si táhni kartu.");
  const me = state.players[state.current];
  if (!me.melded)
    return invalid(state, "Nejprve musíš vyložit své kombinace (51 bodů).");
  const card = me.hand.find((c) => c.id === cardId);
  if (!card) return invalid(state, "Karta není v ruce.");
  const meld = state.melds.find((m) => m.id === meldId);
  if (!meld) return invalid(state, "Kombinace neexistuje.");
  const placed = canAddToMeld(meld, card);
  if (!placed)
    return invalid(state, "Tato karta se do kombinace nehodí.");

  const s = structuredClone(state);
  const p = s.players[s.current];
  const m = s.melds.find((x) => x.id === meldId)!;
  p.hand = p.hand.filter((c) => c.id !== cardId);
  m.cards.push(placed);
  if (m.type === "run") {
    m.cards.sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));
    m.lo = Math.min(
      ...m.cards.map((c) => c.slot ?? (c.rank === 14 ? 14 : c.rank))
    );
  }
  pushLog(s, `${p.name} přikládá kartu do kombinace.`, "info");
  const events: GameEvent[] = [{ type: "layoff", player: s.current }];
  if (p.hand.length === 0) {
    return endRound(s, s.current, false, [
      ...events,
      { type: "close", player: s.current, fromHand: false },
    ]);
  }
  return { state: s, events };
}

/* ------------------------------------------------------------------ */
/*  Joker swap                                                         */
/* ------------------------------------------------------------------ */

export function swapJoker(
  state: GameState,
  cardId: number,
  meldId: string,
  jokerCardId: number
): ActionResult {
  if (state.phase !== "play") return invalid(state, "Hra neběží.");
  if (state.turnPhase !== "action")
    return invalid(state, "Nejprve si táhni kartu.");
  const me = state.players[state.current];
  const card = me.hand.find((c) => c.id === cardId);
  if (!card) return invalid(state, "Karta není v ruce.");
  const meld = state.melds.find((m) => m.id === meldId);
  if (!meld) return invalid(state, "Kombinace neexistuje.");
  const jokerCard = meld.cards.find((c) => c.id === jokerCardId);
  if (!jokerCard || !jokerCard.joker)
    return invalid(state, "V kombinaci není žolík.");
  const swap: JokerSwap = {
    meldId,
    jokerCardId,
    replacement: card,
    as: jokerCard.jokerAs ?? 0,
  };
  // exact match validation (suit/rank rules)
  if (meld.type === "set") {
    if (card.rank !== meld.rank)
      return invalid(state, "Karta musí mít stejnou hodnotu.");
    if (
      meld.cards.some(
        (c) => !c.joker && c.id !== jokerCardId && c.suit === card.suit
      )
    )
      return invalid(state, "Tato barva už v kombinaci je.");
  } else {
    if (card.suit !== meld.suit)
      return invalid(state, "Karta musí být stejné barvy.");
    const as = jokerCard.jokerAs!;
    if ((as === 1 || as === 14) && card.rank !== 14)
      return invalid(state, "Na toto místo patří eso.");
    if (as >= 2 && as <= 13 && card.rank !== as)
      return invalid(state, "Karta se na toto místo nehodí.");
  }

  const s = structuredClone(state);
  const p = s.players[s.current];
  const m = s.melds.find((x) => x.id === meldId)!;
  p.hand = p.hand.filter((c) => c.id !== cardId);
  const jc = m.cards.find((c) => c.id === jokerCardId)!;
  m.cards = m.cards.filter((c) => c.id !== jokerCardId);
  const rep = { ...card, jokerAs: undefined, slot: m.type === "run" ? swap.as : undefined };
  m.cards.push(rep);
  if (m.type === "run") {
    m.cards.sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));
    m.lo = Math.min(...m.cards.map((c) => c.slot ?? c.rank));
  }
  const jokerToHand: Card = { id: jc.id, suit: jc.suit, rank: jc.rank, joker: true };
  p.hand.push(jokerToHand);
  pushLog(s, `${p.name} vyměňuje žolíka.`, "info");
  return { state: s, events: [{ type: "swap", player: s.current }] };
}

/* ------------------------------------------------------------------ */
/*  Discard / close                                                    */
/* ------------------------------------------------------------------ */

export function discard(state: GameState, cardId: number): ActionResult {
  if (state.phase !== "play") return invalid(state, "Hra neběží.");
  if (state.turnPhase !== "action")
    return invalid(state, "Nejprve si táhni kartu.");
  const me = state.players[state.current];
  const card = me.hand.find((c) => c.id === cardId);
  if (!card) return invalid(state, "Karta není v ruce.");

  const s = structuredClone(state);
  const p = s.players[s.current];
  p.hand = p.hand.filter((c) => c.id !== cardId);
  s.discard.push(card);
  const events: GameEvent[] = [{ type: "discard", player: s.current, card }];
  pushLog(s, `${p.name} odhazuje.`, "info");

  if (p.hand.length === 0) {
    const fromHand = !p.melded;
    return endRound(s, s.current, fromHand, [
      ...events,
      { type: "close", player: s.current, fromHand },
    ]);
  }

  s.skipDraw = false;
  s.current = (s.current + 1) % s.players.length;
  s.turnPhase = "draw";
  s.turnCount++;
  return { state: s, events };
}

/* ------------------------------------------------------------------ */
/*  Round / game end                                                   */
/* ------------------------------------------------------------------ */

function endRound(
  s: GameState,
  closedBy: number,
  fromHand: boolean,
  events: GameEvent[]
): ActionResult {
  const deltas: RoundEndInfo["deltas"] = [];
  for (const p of s.players) {
    let points = sumPenalty(p.hand);
    const isCloser = closedBy >= 0 && p.id === closedBy;
    if (fromHand && !isCloser) points *= 2;
    if (isCloser) points = 0; // the closer counts nothing
    p.roundDelta = points;
    p.score += points;
    deltas.push({ id: p.id, points, doubled: fromHand && !isCloser });
  }
  if (closedBy >= 0) {
    s.players[closedBy].closedRounds++;
    s.players[closedBy].roundDelta = 0;
    pushLog(
      s,
      `${s.players[closedBy].name} zavírá${
        fromHand ? " z ruky (dvojnásobné body!)" : ""
      }!`,
      "good"
    );
  } else {
    pushLog(s, "Karty došly — kolo končí bez zavření.", "warn");
  }
  s.phase = "roundEnd";
  s.roundEndInfo = { closedBy, fromHand, deltas };
  const newEvents: GameEvent[] = [...events, { type: "roundEnd" }];
  if (s.players.some((p) => p.score >= s.target)) {
    let bestIdx = 0;
    for (let i = 1; i < s.players.length; i++) {
      if (s.players[i].score < s.players[bestIdx].score) bestIdx = i;
    }
    s.winner = bestIdx;
    s.phase = "gameEnd";
    newEvents.push({ type: "gameEnd", winner: bestIdx });
    pushLog(
      s,
      `Konec hry — vítězí ${s.players[bestIdx].name} s ${s.players[bestIdx].score} body!`,
      "good"
    );
  }
  return { state: s, events: newEvents };
}

export function nextRound(state: GameState): ActionResult {
  if (state.phase !== "roundEnd") return invalid(state, "Kolo neskončilo.");
  const s = structuredClone(state);
  s.round++;
  s.dealer = (s.dealer + 1) % s.players.length;
  dealRound(s);
  return { state: s, events: [] };
}

export function rematch(config: GameConfig): GameState {
  return createGame(config);
}

/* ------------------------------------------------------------------ */
/*  Sorting hand                                                       */
/* ------------------------------------------------------------------ */

export function sortHand(state: GameState): ActionResult {
  const s = structuredClone(state);
  const p = s.players[s.current];
  // Suits grouped but ordered to alternate black/red (s=black, h=red,
  // c=black, d=red) so the two red suits never sit side by side.
  const suitOrder = { s: 0, h: 1, c: 2, d: 3 } as const;
  p.hand.sort((a, b) => {
    if (a.joker && b.joker) return 0;
    if (a.joker) return 1;
    if (b.joker) return -1;
    if (suitOrder[a.suit] !== suitOrder[b.suit])
      return suitOrder[a.suit] - suitOrder[b.suit];
    return a.rank - b.rank;
  });
  return { state: s, events: [] };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function invalid(state: GameState, message: string): ActionResult {
  return { state, events: [{ type: "invalid", message }] };
}

/** Does the top discard improve this player's hand (for bots)? */
export function discardUseful(
  hand: Card[],
  top: Card,
  tableMelds: Meld[],
  melded: boolean
): boolean {
  if (melded && tableMelds.some((m) => canAddToMeld(m, top) !== null))
    return true;
  // cheap check: does the top card complete any 3–4 card meld?
  const pool = [...hand, top];
  const topIdx = pool.length - 1;
  for (let i = 0; i < pool.length; i++) {
    if (i === topIdx) continue;
    if (tryCreateMeld([pool[i], top])) continue;
    for (let j = i + 1; j < pool.length; j++) {
      if (j === topIdx) continue;
      if (tryCreateMeld([pool[i], pool[j], top])) return true;
      for (let k = j + 1; k < pool.length; k++) {
        if (k === topIdx) continue;
        if (tryCreateMeld([pool[i], pool[j], pool[k], top])) return true;
      }
    }
  }
  return false;
}

/** All candidate melds in hand (exported for UI hints). */
export { findAllMelds };
