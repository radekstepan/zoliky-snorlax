import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  GameState,
  ActionResult,
  draw,
  takeJolly,
  findDrawnId,
  layMeld,
  layoff,
  swapJoker,
  discard,
  undoPickup,
  reorderHand,
  sortCards,
  nextRound,
  createGame,
  GameEvent,
} from "./game/engine";
import { Meld, bestPacking, bestPackingIncluding, coverAll, jollyDiscardIndex, findFirstMeld, findJokerSwap } from "./game/melds";
import { RULES } from "./game/core";
import { planBotTurn, BotAction } from "./game/bot";
import { sfx } from "./game/sounds";
import { bodyCount } from "./utils/czech";
import Board, { DrawFlightInfo, DiscardFlightInfo, BotDrawFlightInfo, BotDiscardFlightInfo } from "./components/Board";
import {
  StartScreen,
  StartConfig,
  RulesModal,
  RoundEndModal,
  GameEndModal,
  PauseMenu,
} from "./components/Modals";

interface Toast {
  id: number;
  text: string;
  kind: "good" | "bad" | "info";
}

let toastSeq = 0;

export default function App() {
  const [screen, setScreen] = useState<"menu" | "game">("menu");
  const [config, setConfig] = useState<StartConfig>({
    playerCount: 4,
    difficulty: "medium",
    target: 300,
  });
  const [game, setGame] = useState<GameState | null>(null);
  const gameRef = useRef(game);
  gameRef.current = game;
  const [selected, setSelected] = useState<number[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [showRules, setShowRules] = useState(false);
  const [showPause, setShowPause] = useState(false);
  const [showRoundEnd, setShowRoundEnd] = useState(false);
  const [showGameEnd, setShowGameEnd] = useState(false);
  const [botBusy, setBotBusy] = useState<number | null>(null);
  const [stepText, setStepText] = useState("");
  const [muted, setMuted] = useState(sfx.muted);
  const [gameSeq, setGameSeq] = useState(0);
  // Tracks the most recent human pickup so Board can fly the card from
  // the pile to its slot before revealing it in the hand.
  const [lastDraw, setLastDraw] = useState<DrawFlightInfo | null>(null);
  // Tracks a pending human discard so Board can fly the card from its slot
  // to the pile before the engine discard commits (fly-then-commit).
  const [lastDiscard, setLastDiscard] = useState<DiscardFlightInfo | null>(null);
  const lastDiscardRef = useRef(lastDiscard);
  lastDiscardRef.current = lastDiscard;
  // A committed bot pickup awaiting its pile → chip flight (commit-then-
  // conceal: the chip count stays -1 until the ghost lands).
  const [lastBotDraw, setLastBotDraw] = useState<BotDrawFlightInfo | null>(null);
  // A staged bot discard awaiting its chip → pile flight (fly-then-commit:
  // the engine discard runs only after the ghost lands).
  const [lastBotDiscard, setLastBotDiscard] = useState<BotDiscardFlightInfo | null>(null);
  const lastBotDiscardRef = useRef(lastBotDiscard);
  lastBotDiscardRef.current = lastBotDiscard;
  // Committed closing-discard top: the last card of a discard-close stays
  // face-down and slightly offset on the pile until the next round.
  const [closingTopId, setClosingTopId] = useState<number | null>(null);
  // Continuation of the bot chain while a flight is in the air.
  const pendingBot = useRef<{ state: GameState; actions: BotAction[]; idx: number } | null>(null);
  // True while a pickup flight is in the air — human hand input hushes.
  const [drawBusy, setDrawBusy] = useState(false);
  // Sort toggle: while on, every new card in the human hand slots into
  // sorted order automatically. Manual drag-reorder switches it back off.
  const [autoSort, setAutoSort] = useState(false);
  const autoSortRef = useRef(autoSort);
  autoSortRef.current = autoSort;

  /** Re-sort the human hand in place on an (already cloned) state. */
  const applyAutoSort = useCallback((st: GameState): GameState => {
    st.players[0].hand = sortCards(st.players[0].hand);
    return st;
  }, []);

  const botTimer = useRef<number | null>(null);
  const cancelled = useRef(false);
  const paused = useRef(false);
  const botTurnKey = useRef<string>("");

  /* ---------------- toasts ---------------- */

  const toast = useCallback((text: string, kind: Toast["kind"] = "info") => {
    const id = ++toastSeq;
    setToasts((t) => [...t.slice(-3), { id, text, kind }]);
    window.setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 2600);
  }, []);

  /* ---------------- event → sound/toast ---------------- */

  const handleEvents = useCallback(
    (events: GameEvent[]) => {
      if (!game) return;
      for (const e of events) {
        switch (e.type) {
          case "draw":
            // Pickups play tick-at-launch + thock-at-landing from the
            // Board flight (human and bot alike); the reduced-motion
            // fallback plays the classic one-shot from the flight effect.
            break;
          case "discard":
            sfx.discard();
            break;
          case "undoPickup":
            sfx.click();
            toast(
              `${game.players[e.player].name} vrací kartu zpět na hromádku.`,
              "info"
            );
            break;
          case "meld":
            sfx.meld();
            toast(
              `${game.players[e.player].name} vykládá za ${bodyCount(e.points)}.`,
              "good"
            );
            break;
          case "layoff":
            sfx.layoff();
            break;
          case "swap":
            sfx.swap();
            toast("Žolík byl vyměněn.", "info");
            break;
          case "invalid":
            sfx.error();
            toast(e.message, "bad");
            break;
          case "close": {
            sfx.close();
            const name = game.players[e.player].name;
            toast(
              e.jolly
                ? `${name} zavírá JOLLY HAND — dvojnásobné body!`
                : e.faceDown
                  ? `${name} zavírá poslední kartou lícem dolů!`
                  : `${name} zavírá kolo!`,
              "good"
            );
            break;
          }
          case "jolly":
            if (e.player !== 0) sfx.swap();
            toast(`${game.players[e.player].name} bere JOLLY kartu!`, "info");
            break;
          case "roundEnd":
            sfx.roundEnd();
            break;
          case "gameEnd":
            if (e.winner === 0) sfx.win();
            else sfx.lose();
            break;
          case "reshuffle":
            sfx.reshuffle();
            toast("Hromádka byla bez míchání obrácena v balíček.", "info");
            break;
        }
      }
    },
    [game, toast]
  );

  /* ---------------- bot execution ---------------- */

  const botStepText = (a: BotAction, state: GameState) => {
    const name = state.players[state.current].name;
    switch (a.kind) {
      case "draw":
        return a.from === "discard" ? `${name} si bere z hromádky…` : `${name} si bere kartu…`;
      case "jolly":
        return `${name} bere JOLLY kartu…`;
      case "meld":
        return `${name} vykládá…`;
      case "layoff":
        return `${name} přikládá…`;
      case "swap":
        return `${name} vyměňuje žolíka…`;
      case "discard":
        return `${name} odhazuje…`;
    }
  };

  const applyBotAction = (state: GameState, a: BotAction): ActionResult => {
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
  };

  const runBotChain = useCallback(
    (state: GameState, actions: BotAction[], idx: number) => {
      if (cancelled.current) {
        pendingBot.current = null;
        setBotBusy(null);
        return;
      }
      if (idx >= actions.length) {
        setBotBusy(null);
        return;
      }
      const a = actions[idx];
      setStepText(botStepText(a, state));
      const delay = a.kind === "draw" ? 850 : a.kind === "discard" ? 800 : 700;
      botTimer.current = window.setTimeout(() => {
        if (paused.current) {
          runBotChain(state, actions, idx);
          return;
        }
        if (cancelled.current) {
          pendingBot.current = null;
          setBotBusy(null);
          return;
        }
        const reducedMotion =
          typeof window !== "undefined" &&
          !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        // Bot discard: stage the flight; the engine commit runs on landing
        // (fly-then-commit, mirrors the human discard).
        if (a.kind === "discard") {
          const card = state.players[state.current]?.hand.find((c) => c.id === a.cardId);
          if (!card || reducedMotion) {
            if (reducedMotion) sfx.discard();
            const res = applyBotAction(state, a);
            if (res.events.some((e) => e.type === "invalid")) {
              setGame(res.state);
              handleEvents(res.events);
              if (res.state.phase === "play" && res.state.players[res.state.current].isBot) {
                runBotChain(res.state, planBotTurn(res.state), 0);
              } else {
                setBotBusy(null);
              }
              return;
            }
            setGame(res.state);
            handleEvents(res.events);
            if (res.state.phase !== "play") {
              if (res.events.some((e) => e.type === "close" && e.faceDown)) {
                const topId = res.state.discard[res.state.discard.length - 1]?.id ?? null;
                if (topId !== null) setClosingTopId(topId);
              }
              setBotBusy(null);
              return;
            }
            if (res.state.current !== state.current) {
              setBotBusy(null);
              return;
            }
            runBotChain(res.state, actions, idx + 1);
            return;
          }
          pendingBot.current = { state, actions, idx };
          setLastBotDiscard({
            playerId: state.current,
            cardId: a.cardId,
            card,
            isClosing: state.players[state.current]?.hand.length === 1,
          });
          return;
        }
        // Bot pickup: commit immediately, then conceal until landing
        // (commit-then-conceal, mirrors the human pickup).
        if (a.kind === "draw" || a.kind === "jolly") {
          const res = applyBotAction(state, a);
          if (res.events.some((e) => e.type === "invalid")) {
            // plan went stale — replan from the live state
            setGame(res.state);
            handleEvents(res.events);
            if (res.state.phase === "play" && res.state.players[res.state.current].isBot) {
              runBotChain(res.state, planBotTurn(res.state), 0);
            } else {
              setBotBusy(null);
            }
            return;
          }
          if (res.state.phase !== "play") {
            setGame(res.state);
            handleEvents(res.events);
            setBotBusy(null);
            return;
          }
          const before = state.players[state.current].hand;
          const after = res.state.players[res.state.current].hand;
          const drawnId =
            findDrawnId(before, after) ?? after[after.length - 1]?.id ?? null;
          const drawnCard = drawnId !== null ? after.find((c) => c.id === drawnId) : undefined;
          if (drawnId === null || !drawnCard || reducedMotion) {
            if (reducedMotion) sfx.draw();
            setGame(res.state);
            handleEvents(res.events);
            if (res.state.current !== state.current) {
              setBotBusy(null);
              return;
            }
            runBotChain(res.state, actions, idx + 1);
            return;
          }
          setGame(res.state);
          handleEvents(res.events);
          pendingBot.current = { state: res.state, actions, idx: idx + 1 };
          setLastBotDraw({
            playerId: state.current,
            cardId: drawnId,
            from: a.kind === "jolly" ? "jolly" : a.from,
            card: drawnCard,
          });
          return;
        }
        const res = applyBotAction(state, a);
        if (res.events.some((e) => e.type === "invalid")) {
          // plan went stale — replan from the live state
          setGame(res.state);
          handleEvents(res.events);
          if (res.state.phase === "play" && res.state.players[res.state.current].isBot) {
            runBotChain(res.state, planBotTurn(res.state), 0);
          } else {
            setBotBusy(null);
          }
          return;
        }
        setGame(res.state);
        handleEvents(res.events);
        if (res.state.phase !== "play") {
          setBotBusy(null);
          return;
        }
        if (res.state.current !== state.current) {
          setBotBusy(null);
          return;
        }
        runBotChain(res.state, actions, idx + 1);
      }, delay);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [handleEvents]
  );

  /** Resume the bot chain once a pickup ghost lands on its chip. */
  const handleBotDrawDone = useCallback(() => {
    const pending = pendingBot.current;
    pendingBot.current = null;
    setLastBotDraw(null);
    if (!pending) return;
    if (cancelled.current) {
      setBotBusy(null);
      return;
    }
    if (paused.current) {
      pendingBot.current = pending;
      botTimer.current = window.setTimeout(handleBotDrawDone, 200);
      return;
    }
    const st = gameRef.current;
    if (!st || st.phase !== "play" || !st.players[st.current]?.isBot) {
      setBotBusy(null);
      return;
    }
    if (pending.idx >= pending.actions.length) {
      setBotBusy(null);
      return;
    }
    runBotChain(pending.state, pending.actions, pending.idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runBotChain]);

  /** Commit a staged bot discard once its ghost lands on the pile. */
  const commitBotDiscard = useCallback(() => {
    const staged = lastBotDiscardRef.current;
    const pending = pendingBot.current;
    pendingBot.current = null;
    setLastBotDiscard(null);
    if (!staged || !pending) return;
    if (cancelled.current) {
      setBotBusy(null);
      return;
    }
    if (paused.current) {
      pendingBot.current = pending;
      setLastBotDiscard(staged);
      botTimer.current = window.setTimeout(commitBotDiscard, 200);
      return;
    }
    const st = gameRef.current;
    if (!st || st.phase !== "play" || !st.players[st.current]?.isBot) {
      setBotBusy(null);
      return;
    }
    if (st.current !== staged.playerId || st.turnPhase !== "action") {
      setBotBusy(null);
      return;
    }
    const res = discard(st, staged.cardId);
    if (res.events.some((e) => e.type === "invalid")) {
      setGame(res.state);
      handleEvents(res.events);
      if (res.state.phase === "play" && res.state.players[res.state.current].isBot) {
        runBotChain(res.state, planBotTurn(res.state), 0);
      } else {
        setBotBusy(null);
      }
      return;
    }
    setGame(res.state);
    handleEvents(res.events);
    if (res.state.phase !== "play") {
      if (res.events.some((e) => e.type === "close" && e.faceDown)) {
        const topId = res.state.discard[res.state.discard.length - 1]?.id ?? null;
        if (topId !== null) setClosingTopId(topId);
      }
      setBotBusy(null);
      return;
    }
    if (res.state.current !== staged.playerId) {
      // Turn passed — discard ended the bot's turn.
      setBotBusy(null);
      return;
    }
    runBotChain(res.state, pending.actions, pending.idx + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleEvents, runBotChain]);

  // kickoff: whenever the live state points at a bot, plan & run its turn
  useEffect(() => {
    if (!game || game.phase !== "play") return;
    const p = game.players[game.current];
    if (!p.isBot || botBusy !== null) return;
    const key = `${game.round}-${game.turnCount}-${game.current}`;
    if (botTurnKey.current === key) return; // StrictMode / double-run guard
    botTurnKey.current = key;
    setBotBusy(p.id);
    setStepText(`${p.name} přemýšlí…`);
    // let the "thinking" state paint before the (sync) plan computation
    botTimer.current = window.setTimeout(() => {
      if (cancelled.current) {
        setBotBusy(null);
        return;
      }
      const plan = planBotTurn(game);
      runBotChain(game, plan, 0);
    }, 650);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, botBusy]);

  // round / game end modals (delayed so the closing animation can play)
  useEffect(() => {
    if (!game) return;
    if (game.phase === "roundEnd") {
      const t = window.setTimeout(() => setShowRoundEnd(true), 1100);
      return () => window.clearTimeout(t);
    }
    if (game.phase === "gameEnd") {
      const t = window.setTimeout(() => setShowGameEnd(true), 1400);
      return () => window.clearTimeout(t);
    }
    setShowRoundEnd(false);
    setShowGameEnd(false);
  }, [game]);

  // esc → pause
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && screen === "game" && game?.phase === "play") {
        setShowPause((v) => {
          paused.current = !v;
          return !v;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen, game]);

  // cleanup
  useEffect(() => {
    return () => {
      cancelled.current = true;
      if (botTimer.current) window.clearTimeout(botTimer.current);
    };
  }, []);

  /* ---------------- game lifecycle ---------------- */

  const startGame = useCallback(
    (cfg: StartConfig) => {
      cancelled.current = false;
      paused.current = false;
      const fresh = createGame(cfg);
      if (autoSortRef.current) fresh.players[0].hand = sortCards(fresh.players[0].hand);
      setGame(fresh);
      setSelected([]);
      setLastDraw(null);
      setLastDiscard(null);
      setLastBotDraw(null);
      setLastBotDiscard(null);
      setClosingTopId(null);
      pendingBot.current = null;
      setDrawBusy(false);
      setShowRules(false);
      setShowPause(false);
      setShowRoundEnd(false);
      setShowGameEnd(false);
      setBotBusy(null);
      setStepText("");
      setGameSeq((s) => s + 1);
      setScreen("game");
      sfx.click();
      sfx.draw();
    },
    []
  );

  const backToMenu = () => {
    cancelled.current = true;
    if (botTimer.current) window.clearTimeout(botTimer.current);
    setBotBusy(null);
    setGame(null);
    setSelected([]);
    setLastDraw(null);
    setLastDiscard(null);
    setLastBotDraw(null);
    setLastBotDiscard(null);
    setClosingTopId(null);
    pendingBot.current = null;
    setDrawBusy(false);
    setShowPause(false);
    setShowRoundEnd(false);
    setShowGameEnd(false);
    setScreen("menu");
  };

  const restart = () => {
    cancelled.current = false;
    paused.current = false;
    if (botTimer.current) window.clearTimeout(botTimer.current);
    setBotBusy(null);
    setShowPause(false);
    setShowRoundEnd(false);
    setShowGameEnd(false);
    setSelected([]);
    setLastDraw(null);
    setLastDiscard(null);
    setLastBotDraw(null);
    setLastBotDiscard(null);
    setClosingTopId(null);
    pendingBot.current = null;
    const fresh = createGame(config);
    if (autoSortRef.current) fresh.players[0].hand = sortCards(fresh.players[0].hand);
    setGame(fresh);
    setGameSeq((s) => s + 1);
    sfx.click();
  };

  const goNextRound = () => {
    if (!game) return;
    const res = nextRound(game);
    if (autoSortRef.current) res.state.players[0].hand = sortCards(res.state.players[0].hand);
    setGame(res.state);
    setSelected([]);
    setLastDraw(null);
    setLastDiscard(null);
    setLastBotDraw(null);
    setLastBotDiscard(null);
    setClosingTopId(null);
    pendingBot.current = null;
    setShowRoundEnd(false);
    setGameSeq((s) => s + 1);
    sfx.click();
    sfx.draw();
  };

  /* ---------------- human actions ---------------- */

  const humanTurn = game !== null && game.phase === "play" && game.current === 0 && botBusy === null;

  const toggleCard = (id: number) => {
    if (!humanTurn) return;
    if (drawBusy || lastDiscardRef.current) return;
    setSelected((s) => {
      const has = s.includes(id);
      if (!has) sfx.select();
      return has ? s.filter((x) => x !== id) : [...s, id];
    });
  };

  const doDraw = (from: "stock" | "discard") => {
    if (!game || !humanTurn) return;
    if (drawBusy || lastDiscardRef.current) return;
    const res = draw(game, from);
    if (!res.events.some((e) => e.type === "invalid")) {
      setSelected([]);
      // Identify the newcomer by id BEFORE auto-sorting: after a sort the
      // last slot holds whatever sorts last, not the drawn card.
      const drawnId =
        findDrawnId(game.players[0].hand, res.state.players[0].hand) ??
        res.state.players[0].hand[res.state.players[0].hand.length - 1].id;
      if (autoSortRef.current) applyAutoSort(res.state);
      setLastDraw({ cardId: drawnId, from });
      setGame(res.state);
    }
    handleEvents(res.events);
  };

  const doLay = () => {
    if (!game || !humanTurn) return;
    if (drawBusy || lastDiscardRef.current) return;
    const res = layMeld(game, selected);
    if (!res.events.some((e) => e.type === "invalid")) {
      setSelected([]);
      setLastDraw(null);
      setLastDiscard(null);
      setDrawBusy(false);
      setGame(res.state);
    }
    handleEvents(res.events);
  };

  /** Return a still-unused discard-pile pickup to the pile (undo). */
  const doUndoPickup = () => {
    if (!game || !humanTurn) return;
    if (drawBusy || lastDiscardRef.current) return;
    const res = undoPickup(game);
    if (!res.events.some((e) => e.type === "invalid")) {
      setSelected([]);
      setLastDraw(null);
      setGame(res.state);
    }
    handleEvents(res.events);
  };

  /** Begin a human discard: stage the flight; the engine commit runs on landing. */
  const doDiscard = () => {
    if (!game || !humanTurn || selected.length !== 1) return;
    if (drawBusy || lastDiscardRef.current) return;
    const card = game.players[0].hand.find((c) => c.id === selected[0]);
    if (!card) return;
    setSelected([]);
    setLastDraw(null);
    setLastDiscard({
      cardId: card.id,
      card,
      isClosing: game.players[0].hand.length === 1,
    });
  };

  /** Commit a staged human discard once its ghost lands on the pile. */
  const commitDiscard = useCallback(() => {
    const pending = lastDiscardRef.current;
    const st = gameRef.current;
    if (!pending || !st) return;
    if (st.phase !== "play" || st.current !== 0 || st.turnPhase !== "action") {
      setLastDiscard(null);
      return;
    }
    const res = discard(st, pending.cardId);
    // Clear the pending flight either way; the pile pop + ghost fade are
    // driven locally in Board. The discard thock plays from game events.
    setLastDiscard(null);
    if (!res.events.some((e) => e.type === "invalid")) {
      setSelected([]);
      setLastDraw(null);
      setDrawBusy(false);
      if (res.events.some((e) => e.type === "close" && e.faceDown)) {
        const topId = res.state.discard[res.state.discard.length - 1]?.id ?? null;
        if (topId !== null) setClosingTopId(topId);
      }
      setGame(res.state);
    }
    handleEvents(res.events);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleEvents]);

  const doSort = () => {
    if (!game || game.current !== 0 || game.phase !== "play") return;
    if (drawBusy || lastDiscardRef.current) return;
    if (autoSortRef.current) {
      // Toggle off — keep the current order.
      setAutoSort(false);
      sfx.click();
      return;
    }
    const next = structuredClone(game);
    next.players[0].hand = sortCards(next.players[0].hand);
    setGame(next);
    setAutoSort(true);
    sfx.click();
  };

  const doReorderHand = (orderedIds: number[]) => {
    if (!game || game.current !== 0 || game.phase !== "play") return;
    if (drawBusy || lastDiscardRef.current) return;
    const res = reorderHand(game, orderedIds);
    if (res.state !== game) {
      // A manual order wins over the toggle.
      if (autoSortRef.current) setAutoSort(false);
      setLastDraw(null);
      setLastDiscard(null);
      setDrawBusy(false);
      setGame(res.state);
    }
  };

  const doTakeJolly = () => {
    if (!game || !humanTurn) return;
    if (drawBusy || lastDiscardRef.current) return;
    const res = takeJolly(game);
    if (!res.events.some((e) => e.type === "invalid")) {
      setSelected([]);
      const drawnId =
        findDrawnId(game.players[0].hand, res.state.players[0].hand) ??
        res.state.players[0].hand[res.state.players[0].hand.length - 1].id;
      if (autoSortRef.current) applyAutoSort(res.state);
      setLastDraw({ cardId: drawnId, from: "jolly" });
      setGame(res.state);
    }
    handleEvents(res.events);
  };

  const doHint = () => {
    if (!game || !humanTurn || game.turnPhase !== "action") return;
    if (drawBusy || lastDiscardRef.current) return;
    const me = game.players[0];
    // Jolly rush: lay everything but one card, then discard the last one.
    if (game.jollyRush) {
      if (coverAll(me.hand)) {
        setSelected(me.hand.map((c) => c.id));
        sfx.click();
      } else {
        const di = jollyDiscardIndex(me.hand);
        if (di >= 0) {
          setSelected(me.hand.filter((_, i) => i !== di).map((c) => c.id));
          sfx.click();
        } else {
          toast("Celou ruku s touto kartou vyložit nejde.", "bad");
        }
      }
      return;
    }
    // A taken pile card / swapped joker must be used — suggest that packing.
    const mustId =
      game.pendingLayId !== null && me.hand.some((c) => c.id === game.pendingLayId)
        ? game.pendingLayId
        : game.pendingJokerId !== null && me.hand.some((c) => c.id === game.pendingJokerId)
          ? game.pendingJokerId
          : null;
    if (mustId !== null) {
      const idx = me.hand.findIndex((c) => c.id === mustId);
      const packing = me.melded
        ? bestPackingIncluding(me.hand, false, 0, idx)
        : bestPackingIncluding(me.hand, true, RULES.FIRST_MELD_POINTS, idx);
      if (packing && packing.melds.length > 0) {
        setSelected(packing.melds.flatMap((m) => m.cards.map((c) => c.id)));
        sfx.click();
      } else {
        toast("Tuto kartu teď vyložit nejde.", "bad");
      }
      return;
    }
    const packing = me.melded
      ? bestPacking(me.hand, false, 0)
      : findFirstMeld(me.hand);
    if (!packing || packing.melds.length === 0) {
      toast("V ruce není žádná platná kombinace.", "info");
      return;
    }
    setSelected(packing.melds.flatMap((m) => m.cards.map((c) => c.id)));
    sfx.click();
  };

  const doMeldClick = (meld: Meld, jokerCardId?: number) => {
    if (!game || !humanTurn || selected.length !== 1) return;
    if (drawBusy || lastDiscardRef.current) return;
    const cardId = selected[0];
    const card = game.players[0].hand.find((c) => c.id === cardId);
    if (!card) return;
    if (jokerCardId !== undefined) {
      // verify the swap matches this exact meld/joker before firing
      const swap = findJokerSwap([meld], [card]);
      if (!swap || swap.jokerCardId !== jokerCardId) {
        sfx.error();
        toast("Tato karta žolíka na tomto místě nahradit nemůže.", "bad");
        return;
      }
      const res = swapJoker(game, cardId, meld.id, jokerCardId);
      if (!res.events.some((e) => e.type === "invalid")) {
        setSelected([]);
        if (autoSortRef.current) applyAutoSort(res.state);
      }
      setGame(res.state);
      handleEvents(res.events);
      return;
    }
    const res = layoff(game, cardId, meld.id);
    if (!res.events.some((e) => e.type === "invalid")) setSelected([]);
    setGame(res.state);
    handleEvents(res.events);
  };

  const toggleMute = () => setMuted(sfx.toggle());

  /* ---------------- render ---------------- */

  return (
    <div className="h-full crt relative">
      {screen === "menu" ? (
        <StartScreen
          config={config}
          setConfig={setConfig}
          onStart={() => startGame(config)}
          onShowRules={() => setShowRules(true)}
        />
      ) : game ? (
        <Board
          state={game}
          animKey={gameSeq}
          thinkingBot={botBusy}
          stepText={stepText}
          selected={selected}
          onToggleCard={toggleCard}
          onDraw={doDraw}
          onTakeJolly={doTakeJolly}
          onLay={doLay}
          onDiscard={doDiscard}
          onUndoPickup={doUndoPickup}
          onSort={doSort}
          sortOn={autoSort}
          onHint={doHint}
          onMeldClick={doMeldClick}
          onReorderHand={doReorderHand}
          lastDraw={lastDraw}
          onDrawFlightDone={() => setLastDraw(null)}
          onDrawBusyChange={setDrawBusy}
          lastDiscard={lastDiscard}
          onDiscardFlightDone={commitDiscard}
          lastBotDraw={lastBotDraw}
          onBotDrawFlightDone={handleBotDrawDone}
          lastBotDiscard={lastBotDiscard}
          onBotDiscardFlightDone={commitBotDiscard}
          closingTopId={closingTopId}
          onOpenMenu={() => {
            paused.current = true;
            setShowPause(true);
          }}
          muted={muted}
          onToggleMute={toggleMute}
        />
      ) : null}

      {/* toasts */}
      <div className="fixed top-14 left-1/2 -translate-x-1/2 z-[70] flex flex-col items-center gap-2 pointer-events-none px-4 w-full max-w-md">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ y: -18, opacity: 0, scale: 0.92 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ type: "spring", stiffness: 400, damping: 26 }}
              className={`toast-box px-4 py-2.5 ${
                t.kind === "bad"
                  ? "[--border-c:rgba(255,42,109,0.7)] [--glow-c:rgba(255,42,109,0.4)]"
                  : t.kind === "good"
                    ? "[--border-c:rgba(61,245,133,0.7)] [--glow-c:rgba(61,245,133,0.4)]"
                    : "[--border-c:rgba(5,217,232,0.7)] [--glow-c:rgba(5,217,232,0.35)]"
              }`}
            >
              <span
                className={`font-pixel text-[8px] leading-relaxed ${
                  t.kind === "bad" ? "text-[#ff9dbd]" : t.kind === "good" ? "text-[#9dffc4]" : "text-[#a5ecff]"
                }`}
              >
                {t.text}
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* modals */}
      <AnimatePresence>
        {showRules && <RulesModal onClose={() => setShowRules(false)} />}
        {showPause && screen === "game" && (
          <PauseMenu
            onResume={() => {
              paused.current = false;
              setShowPause(false);
            }}
            onRestart={restart}
            onRules={() => setShowRules(true)}
            onMenu={backToMenu}
          />
        )}
        {game && showRoundEnd && game.phase === "roundEnd" && (
          <RoundEndModal state={game} onNextRound={goNextRound} />
        )}
        {game && showGameEnd && game.phase === "gameEnd" && (
          <GameEndModal state={game} onRematch={restart} onMenu={backToMenu} />
        )}
      </AnimatePresence>
    </div>
  );
}
