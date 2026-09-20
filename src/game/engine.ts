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
  canJollyClose,
  findAllMelds,
  bestPackingIncluding,
  meldPoints,
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
  /** Jokers kept from the previous round — rejoin the next deal, no penalty. */
  stash: Card[];
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
  jolly: boolean; // closed via Jolly Hand — everyone else counts double
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
  /** Bottom card turned face up under the deck — Jolly Hand only. */
  jollyCard: Card | null;
  /** Discard-pile card taken this turn — must be laid before discarding. */
  pendingLayId: number | null;
  /** Joker taken from the table this turn — must be used before discarding. */
  pendingJokerId: number | null;
  /** Jolly Hand attempt in progress — meld everything, discard the last card. */
  jollyRush: boolean;
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
  | { type: "close"; player: number; jolly: boolean; faceDown: boolean }
  | { type: "jolly"; player: number }
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
      stash: [],
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
      stash: [],
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
    jollyCard: null,
    pendingLayId: null,
    pendingJokerId: null,
    jollyRush: false,
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

/** True while the opening wait is in effect — nobody may lay cards yet. */
export function meldsLocked(s: GameState): boolean {
  return (
    Math.floor(s.turnCount / s.players.length) < RULES.MELD_WAIT_ROUNDS
  );
}

function dealRound(state: GameState): void {
  const n = state.players.length;
  state.deck = shuffle(buildDeck());
  state.discard = [];
  state.melds = [];
  state.phase = "play";
  state.roundEndInfo = null;
  state.winner = null;
  state.pendingLayId = null;
  state.pendingJokerId = null;
  state.jollyRush = false;
  for (const p of state.players) {
    p.hand = [];
    p.melded = false;
    p.roundDelta = 0;
  }
  // Split: the player right of the dealer peeks at the bottom 3 cards and
  // keeps a joker if there is one (receiving one less card in the deal).
  const cutter = (state.dealer - 1 + n) % n;
  let keptJoker: Card | null = null;
  const peeked = state.deck.slice(0, 3).find((c) => c.joker);
  if (peeked) {
    keptJoker = peeked;
    state.deck = state.deck.filter((c) => c.id !== peeked.id);
  }
  // The bottom-most card is turned face up under the deck (Jolly Hand only).
  state.jollyCard = state.deck.shift() ?? null;
  // 12 cards each; the cutter gets one less when holding a kept joker.
  for (let c = 0; c < RULES.HAND_SIZE; c++) {
    for (const p of state.players) {
      if (p.id === cutter && keptJoker && c === RULES.HAND_SIZE - 1) continue;
      p.hand.push(state.deck.pop()!);
    }
  }
  if (keptJoker) state.players[cutter].hand.push(keptJoker);
  // Jokers kept from the last round rejoin their owner's hand.
  for (const p of state.players) {
    if (p.stash.length > 0) {
      p.hand.push(...p.stash);
      p.stash = [];
    }
  }
  const predak = (state.dealer + 1) % n;
  state.players[predak].hand.push(state.deck.pop()!); // 13th card
  state.current = predak;
  state.turnCount = 0;
  state.turnPhase = "action";
  state.skipDraw = true;
  if (keptJoker) {
    pushLog(
      state,
      `${state.players[cutter].name} při snímání našel žolíka a nechává si ho.`,
      "good"
    );
  }
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
    if (meldsLocked(s))
      return invalid(
        state,
        `Kartu z hromádky lze brát až po ${RULES.MELD_WAIT_ROUNDS}. kole — musí se hned vyložit.`
      );
    const top = s.discard[s.discard.length - 1];
    // A discard-pile card must be laid immediately: it has to fit a table
    // meld, form a (first-)meld with cards in hand — or, when already
    // melded, start a brand-new meld with cards in hand.
    if (me.melded) {
      if (!s.melds.some((m) => canAddToMeld(m, top) !== null)) {
        const pool = [...me.hand, top];
        if (!bestPackingIncluding(pool, false, 0, pool.length - 1))
          return invalid(state, "Tuto kartu by nešlo hned vyložit.");
      }
    } else {
      const pool = [...me.hand, top];
      if (
        !bestPackingIncluding(
          pool,
          true,
          RULES.FIRST_MELD_POINTS,
          pool.length - 1
        )
      )
        return invalid(state, "Tuto kartu by nešlo hned vyložit.");
    }
    const card = s.discard.pop()!;
    me.hand.push(card);
    s.pendingLayId = card.id;
    pushLog(s, `${me.name} si bere kartu z hromádky (musí ji hned vyložit).`, "info");
  } else {
    if (s.deck.length === 0) {
      // overturn the discard pile WITHOUT shuffling and make it the deck
      if (s.discard.length <= 1) {
        // no cards left — round ends without a closer
        return endRound(s, -1, false, []);
      }
      s.deck = s.discard.slice().reverse();
      s.discard = [];
      s.reshuffles++;
      events.push({ type: "reshuffle" });
      pushLog(s, "Hromádka byla bez míchání obrácena v balíček.", "info");
    }
    const card = s.deck.pop()!;
    me.hand.push(card);
  }
  s.turnPhase = "action";
  events.push({ type: "draw", player: s.current, from });
  return { state: s, events };
}

/* ------------------------------------------------------------------ */
/*  Jolly Hand — take the face-up bottom card, meld the rest, discard  */
/* ------------------------------------------------------------------ */

export function takeJolly(state: GameState): ActionResult {
  if (state.phase !== "play") return invalid(state, "Hra neběží.");
  if (state.turnPhase !== "draw") return invalid(state, "Už jsi táhl(a).");
  if (state.skipDraw)
    return invalid(state, "Pro zahájení kola odhoď jednu kartu.");
  const me = state.players[state.current];
  if (!state.jollyCard)
    return invalid(state, "Pod balíčkem už žádná karta není.");
  if (me.hand.length !== RULES.HAND_SIZE)
    return invalid(state, "Jolly Hand jde jen se 12 kartami v ruce.");
  const jollyPool = [...me.hand, state.jollyCard];
  if (coverAll(jollyPool) === null && !canJollyClose(jollyPool))
    return invalid(state, "S touto kartou by nešla vyložit celá ruka.");
  const s = structuredClone(state);
  const p = s.players[s.current];
  const jc = s.jollyCard!;
  s.jollyCard = null;
  p.hand.push(jc);
  s.turnPhase = "action";
  s.jollyRush = true;
  pushLog(
    s,
    `${p.name} bere JOLLY kartu a musí vyložit celou ruku (poslední kartu odhodí)!`,
    "warn"
  );
  return { state: s, events: [{ type: "jolly", player: s.current }] };
}

/* ------------------------------------------------------------------ */
/*  Lay a new meld (may contain multiple disjoint melds)               */
/* ------------------------------------------------------------------ */

export function layMeld(state: GameState, cardIds: number[]): ActionResult {
  if (state.phase !== "play") return invalid(state, "Hra neběží.");
  if (state.turnPhase !== "action")
    return invalid(state, "Nejprve si táhni kartu.");
  if (!state.jollyRush && meldsLocked(state))
    return invalid(
      state,
      `Vykládat se smí až po ${RULES.MELD_WAIT_ROUNDS}. kole.`
    );
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

  // A Jolly Hand lay bypasses the first-meld gate — the whole hand goes down.
  if (!s.jollyRush && !wasMelded && !firstMeldOk(newMelds)) {
    return invalid(state, firstMeldProblem(newMelds) ?? "Neplatný první výklad.");
  }

  const ids = new Set(cardIds);
  p.hand = p.hand.filter((c) => !ids.has(c.id));
  if (s.pendingLayId !== null && ids.has(s.pendingLayId)) s.pendingLayId = null;
  if (s.pendingJokerId !== null && ids.has(s.pendingJokerId))
    s.pendingJokerId = null;
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
    return endRound(s, s.current, s.jollyRush, [
      ...events,
      { type: "close", player: s.current, jolly: s.jollyRush, faceDown: false },
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
  if (!state.jollyRush && meldsLocked(state))
    return invalid(
      state,
      `Přikládat se smí až po ${RULES.MELD_WAIT_ROUNDS}. kole.`
    );
  const me = state.players[state.current];
  if (!me.melded && !state.jollyRush)
    return invalid(
      state,
      `Nejprve musíš vyložit své kombinace (${RULES.FIRST_MELD_POINTS} bodů).`
    );
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
  if (s.pendingLayId === cardId) s.pendingLayId = null;
  if (s.pendingJokerId === cardId) s.pendingJokerId = null;
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
    return endRound(s, s.current, s.jollyRush, [
      ...events,
      { type: "close", player: s.current, jolly: s.jollyRush, faceDown: false },
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
  if (!state.jollyRush && meldsLocked(state))
    return invalid(
      state,
      `Žolíky se smí měnit až po ${RULES.MELD_WAIT_ROUNDS}. kole.`
    );
  if (
    state.pendingJokerId !== null &&
    state.players[state.current].hand.some((c) => c.id === state.pendingJokerId)
  )
    return invalid(state, "Nejprve využij vyměněného žolíka.");
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
    // a set releases its joker only once all 4 suits would be present
    const nats = meld.cards.filter((c) => !c.joker);
    if (
      nats.length !== RULES.SET_MAX - 1 ||
      new Set(nats.map((c) => c.suit)).size !== nats.length ||
      nats.some((c) => c.suit === card.suit)
    )
      return invalid(
        state,
        "Žolíka z trojice lze vzít, až když v ní budou všechny 4 barvy."
      );
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
  // a joker taken from the table must be used before the turn ends
  s.pendingJokerId = jokerToHand.id;
  pushLog(s, `${p.name} vyměňuje žolíka (musí ho v tomto tahu využít).`, "info");
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
  // A Jolly Hand closes with a final discard: everything else must already
  // be melded, so only the last card in hand may be discarded.
  if (state.jollyRush && me.hand.length !== 1)
    return invalid(state, "Jolly Hand: musíš vyložit všechny karty!");
  if (
    state.pendingLayId !== null &&
    me.hand.some((c) => c.id === state.pendingLayId)
  )
    return invalid(state, "Kartu z hromádky musíš nejprve vyložit.");
  if (
    state.pendingJokerId !== null &&
    me.hand.some((c) => c.id === state.pendingJokerId)
  )
    return invalid(state, "Vyměněného žolíka musíš v tomto tahu využít.");

  const s = structuredClone(state);
  const p = s.players[s.current];
  p.hand = p.hand.filter((c) => c.id !== cardId);
  s.discard.push(card);
  const events: GameEvent[] = [{ type: "discard", player: s.current, card }];

  if (p.hand.length === 0) {
    // the closer dramatically discards the last card face down
    pushLog(s, `${p.name} dramaticky odhazuje poslední kartu lícem dolů!`, "good");
    return endRound(s, s.current, s.jollyRush, [
      ...events,
      { type: "close", player: s.current, jolly: s.jollyRush, faceDown: true },
    ]);
  }

  pushLog(s, `${p.name} odhazuje.`, "info");
  s.pendingLayId = null;
  s.pendingJokerId = null;
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
  jolly: boolean,
  events: GameEvent[]
): ActionResult {
  const deltas: RoundEndInfo["deltas"] = [];
  for (const p of s.players) {
    // Jokers in hand are kept for the next round — no penalty.
    const rest = p.hand.filter((c) => !c.joker);
    p.stash.push(...p.hand.filter((c) => c.joker));
    // -1 game point per card left in hand (-2 after a Jolly Hand).
    // The closer laid everything down, so they count nothing.
    const points = (jolly ? -2 : -1) * rest.length;
    p.roundDelta = points;
    p.score += points;
    deltas.push({ id: p.id, points, doubled: jolly && rest.length > 0 });
  }
  if (closedBy >= 0) {
    s.players[closedBy].closedRounds++;
    s.players[closedBy].roundDelta = 0;
    pushLog(
      s,
      jolly
        ? `${s.players[closedBy].name} zavírá JOLLY HAND — ostatní počítají dvojnásobek!`
        : `${s.players[closedBy].name} zavírá!`,
      "good"
    );
  } else {
    pushLog(s, "Karty došly — kolo končí bez zavření.", "warn");
  }
  s.phase = "roundEnd";
  s.roundEndInfo = { closedBy, jolly, deltas };
  const newEvents: GameEvent[] = [...events, { type: "roundEnd" }];
  // Scores only go down — the match ends past -target, highest score wins.
  if (s.players.some((p) => p.score <= -s.target)) {
    let bestIdx = 0;
    for (let i = 1; i < s.players.length; i++) {
      if (s.players[i].score > s.players[bestIdx].score) bestIdx = i;
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
  // Suits stay together; the suit blocks themselves are ordered so colors
  // alternate as much as possible. A fixed s/h/c/d order fails when a suit
  // is missing (e.g. spades + clubs with no hearts => black/black), so the
  // present suits are permuted to minimize same-color block neighbors.
  const suitOrder = { s: 0, h: 1, c: 2, d: 3 } as const;
  const isBlack = (suit: Card["suit"]) => suit === "s" || suit === "c";
  const jokers = p.hand.filter((c) => c.joker);
  const groups = new Map<Card["suit"], Card[]>();
  for (const c of p.hand) {
    if (c.joker) continue;
    const g = groups.get(c.suit);
    if (g) g.push(c);
    else groups.set(c.suit, [c]);
  }
  for (const g of groups.values()) g.sort((a, b) => a.rank - b.rank);
  const present = [...groups.keys()];
  const score = (order: Card["suit"][]) => {
    let n = 0;
    for (let i = 1; i < order.length; i++)
      if (isBlack(order[i]) === isBlack(order[i - 1])) n++;
    return n;
  };
  const lexicSmaller = (a: Card["suit"][], b: Card["suit"][]) => {
    for (let i = 0; i < a.length; i++) {
      if (suitOrder[a[i]] !== suitOrder[b[i]])
        return suitOrder[a[i]] < suitOrder[b[i]];
    }
    return false;
  };
  // Best of at most 4! = 24 orders; ties keep canonical s/h/c/d first.
  let best = [...present].sort((a, b) => suitOrder[a] - suitOrder[b]);
  const permute = (arr: Card["suit"][], i: number) => {
    if (i === arr.length) {
      if (
        score(arr) < score(best) ||
        (score(arr) === score(best) && lexicSmaller(arr, best))
      )
        best = [...arr];
      return;
    }
    for (let j = i; j < arr.length; j++) {
      [arr[i], arr[j]] = [arr[j], arr[i]];
      permute(arr, i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  };
  permute([...present], 0);
  p.hand = [...best.flatMap((suit) => groups.get(suit)!), ...jokers];
  return { state: s, events: [] };
}

/* ------------------------------------------------------------------ */
/*  Manual hand order (drag & drop in the UI — no game effect)          */
/* ------------------------------------------------------------------ */

/** Reapply a UI-reordered id list to the current player's hand. Silent no-op unless it holds exactly the cards in hand. */
export function reorderHand(
  state: GameState,
  orderedIds: number[]
): ActionResult {
  const p = state.players[state.current];
  if (
    orderedIds.length !== p.hand.length ||
    p.hand.every((c, i) => c.id === orderedIds[i])
  )
    return { state, events: [] };
  const ids = new Set(orderedIds);
  if (ids.size !== orderedIds.length) return { state, events: [] };
  if (!p.hand.every((c) => ids.has(c.id))) return { state, events: [] };
  const s = structuredClone(state);
  const byId = new Map(s.players[s.current].hand.map((c) => [c.id, c]));
  s.players[s.current].hand = orderedIds.map((id) => byId.get(id)!);
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
