import { motion, AnimatePresence, Reorder } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { GameState, meldsLocked } from "../game/engine";
import { Meld, canAddToMeld, coverAll, canJollyClose, findJokerSwap, meldPoints, isCleanRun, jokerView } from "../game/melds";
import { Card, RULES } from "../game/core";
import { deviceHovers } from "../utils/device";
import { kartyCount, kombinaceCount } from "../utils/czech";
import { sfx } from "../game/sounds";
import PlayingCard, { CARD_SIZES } from "./PlayingCard";

/** A freshly picked-up human card awaiting its fly-to-slot animation. */
export interface DrawFlightInfo {
  cardId: number;
  from: "stock" | "discard" | "jolly";
}

/** A human discard awaiting its fly-to-pile animation (fly-then-commit:
    the engine discard runs only after the ghost lands on the pile).
    `isClosing` marks the game-closing last card: it flies upside-down
    (face-down) and lands slightly offset on the pile, like a real jolly close. */
export interface DiscardFlightInfo {
  cardId: number;
  card: Card;
  isClosing?: boolean;
}

/** A bot pickup awaiting its fly-to-chip animation (commit-then-conceal:
    the engine draw already ran; the chip count stays -1 until landing).
    `card` is a snapshot for the face-up discard-pile case; stock/jolly
    ghosts stay face-down so the bot hand stays secret. */
export interface BotDrawFlightInfo {
  playerId: number;
  cardId: number;
  from: "stock" | "discard" | "jolly";
  card: Card;
}

/** A staged bot discard awaiting its fly-to-pile animation (fly-then-commit:
    the engine discard runs only after the ghost lands on the pile).
    `isClosing` marks the game-closing last card (upside-down, offset). */
export interface BotDiscardFlightInfo {
  playerId: number;
  cardId: number;
  card: Card;
  isClosing?: boolean;
}

interface BoardProps {
  state: GameState;
  animKey: number;
  thinkingBot: number | null;
  stepText: string;
  selected: number[];
  onToggleCard: (id: number) => void;
  onDraw: (from: "stock" | "discard") => void;
  onTakeJolly: () => void;
  onLay: () => void;
  onDiscard: () => void;
  onUndoPickup: () => void;
  onSort: () => void;
  sortOn: boolean;
  onHint: () => void;
  onMeldClick: (meld: Meld, jokerCardId?: number) => void;
  onReorderHand: (orderedIds: number[]) => void;
  onOpenMenu: () => void;
  muted: boolean;
  onToggleMute: () => void;
  lastDraw?: DrawFlightInfo | null;
  onDrawFlightDone?: () => void;
  onDrawBusyChange?: (busy: boolean) => void;
  lastDiscard?: DiscardFlightInfo | null;
  onDiscardFlightDone?: () => void;
  lastBotDraw?: BotDrawFlightInfo | null;
  onBotDrawFlightDone?: () => void;
  lastBotDiscard?: BotDiscardFlightInfo | null;
  onBotDiscardFlightDone?: () => void;
  /** Committed closing-discard top (face-down, slightly offset on the pile).
      Set by the parent when a discard closes the round; cleared on next round. */
  closingTopId?: number | null;
}

const hueColor = (hue: number, l = 60) => `hsl(${hue} 80% ${l}%)`;

/* ------------------------------------------------------------------ */
/*  Small player chip                                                  */
/* ------------------------------------------------------------------ */

function PlayerChip({ state, idx, isTurn, thinking, concealed }: { state: GameState; idx: number; isTurn: boolean; thinking: boolean; concealed?: boolean }) {
  const p = state.players[idx];
  const active = state.phase === "play" && isTurn;
  // Commit-then-conceal mirror of the human pickup: the engine draw already
  // ran, but the chip still shows the old count until the ghost lands.
  const shownCount = concealed ? Math.max(0, p.hand.length - 1) : p.hand.length;
  return (
    <div
      className="panel relative px-3 py-2 flex items-center gap-3 transition-shadow"
      style={{
        borderColor: active ? hueColor(p.hue) : undefined,
        boxShadow: active
          ? `0 0 22px ${hueColor(p.hue, 50)}55, inset 0 1px 0 rgba(255,255,255,0.07)`
          : undefined,
      }}
    >
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center font-pixel text-[13px] shrink-0"
        style={{
          background: `linear-gradient(160deg, ${hueColor(p.hue, 55)}, ${hueColor(p.hue, 35)})`,
          boxShadow: `0 0 12px ${hueColor(p.hue, 50)}66`,
        }}
      >
        {p.name[0]}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-pixel text-[10px] truncate">{p.name}</span>
          {p.melded && state.phase === "play" && (
            <span className="font-pixel text-[7px] px-1.5 py-0.5 rounded bg-neon-green/20 text-neon-green border border-neon-green/40">
              VYLOŽEN
            </span>
          )}
        </div>
        <div className="font-pixel text-[12px] mt-1 neon-gold">{p.score}</div>
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        <div className="flex -space-x-3">
          {p.hand.slice(0, Math.min(5, shownCount)).map((c, i) => (
            <div key={c.id} className="card-back w-4 h-6 rounded-[4px] relative" style={{ zIndex: 5 - i }} />
          ))}
        </div>
        <span className="font-pixel text-[8px] opacity-70">{kartyCount(shownCount)}</span>
      </div>
      {active && (
        <div className="absolute -top-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded bg-black/80 border whitespace-nowrap"
          style={{ borderColor: hueColor(p.hue, 60) }}>
          <span className="font-pixel text-[7px]" style={{ color: hueColor(p.hue, 70) }}>
            {thinking ? "PŘEMÝŠLÍ…" : "NA ŘADĚ"}
          </span>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Meld view                                                          */
/* ------------------------------------------------------------------ */

interface MeldViewProps {
  meld: Meld;
  ownerHue: number;
  ownerName: string;
  interactive: boolean;
  targetable: boolean;
  swapJokerId: number | null;
  hoverLift: boolean;
  prefix: string;
  onMeldClick: () => void;
  onJokerClick: (jokerCardId: number) => void;
}

function MeldView({ meld, ownerHue, ownerName, interactive, targetable, swapJokerId, hoverLift, prefix, onMeldClick, onJokerClick }: MeldViewProps) {
  const pts = meldPoints(meld);
  const isRun = meld.type === "run";
  const size = meld.cards.length > 7 ? "sm" : "md";
  const clean = isCleanRun(meld);
  // Only a genuine layoff/swap destination invites hover — otherwise cards
  // under a resting cursor would lift on mere selection and look highlighted.
  const hot = targetable || swapJokerId !== null;
  return (
    <div
      className={`relative rounded-lg border-2 transition-colors ${
        targetable ? "border-neon-gold/80 shadow-[0_0_16px_rgba(255,211,25,0.35)]" : "border-white/10"
      } ${interactive && !targetable ? "border-white/5" : ""}`}
      style={{ background: "rgba(13,9,32,0.55)", cursor: interactive && hot ? "pointer" : "default" }}
      onClick={onMeldClick}
    >
      <div className="flex items-center gap-1.5 px-1.5 pt-1 pb-0.5">
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: hueColor(ownerHue), boxShadow: `0 0 6px ${hueColor(ownerHue)}` }} />
        <span className="font-pixel text-[6.5px] opacity-60 truncate">{ownerName}</span>
        <span className="font-pixel text-[6.5px] opacity-80 ml-auto shrink-0">
          {isRun ? (clean ? "ČISTÁ POSTUPKA" : "POSTUPKA") : meld.cards.length === 3 ? "TROJICE" : "ČTVEŘICE"} · {pts}b
        </span>
      </div>
      <div className="fan-tight flex px-1 pb-1.5 pt-0.5">
        {meld.cards.map((c) => {
          const isSwapTarget = c.joker && c.id === swapJokerId;
          // Set jokers carry no suit (any missing suit completes the set),
          // so they render as plain jokers rather than a rank with a
          // placeholder symbol.
          const jv = jokerView(meld, c);
          return (
            <PlayingCard
              key={c.id}
              card={c}
              prefix={prefix}
              noAnim={c.joker && c.jokerAs !== undefined}
              size={size}
              asRank={jv.asRank}
              asSuit={jv.asSuit}
              target={isSwapTarget ?? false}
              hoverable={interactive && (targetable || !!isSwapTarget)}
              hoverLift={hoverLift}
              onClick={
                c.joker && interactive
                  ? (e) => {
                      e.stopPropagation();
                      onJokerClick(c.id);
                    }
                  : undefined
              }
            />
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Piles                                                              */
/* ------------------------------------------------------------------ */

function Piles({
  state,
  humanTurn,
  prefix,
  onDraw,
  onTakeJolly,
  canJolly,
  stockRef,
  discardRef,
  jollyRef,
  pilePopId,
  closingTopId,
}: {
  state: GameState;
  humanTurn: boolean;
  prefix: string;
  onDraw: (from: "stock" | "discard") => void;
  onTakeJolly: () => void;
  canJolly: boolean;
  stockRef: React.RefObject<HTMLButtonElement | null>;
  discardRef: React.RefObject<HTMLButtonElement | null>;
  jollyRef: React.RefObject<HTMLDivElement | null>;
  pilePopId?: number | null;
  closingTopId?: number | null;
}) {
  const canDraw = humanTurn && state.turnPhase === "draw" && !state.skipDraw && state.phase === "play";
  const top = state.discard[state.discard.length - 1];
  const under = state.discard.length > 1 ? state.discard[state.discard.length - 2] : null;
  const isClosingTop = closingTopId != null && !!top && top.id === closingTopId;
  return (
    <div className="flex items-center justify-center gap-6 sm:gap-10">
      {/* stock */}
      <div className="flex flex-col items-center gap-1.5">
        <motion.button
          ref={stockRef}
          type="button"
          aria-label="Dobírací balíček"
          onClick={() => canDraw && onDraw("stock")}
          className={`relative ${canDraw ? "cursor-pointer" : "cursor-default"}`}
          whileHover={canDraw ? { y: -4, scale: 1.04 } : undefined}
          whileTap={canDraw ? { scale: 0.95 } : undefined}
        >
          {[3, 2, 1, 0].map((i) => (
            <div
              key={i}
              className="card-back absolute rounded-lg"
              style={{
                width: CARD_SIZES.md.w,
                aspectRatio: "5/7",
                left: i * 1.5,
                top: -i * 1.5,
                zIndex: 4 - i,
                boxShadow: canDraw && i === 0 ? "0 0 22px rgba(5,217,232,0.5)" : undefined,
              }}
            />
          ))}
          <div
            className="rounded-lg flex items-center justify-center"
            style={{ width: CARD_SIZES.md.w, aspectRatio: "5/7", position: "relative" }}
          >
            <span className="font-pixel text-[13px] opacity-60 relative z-10" style={{ textShadow: "0 0 10px rgba(181,55,242,0.9)" }}>
              Ž
            </span>
          </div>
          {canDraw && (
            <motion.div
              className="absolute inset-0 rounded-lg border-2 border-neon-blue"
              animate={{ opacity: [0.4, 1, 0.4] }}
              transition={{ duration: 1.4, repeat: Infinity }}
            />
          )}
        </motion.button>
        <span className="font-pixel text-[7px] opacity-60">BALÍČEK · {state.deck.length}</span>
        {/* face-up bottom card — Jolly Hand only */}
        {state.jollyCard && (
          <div className="flex flex-col items-center gap-1 mt-1">
            <div
              ref={jollyRef}
              className="rounded-md overflow-hidden border border-neon-gold/50"
              style={{ filter: canJolly ? "drop-shadow(0 0 10px rgba(255,211,25,0.5))" : "opacity(0.55)" }}
              title="Spodní karta — jen pro Jolly Hand"
            >
              <PlayingCard card={state.jollyCard} size="sm" noAnim />
            </div>
            <button
              type="button"
              onClick={onTakeJolly}
              disabled={!canJolly}
              className="btn-arcade btn-gold px-2 py-1.5 text-[7px]"
            >
              JOLLY HAND
            </button>
          </div>
        )}
      </div>

      {/* discard */}
      <div className="flex flex-col items-center gap-1.5">
        <motion.button
          ref={discardRef}
          type="button"
          aria-label="Odhazovací hromádka"
          onClick={() => canDraw && state.discard.length > 0 && onDraw("discard")}
          className={`relative ${canDraw && state.discard.length > 0 ? "cursor-pointer" : "cursor-default"}`}
          whileHover={canDraw && state.discard.length > 0 ? { y: -4, scale: 1.04 } : undefined}
          whileTap={canDraw && state.discard.length > 0 ? { scale: 0.95 } : undefined}
        >
          {top ? (
            isClosingTop ? (
              <div
                key={top.id}
                className="closing-stack"
                style={{ filter: canDraw ? "drop-shadow(0 0 14px rgba(255,211,25,0.45))" : undefined }}
              >
                {under ? (
                  <div
                    data-testid="closing-pile-under"
                    className="closing-stack-under"
                    aria-hidden
                  >
                    <PlayingCard
                      card={under}
                      size="md"
                      prefix={prefix}
                      noAnim
                    />
                  </div>
                ) : (
                  <div
                    data-testid="closing-pile-under"
                    className="closing-stack-under closing-stack-under-empty rounded-lg border-2 border-dashed border-white/20"
                    style={{ width: CARD_SIZES.md.w, aspectRatio: "5/7" }}
                    aria-hidden
                  />
                )}
                <div
                  data-testid="closing-pile-top"
                  className="card-close-offset"
                >
                  <div
                    className={`card-back rounded-lg ${top.id === pilePopId ? "card-discard-pop card-discard-glow" : ""}`}
                    style={{ width: CARD_SIZES.md.w, aspectRatio: "5/7" }}
                  />
                </div>
              </div>
            ) : (
            <div
              key={top.id}
              style={{ filter: canDraw ? "drop-shadow(0 0 14px rgba(255,211,25,0.45))" : undefined }}
            >
              <PlayingCard
                card={top}
                size="md"
                prefix={prefix}
                noAnim
                className={top.id === pilePopId ? "card-discard-pop card-discard-glow" : ""}
              />
            </div>
            )
          ) : (
            <div
              className="rounded-lg border-2 border-dashed border-white/20 flex items-center justify-center"
              style={{ width: CARD_SIZES.md.w, aspectRatio: "5/7" }}
            >
              <span className="font-pixel text-[7px] opacity-40 text-center leading-relaxed">PRÁZDNÁ<br />HROMÁDKA</span>
            </div>
          )}
          {canDraw && state.discard.length > 0 && (
            <motion.div
              className="absolute inset-0 rounded-lg border-2 border-neon-gold pointer-events-none"
              animate={{ opacity: [0.4, 1, 0.4] }}
              transition={{ duration: 1.4, repeat: Infinity }}
            />
          )}
        </motion.button>
        <span className="font-pixel text-[7px] opacity-60">HROMÁDKA · {state.discard.length}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main board                                                         */
/* ------------------------------------------------------------------ */

export default function Board({
  state,
  animKey,
  thinkingBot,
  stepText,
  selected,
  onToggleCard,
  onDraw,
  onTakeJolly,
  onLay,
  onDiscard,
  onUndoPickup,
  onSort,
  sortOn,
  onHint,
  onMeldClick,
  onReorderHand,
  onOpenMenu,
  muted,
  onToggleMute,
  lastDraw,
  onDrawFlightDone,
  onDrawBusyChange,
  lastDiscard,
  onDiscardFlightDone,
  lastBotDraw,
  onBotDrawFlightDone,
  lastBotDiscard,
  onBotDiscardFlightDone,
  closingTopId,
}: BoardProps) {
  const human = state.players[0];
  const humanTurn = state.current === 0 && state.phase === "play";
  const bots = state.players.slice(1);

  const selectedCard: Card | null = useMemo(() => {
    if (selected.length !== 1) return null;
    return human.hand.find((c) => c.id === selected[0]) ?? null;
  }, [selected, human.hand]);

  const interactive = humanTurn && state.turnPhase === "action" && selectedCard !== null;

  // stagger the deal animation only on the first render of a fresh round
  const roundRef = useRef(0);
  // hover affordances only where hover can end — touch taps would stick lifted
  const canHover = useMemo(deviceHovers, []);
  // set while a card drag is in flight so the trailing click doesn't toggle select
  const dragMoved = useRef(false);
  const isNewRound = roundRef.current !== state.round;
  roundRef.current = state.round;
  const prefix = `g${animKey}-`;

  /* ---- draw-flight: conceal → fly → reveal. The drawn card stays out
     of the rendered hand until it lands, so the eye tracks ONE card. ---- */
  const stockRef = useRef<HTMLButtonElement | null>(null);
  const discardRef = useRef<HTMLButtonElement | null>(null);
  const jollyRef = useRef<HTMLDivElement | null>(null);
  const handRowRef = useRef<HTMLDivElement | null>(null);
  const slotRefs = useRef(new Map<number, HTMLDivElement>());
  const chipRefs = useRef(new Map<number, HTMLDivElement>());
  interface FlightGeom {
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    w: number;
    h: number;
    apex: number;
    from: "stock" | "discard" | "jolly";
  }
  const [flight, setFlight] = useState<FlightGeom | null>(null);
  const [landed, setLanded] = useState(false);
  const landTimer = useRef(0);
  const flightCard: Card | null = lastDraw
    ? (human.hand.find((c) => c.id === lastDraw.cardId) ?? null)
    : null;
  // Index the card will occupy (live state → correct for auto-sort too).
  const insertIndex =
    lastDraw && flightCard
      ? human.hand.findIndex((c) => c.id === lastDraw.cardId)
      : -1;
  // While concealed the hand renders WITHOUT the new card: nothing jumps,
  // no gap opens early, and drag/click input is hushed for the flight.
  const concealed =
    !!lastDraw && !!flightCard && !landed && !isNewRound && insertIndex >= 0;
  const displayedHand = concealed
    ? human.hand.filter((c) => c.id !== lastDraw!.cardId)
    : human.hand;
  const hushDraw = concealed && !landed;

  /* ---- discard-flight: hold gap → fly → commit. Mirror of the pickup:
     the card stays in state while its ghost travels slot → pile, and the
     engine discard runs only after it lands. ---- */
  interface DiscardGeom {
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    w: number;
    h: number;
    apex: number;
  }
  const [discardFlight, setDiscardFlight] = useState<DiscardGeom | null>(null);
  const [discardLanded, setDiscardLanded] = useState(false);
  const discardTimer = useRef(0);
  // Pile-top pop key: survives the parent clearing lastDiscard on commit.
  const [pilePopId, setPilePopId] = useState<number | null>(null);
  // Ghost snapshot: survives the parent clearing lastDiscard on commit so
  // the fade-out can finish.
  const [discardGhost, setDiscardGhost] = useState<Card | null>(null);
  // Whether the in-flight ghost is the closing card (upside-down, face-down).
  // Stored alongside the ghost so the fade-out keeps its look after the
  // parent clears lastDiscard on commit.
  const [discardClosing, setDiscardClosing] = useState(false);
  useEffect(() => {
    if (pilePopId === null) return;
    const t = window.setTimeout(() => setPilePopId(null), 500);
    return () => window.clearTimeout(t);
  }, [pilePopId]);
  // Source slot rect captured on ODHODIT click (before the hand re-renders),
  // since the slot unmounts once the ghost is in the air.
  const discardFromRef = useRef<DOMRect | null>(null);
  const discarding = !!lastDiscard && !isNewRound;
  // Stay hushed while the ghost is still fading so a drag can't start
  // mid-slide and break the close-together layout animation.
  const hushDiscard = discarding || !!discardFlight;
  const hushHand = hushDraw || hushDiscard;

  useEffect(() => {
    onDrawBusyChange?.(hushHand);
  }, [hushHand, onDrawBusyChange]);

  useEffect(() => {
    if (!lastDraw || !flightCard || isNewRound || insertIndex < 0) {
      if (!lastDraw) {
        setFlight(null);
        setLanded(false);
      }
      return;
    }
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      sfx.draw();
      onDrawFlightDone?.();
      return;
    }
    let cancelled = false;
    // A new pickup always starts concealed, even if a previous landing
    // was still showing its glow.
    setLanded(false);
    // Two rAFs so the concealed (pre-draw) hand has laid out.
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled) return;
        const row = handRowRef.current;
        const src =
          lastDraw.from === "stock"
            ? stockRef.current
            : lastDraw.from === "discard"
              ? discardRef.current
              : (jollyRef.current ?? stockRef.current);
        if (!row || !src) {
          sfx.draw();
          onDrawFlightDone?.();
          return;
        }
        const s = src.getBoundingClientRect();
        const rects = [...slotRefs.current.entries()]
          .sort((a, b) => a[1].getBoundingClientRect().left - b[1].getBoundingClientRect().left)
          .map(([, el]) => el.getBoundingClientRect());
        let w: number;
        let h: number;
        let toX: number;
        let toY: number;
        if (rects.length > 0) {
          const first = rects[0];
          w = first.width;
          h = first.height;
          toY = first.top;
          // step captures the negative fan overlap at any breakpoint
          const step = rects.length > 1 ? rects[1].left - first.left : w - 26;
          const overflow = row.scrollWidth > row.clientWidth + 1;
          // Fit mode: the row re-centers around the newcomer (shift −step/2).
          // Overflow mode: siblings stay put, the slot opens at k·step.
          toX = overflow
            ? first.left + insertIndex * step
            : first.left - step / 2 + insertIndex * step;
        } else {
          // Empty old hand — land in the row center.
          const rowRect = row.getBoundingClientRect();
          w = 60;
          h = w * 1.4;
          toX = rowRect.left + rowRect.width / 2 - w / 2;
          toY = rowRect.top + rowRect.height / 2 - h / 2;
        }
        if (w === 0) {
          sfx.draw();
          onDrawFlightDone?.();
          return;
        }
        const fromX = s.left + s.width / 2 - w / 2;
        const fromY = s.top + s.height / 2 - h / 2;
        setLanded(false);
        setFlight({
          fromX,
          fromY,
          toX,
          toY,
          w,
          h,
          apex: Math.min(fromY, toY) - 84,
          from: lastDraw.from,
        });
        sfx.pickTick();
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastDraw?.cardId, lastDraw?.from, state.round, animKey]);

  // Card vanished (round change) mid-flight — bail out cleanly.
  useEffect(() => {
    if (lastDraw && !flightCard) {
      window.clearTimeout(landTimer.current);
      setFlight(null);
      setLanded(false);
      onDrawFlightDone?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastDraw?.cardId, flightCard === null]);

  useEffect(
    () => () => {
      window.clearTimeout(landTimer.current);
      window.clearTimeout(discardTimer.current);
      window.clearTimeout(botLandTimer.current);
      window.clearTimeout(botDiscardTimer.current);
    },
    []
  );

  const beginLanding = () => {
    if (landed) return;
    setLanded(true);
    sfx.land();
    // Glide the row if the new slot landed out of view — the hand
    // literally centers itself around the newcomer.
    requestAnimationFrame(() => {
      slotRefs.current
        .get(lastDraw?.cardId ?? -1)
        ?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
    });
    // Let the pop + glow read, then hand control back to the parent.
    window.clearTimeout(landTimer.current);
    landTimer.current = window.setTimeout(() => {
      setFlight(null);
      onDrawFlightDone?.();
    }, 360);
  };

  /* ---- discard-flight effects (mirror of draw-flight, reversed) ---- */
  useEffect(() => {
    if (!lastDiscard || isNewRound) {
      if (!lastDiscard && !discardLanded) {
        setDiscardFlight(null);
        setDiscardGhost(null);
        setDiscardClosing(false);
        setDiscardLanded(false);
        discardFromRef.current = null;
      }
      if (!lastDiscard) discardFromRef.current = null;
      return;
    }
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      onDiscardFlightDone?.();
      return;
    }
    let cancelled = false;
    setDiscardLanded(false);
    // Two rAFs so the held-gap hand has laid out before measuring the pile.
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled) return;
        const dst = discardRef.current;
        const srcRect = discardFromRef.current;
        if (!dst || !srcRect) {
          onDiscardFlightDone?.();
          return;
        }
        const d = dst.getBoundingClientRect();
        const w = srcRect.width;
        const h = srcRect.height;
        if (w === 0 || h === 0) {
          onDiscardFlightDone?.();
          return;
        }
        const fromX = srcRect.left;
        const fromY = srcRect.top;
        const toX = d.left + d.width / 2 - w / 2;
        const toY = d.top + d.height / 2 - h / 2;
        setDiscardGhost(lastDiscard.card);
        setDiscardClosing(!!lastDiscard.isClosing);
        setDiscardFlight({
          fromX,
          fromY,
          toX,
          toY,
          w,
          h,
          apex: Math.min(fromY, toY) - 84,
        });
        sfx.pickTick();
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastDiscard?.cardId, state.round, animKey]);

  // Discard target vanished (round change) mid-flight — bail out cleanly.
  useEffect(() => {
    if (lastDiscard && isNewRound) {
      window.clearTimeout(discardTimer.current);
      setDiscardFlight(null);
      setDiscardGhost(null);
      setDiscardClosing(false);
      setDiscardLanded(false);
      discardFromRef.current = null;
      onDiscardFlightDone?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastDiscard?.cardId, state.round]);

  const beginDiscardLanding = () => {
    if (discardLanded) return;
    setDiscardLanded(true);
    // Remember which pile top should pop: the parent clears lastDiscard
    // on commit, so the pop key must survive locally.
    if (lastDiscard) setPilePopId(lastDiscard.cardId);
    // Commit the engine discard now: the pile top appears with its pop
    // while the ghost fades (mirrors the pickup handoff). The discard
    // thock itself plays from the commit's game events.
    onDiscardFlightDone?.();
    window.clearTimeout(discardTimer.current);
    discardTimer.current = window.setTimeout(() => {
      setDiscardFlight(null);
      setDiscardGhost(null);
      setDiscardClosing(false);
    }, 320);
  };

  const handleDiscardClick = () => {
    // Capture the source slot geometry before the parent re-renders —
    // the slot unmounts once the ghost is airborne.
    if (selected.length === 1) {
      const el = slotRefs.current.get(selected[0]);
      discardFromRef.current = el?.getBoundingClientRect() ?? null;
    } else {
      discardFromRef.current = null;
    }
    onDiscard();
  };

  /* ---- bot draw-flight: commit-then-conceal pile → chip. Mirror of the
     human pickup, but the target is the opponent chip (backs only) and
     the chip count stays -1 until the ghost lands. ---- */
  interface BotFlightGeom {
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    w: number;
    h: number;
    apex: number;
  }
  const [botFlight, setBotFlight] = useState<BotFlightGeom | null>(null);
  const [botLanded, setBotLanded] = useState(false);
  const botLandTimer = useRef(0);
  const botDrawPlayer = lastBotDraw ? state.players[lastBotDraw.playerId] : null;
  const botDrawConcealed =
    !!lastBotDraw && !!botDrawPlayer && !botLanded && !isNewRound &&
    botDrawPlayer.hand.some((c) => c.id === lastBotDraw.cardId);

  useEffect(() => {
    if (!lastBotDraw || isNewRound || !botDrawConcealed) {
      if (!lastBotDraw) {
        setBotFlight(null);
        setBotLanded(false);
      }
      return;
    }
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      sfx.draw();
      onBotDrawFlightDone?.();
      return;
    }
    let cancelled = false;
    setBotLanded(false);
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled) return;
        const src =
          lastBotDraw.from === "stock"
            ? stockRef.current
            : lastBotDraw.from === "discard"
              ? discardRef.current
              : (jollyRef.current ?? stockRef.current);
        const dst = chipRefs.current.get(lastBotDraw.playerId);
        if (!src || !dst) {
          sfx.draw();
          onBotDrawFlightDone?.();
          return;
        }
        const s = src.getBoundingClientRect();
        const d = dst.getBoundingClientRect();
        const w = Math.min(s.width || 54, 64) || 54;
        const h = w * 1.4;
        if (w === 0) {
          sfx.draw();
          onBotDrawFlightDone?.();
          return;
        }
        setBotFlight({
          fromX: s.left + s.width / 2 - w / 2,
          fromY: s.top + s.height / 2 - h / 2,
          toX: d.left + d.width / 2 - w / 2,
          toY: d.top + d.height / 2 - h / 2,
          w,
          h,
          apex: Math.min(s.top, d.top) - 84,
        });
        sfx.pickTick();
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastBotDraw?.cardId, lastBotDraw?.from, lastBotDraw?.playerId, state.round, animKey]);

  useEffect(() => {
    if (lastBotDraw && !botDrawConcealed && !isNewRound) {
      window.clearTimeout(botLandTimer.current);
      setBotFlight(null);
      setBotLanded(false);
      onBotDrawFlightDone?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastBotDraw?.cardId, botDrawConcealed]);

  useEffect(() => {
    if (lastBotDraw && isNewRound) {
      window.clearTimeout(botLandTimer.current);
      setBotFlight(null);
      setBotLanded(false);
      onBotDrawFlightDone?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastBotDraw?.cardId, state.round]);

  const beginBotLanding = () => {
    if (botLanded) return;
    setBotLanded(true);
    sfx.land();
    window.clearTimeout(botLandTimer.current);
    botLandTimer.current = window.setTimeout(() => {
      setBotFlight(null);
      onBotDrawFlightDone?.();
    }, 360);
  };

  /* ---- bot discard-flight: fly-then-commit chip → pile. Mirror of the
     human discard, but the source is the opponent chip and the ghost is
     the staged face-up snapshot. ---- */
  const [botDiscardFlight, setBotDiscardFlight] = useState<BotFlightGeom | null>(null);
  const [botDiscardLanded, setBotDiscardLanded] = useState(false);
  const [botDiscardGhost, setBotDiscardGhost] = useState<Card | null>(null);
  const [botDiscardClosing, setBotDiscardClosing] = useState(false);
  const botDiscardTimer = useRef(0);

  useEffect(() => {
    if (!lastBotDiscard || isNewRound) {
      if (!lastBotDiscard && !botDiscardLanded) {
        setBotDiscardFlight(null);
        setBotDiscardGhost(null);
        setBotDiscardClosing(false);
        setBotDiscardLanded(false);
      }
      return;
    }
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      onBotDiscardFlightDone?.();
      return;
    }
    let cancelled = false;
    setBotDiscardLanded(false);
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled) return;
        const src = chipRefs.current.get(lastBotDiscard.playerId);
        const dst = discardRef.current;
        if (!src || !dst) {
          onBotDiscardFlightDone?.();
          return;
        }
        const s = src.getBoundingClientRect();
        const d = dst.getBoundingClientRect();
        const w = Math.min(d.width || 54, 64) || 54;
        const h = w * 1.4;
        if (w === 0 || h === 0) {
          onBotDiscardFlightDone?.();
          return;
        }
        setBotDiscardGhost(lastBotDiscard.card);
        setBotDiscardClosing(!!lastBotDiscard.isClosing);
        setBotDiscardFlight({
          fromX: s.left + s.width / 2 - w / 2,
          fromY: s.top + s.height / 2 - h / 2,
          toX: d.left + d.width / 2 - w / 2,
          toY: d.top + d.height / 2 - h / 2,
          w,
          h,
          apex: Math.min(s.top, d.top) - 84,
        });
        sfx.pickTick();
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastBotDiscard?.cardId, lastBotDiscard?.playerId, state.round, animKey]);

  useEffect(() => {
    if (lastBotDiscard && isNewRound) {
      window.clearTimeout(botDiscardTimer.current);
      setBotDiscardFlight(null);
      setBotDiscardGhost(null);
      setBotDiscardClosing(false);
      setBotDiscardLanded(false);
      onBotDiscardFlightDone?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastBotDiscard?.cardId, state.round]);

  const beginBotDiscardLanding = () => {
    if (botDiscardLanded) return;
    setBotDiscardLanded(true);
    if (lastBotDiscard) setPilePopId(lastBotDiscard.cardId);
    onBotDiscardFlightDone?.();
    window.clearTimeout(botDiscardTimer.current);
    botDiscardTimer.current = window.setTimeout(() => {
      setBotDiscardFlight(null);
      setBotDiscardGhost(null);
      setBotDiscardClosing(false);
    }, 320);
  };

  const canJolly = useMemo(() => {
    if (!humanTurn || state.phase !== "play") return false;
    if (state.turnPhase !== "draw" || state.skipDraw) return false;
    if (!state.jollyCard || human.hand.length !== RULES.HAND_SIZE) return false;
    const pool = [...human.hand, state.jollyCard];
    return coverAll(pool) !== null || canJollyClose(pool);
  }, [humanTurn, state, human.hand]);

  const status = (() => {
    if (state.phase !== "play") return { title: "", sub: "", cls: "" };
    if (!humanTurn) {
      const bot = state.players[state.current];
      return { title: `${bot.name}`, sub: thinkingBot !== null ? stepText || "přemýšlí…" : "čekej…", cls: "neon-pink" };
    }
    if (state.jollyRush) return { title: "JOLLY HAND!", sub: "vylož vše a poslední kartu odhoď", cls: "neon-gold" };
    if (state.skipDraw) return { title: "ODHOĎ KARTU", sub: "začínáš kolo jako předák", cls: "neon-gold" };
    // While melding is locked the only legal moves are draw + discard —
    // the status hint already says so, so the table header stays quiet.
    const locked = meldsLocked(state);
    if (state.turnPhase === "draw")
      return locked
        ? { title: "TÁHNI SI", sub: `balíček — hromádka až po ${RULES.MELD_WAIT_ROUNDS}. kole`, cls: "neon-blue" }
        : { title: "TÁHNI SI", sub: "balíček, hromádka (hned vyložit) nebo JOLLY", cls: "neon-blue" };
    if (state.pendingLayId !== null && human.hand.some((c) => c.id === state.pendingLayId))
      return { title: "VYLOŽ KARTU", sub: "kartu z hromádky musíš hned vyložit, nebo ji vrať zpět", cls: "neon-gold" };
    if (state.pendingJokerId !== null && human.hand.some((c) => c.id === state.pendingJokerId))
      return { title: "VYUŽIJ ŽOLÍKA", sub: "vyměněného žolíka musíš v tomto tahu využít", cls: "neon-gold" };
    if (locked)
      return { title: "ODHOĎ KARTU", sub: `vykládání až po ${RULES.MELD_WAIT_ROUNDS}. kole`, cls: "neon-gold" };
    return { title: "JSI NA ŘADĚ", sub: "vylož kombinaci, přilož, vyměň žolíka nebo odhoď", cls: "neon-green" };
  })();

  return (
    <div className="h-full flex flex-col overflow-hidden arcade-bg" data-testid="board">
      {/* header */}
      <header className="flex items-center gap-3 px-3 sm:px-5 py-2.5 border-b border-white/10 shrink-0">
        <div className="font-pixel text-[13px] sm:text-[16px] neon-pink tracking-wider">ŽOLÍKY</div>
        <div className="hidden sm:flex items-center gap-2 ml-2">
          <span className="font-pixel text-[8px] px-2 py-1 rounded border border-white/15 bg-white/5">
            KOLO {state.round}
          </span>
          <span className="font-pixel text-[8px] px-2 py-1 rounded border border-white/15 bg-white/5">
            CÍL {state.target}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleMute}
            className="btn-arcade btn-ghost w-9 h-9 flex items-center justify-center"
            aria-label={muted ? "Zapnout zvuk" : "Vypnout zvuk"}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="square" aria-hidden>
              <path d="M11 5 6 9H3v6h3l5 4V5z" fill="currentColor" stroke="none" />
              {muted ? (
                <path d="M16 9l5 6M21 9l-5 6" />
              ) : (
                <>
                  <path d="M15.5 9.5a4 4 0 0 1 0 5" />
                  <path d="M18 7a7.5 7.5 0 0 1 0 10" />
                </>
              )}
            </svg>
          </button>
          <button type="button" onClick={onOpenMenu} className="btn-arcade btn-ghost px-2.5 py-2 text-[9px]">
            MENU
          </button>
        </div>
      </header>

      {/* opponents */}
      <div className="px-3 sm:px-5 pt-3 shrink-0">
        <div className={`grid gap-2.5 ${bots.length === 1 ? "grid-cols-1 max-w-md mx-auto" : bots.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
          {bots.map((b) => (
            <div
              key={b.id}
              ref={(el) => {
                if (el) chipRefs.current.set(b.id, el);
                else chipRefs.current.delete(b.id);
              }}
            >
              <PlayerChip
                state={state}
                idx={b.id}
                isTurn={state.current === b.id}
                thinking={thinkingBot === b.id}
                concealed={!!lastBotDraw && lastBotDraw.playerId === b.id && botDrawConcealed}
              />
            </div>
          ))}
        </div>
      </div>

      {/* center: piles + status + log + table melds */}
      <div className="flex-1 min-h-0 px-3 sm:px-5 py-2 flex flex-col lg:flex-row gap-3">
        <div className="flex lg:flex-col items-center justify-center gap-3 lg:gap-2 lg:w-72 shrink-0">
          <Piles state={state} humanTurn={humanTurn} prefix={prefix} onDraw={onDraw} onTakeJolly={onTakeJolly} canJolly={canJolly} stockRef={stockRef} discardRef={discardRef} jollyRef={jollyRef} pilePopId={pilePopId} closingTopId={closingTopId} />
          <AnimatePresence mode="wait">
            <motion.div
              key={state.current + "-" + state.turnPhase + "-" + (thinkingBot ?? "x")}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
              className="text-center"
            >
              {status.title && (
                <div className={`font-pixel text-[12px] sm:text-[14px] ${status.cls} ${!humanTurn ? "anim-blink" : ""}`}>
                  {status.title}
                </div>
              )}
              {status.sub && <div className="font-pixel text-[7.5px] mt-1.5 opacity-60 leading-relaxed">{status.sub}</div>}
            </motion.div>
          </AnimatePresence>
          <div className="hidden lg:block w-full glass-tile rounded-lg px-2.5 py-2 max-h-28 overflow-y-auto pixel-scroll">
            {state.log.slice(-6).map((l) => (
              <div key={l.id} className={`font-pixel text-[6.5px] leading-[1.7] ${
                l.kind === "good" ? "text-neon-green" : l.kind === "bad" ? "text-neon-pink" : l.kind === "warn" ? "text-neon-gold" : "opacity-60"
              }`}>
                › {l.text}
              </div>
            ))}
          </div>
        </div>

        {/* table melds */}
        <div className="flex-1 min-h-0 panel p-3 overflow-y-auto pixel-scroll">
          <div className="flex items-center justify-between mb-2">
            <span className="panel-title">Výklady na stole</span>
            <span className="font-pixel text-[7px] opacity-50">{kombinaceCount(state.melds.length)}</span>
          </div>
          {state.melds.length === 0 ? (
            <div className="h-full min-h-[80px] flex items-center justify-center border-2 border-dashed border-white/10 rounded-lg">
              <span className="font-pixel text-[8px] opacity-40 text-center leading-relaxed">
                Zatím žádné výklady.<br />První výklad: {RULES.FIRST_MELD_POINTS} bodů + čistá postupka.
              </span>
            </div>
          ) : (
            <div className="flex flex-wrap gap-3 content-start">
              {state.melds.map((m) => {
                const owner = state.players[m.owner ?? 0];
                const swapHere =
                  interactive && selectedCard
                    ? findJokerSwap([m], [selectedCard])
                    : null;
                const targetable =
                  interactive &&
                  !swapHere &&
                  canAddToMeld(m, selectedCard!) !== null;
                return (
                  <MeldView
                    key={m.id}
                    meld={m}
                    ownerHue={owner.hue}
                    ownerName={owner.name}
                    prefix={prefix}
                    interactive={interactive}
                    targetable={targetable}
                    swapJokerId={swapHere ? swapHere.jokerCardId : null}
                    hoverLift={canHover}
                    onMeldClick={() => onMeldClick(m)}
                    onJokerClick={(jid) => onMeldClick(m, jid)}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* human zone */}
      <div className="shrink-0 px-3 sm:px-5 pb-3 pt-1">
        <div
          className={`panel px-3 py-2.5 transition-shadow${landed ? " hand-breathe" : ""}`}
          style={{
            boxShadow: humanTurn
              ? "0 0 24px rgba(5,217,232,0.28), inset 0 1px 0 rgba(255,255,255,0.07)"
              : undefined,
          }}
        >
          <div className="flex items-center gap-2.5 flex-wrap">
            <div
              className="w-7 h-7 rounded-md flex items-center justify-center font-pixel text-[10px] shrink-0"
              style={{
                background: `linear-gradient(160deg, ${hueColor(human.hue, 55)}, ${hueColor(human.hue, 35)})`,
                boxShadow: humanTurn ? `0 0 14px ${hueColor(human.hue, 50)}88` : undefined,
              }}
            >
              H
            </div>
            <div className="flex items-center gap-2">
              <span className="font-pixel text-[9px]">Hráč</span>
              <span className="font-pixel text-[10px] neon-gold">{human.score}</span>
              {human.melded && (
                <span className="font-pixel text-[7px] px-1.5 py-0.5 rounded bg-neon-green/20 text-neon-green border border-neon-green/40">
                  VYLOŽEN
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 ml-auto flex-wrap justify-end">
              {state.pendingLayId !== null &&
                human.hand.some((c) => c.id === state.pendingLayId) &&
                state.pickupUndoable && (
                  <button
                    type="button"
                    data-testid="btn-undo-pickup"
                    onClick={onUndoPickup}
                    disabled={!humanTurn || state.turnPhase !== "action" || hushHand}
                    className="btn-arcade btn-ghost px-2.5 py-2 text-[8px]"
                    title="Vrátit kartu z hromádky zpět a táhnout znovu"
                  >
                    VRÁTIT
                  </button>
                )}
              <button
                type="button"
                data-testid="btn-hint"
                onClick={onHint}
                disabled={!humanTurn || state.turnPhase !== "action" || hushHand}
                className="btn-arcade btn-blue px-2.5 py-2 text-[8px]"
              >
                RADCE
              </button>
              <button
                type="button"
                data-testid="btn-sort"
                onClick={onSort}
                disabled={!humanTurn || hushHand}
                aria-pressed={sortOn}
                title={sortOn ? "Automatické třídění zapnuto — nové karty se zařadí samy" : "Třídit karty (zapne automatické řazení nových karet)"}
                className={`btn-arcade px-2.5 py-2 text-[8px] ${sortOn ? "btn-green" : "btn-ghost"}`}
              >
                TŘÍDIT{sortOn ? " ●" : ""}
              </button>
              <button
                type="button"
                data-testid="btn-lay"
                onClick={onLay}
                disabled={!humanTurn || state.turnPhase !== "action" || selected.length < 3 || hushHand}
                className="btn-arcade btn-green px-2.5 py-2 text-[8px]"
              >
                VYLOŽIT{selected.length > 0 ? ` (${selected.length})` : ""}
              </button>
              <button
                type="button"
                data-testid="btn-discard"
                onClick={handleDiscardClick}
                disabled={!humanTurn || state.turnPhase !== "action" || selected.length !== 1 || hushHand}
                className="btn-arcade btn-primary px-2.5 py-2 text-[8px]"
              >
                ODHODIT
              </button>
            </div>
          </div>

          {/* hand — always the same Reorder tree so removals (e.g. discard
              commit, which also flips humanTurn off) slide together via
              layout instead of remounting into a flash. Drag/click/hover
              are gated by canInteract. */}
          {(() => {
            const canInteract = humanTurn && state.phase === "play";
            const interactive = canInteract && !hushHand;
            return (
            <Reorder.Group
              as="div"
              axis="x"
              values={displayedHand}
              onReorder={(cards) => {
                if (!canInteract) return;
                onReorderHand(cards.map((c) => c.id));
              }}
              ref={(el: unknown) => {
                handRowRef.current = el as HTMLDivElement | null;
              }}
              className={`fan-hand flex justify-center mt-3 overflow-x-auto no-scrollbar pt-6 pb-4 px-2${!interactive ? " pointer-events-none" : ""}`}
              data-testid="player-hand"
            >
              {displayedHand.map((c, i) => {
                const isSel = selected.includes(c.id);
                // Landing card: mounts fresh with no entrance drop — the CSS
                // pop + glow (fill backwards, no persistence) sells the
                // arrival while framer keeps full control afterwards.
                const justLanded = landed && lastDraw?.cardId === c.id;
                // Discarding card: hold its gap with an invisible placeholder
                // so siblings don't jump while the ghost is in the air. The
                // placeholder stays until the engine commit removes the card,
                // so siblings slide together instead of flashing.
                const isDiscarding =
                  discarding && lastDiscard?.cardId === c.id;
                if (isDiscarding) {
                  return (
                    <Reorder.Item
                      as="div"
                      key={c.id}
                      value={c}
                      layout
                      transition={{ type: "spring", stiffness: 320, damping: 30 }}
                      className="relative shrink-0"
                      style={{ zIndex: i, opacity: 0, pointerEvents: "none" }}
                      title=""
                    >
                      <div
                        aria-hidden
                        style={{ width: CARD_SIZES.lg.w, aspectRatio: "5 / 7" }}
                      />
                    </Reorder.Item>
                  );
                }
                return (
                  <Reorder.Item
                    as="div"
                    key={c.id}
                    value={c}
                    ref={(el: unknown) => {
                      if (el) slotRefs.current.set(c.id, el as HTMLDivElement);
                      else slotRefs.current.delete(c.id);
                    }}
                    layout
                    transition={{ type: "spring", stiffness: 320, damping: 30 }}
                    className="hand-draggable relative shrink-0"
                    style={{ zIndex: justLanded ? 60 : isSel ? 50 : i }}
                    dragListener={interactive}
                    whileDrag={canInteract ? { scale: 1.12, zIndex: 100 } : undefined}
                    onDragStart={() => {
                      dragMoved.current = true;
                    }}
                    onDragEnd={() => {
                      window.setTimeout(() => {
                        dragMoved.current = false;
                      }, 0);
                    }}
                    title={canInteract ? "Přetáhni pro změnu pořadí" : undefined}
                  >
                    <PlayingCard
                      card={c}
                      prefix={prefix}
                      size="lg"
                      selected={isSel}
                      hoverable={canInteract}
                      hoverLift={canHover}
                      lifted={isSel}
                      dealDelay={isNewRound ? Math.min(i * 0.04, 0.6) : 0}
                      noAnim={justLanded}
                      zIndex={justLanded ? 60 : isSel ? 50 : i}
                      className={justLanded ? "card-land-pop card-land-glow" : ""}
                      onClick={
                        canInteract
                          ? () => {
                              if (!dragMoved.current) onToggleCard(c.id);
                            }
                          : undefined
                      }
                    />
                  </Reorder.Item>
                );
              })}
              {displayedHand.length === 0 && (
                <span className="font-pixel text-[8px] opacity-40 py-6">Ruka je prázdná…</span>
              )}
            </Reorder.Group>
            );
          })()}
        </div>
      </div>

      {/* flying pickup: exactly one card travels pile → slot, then hands
          off to the real card's pop (no crossfade ghost) */}
      {flight && flightCard && (
        <motion.div
          key={`draw-flight-${flightCard.id}`}
          data-testid="draw-flight"
          style={{
            position: "fixed",
            left: 0,
            top: 0,
            width: flight.w,
            height: flight.h,
            zIndex: 80,
            pointerEvents: "none",
            perspective: 800,
            filter: "drop-shadow(0 12px 24px rgba(0,0,0,0.55))",
          }}
          initial={{ x: flight.fromX, y: flight.fromY, scale: 0.62, rotate: -12, opacity: 0 }}
          animate={
            landed
              ? { x: flight.toX, y: flight.toY, scale: 0.9, rotate: 0, opacity: 0 }
              : {
                  x: flight.toX,
                  y: [flight.fromY, flight.apex, flight.toY],
                  scale: [0.62, 1, 1.03],
                  rotate: [-12, 3, 0],
                  opacity: [0, 1, 1],
                }
          }
          transition={
            landed
              ? { duration: 0.12, ease: "easeOut" }
              : { duration: 0.6, ease: [0.22, 0.9, 0.3, 1] }
          }
          onAnimationComplete={() => {
            if (!landed) beginLanding();
            else setFlight(null);
          }}
        >
          {flight.from === "stock" ? (
            <motion.div
              style={{ width: "100%", height: "100%", position: "relative", transformStyle: "preserve-3d" }}
              initial={{ rotateY: 0 }}
              animate={{ rotateY: 180 }}
              transition={{ duration: 0.6, ease: "easeInOut" }}
            >
              <div style={{ position: "absolute", inset: 0, backfaceVisibility: "hidden" }}>
                <div className="card-back" style={{ width: "100%", height: "100%" }} />
              </div>
              <div style={{ position: "absolute", inset: 0, backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}>
                <PlayingCard card={flightCard} size="lg" noAnim style={{ width: "100%" }} />
              </div>
            </motion.div>
          ) : (
            <PlayingCard
              card={flightCard}
              size="lg"
              noAnim
              style={{ width: "100%" }}
            />
          )}
        </motion.div>
      )}

      {/* flying discard: exactly one card travels slot → pile, then hands
          off to the pile top's pop (mirror of the pickup, reversed).
          The closing card flies upside-down and face-down, like a real
          jolly close. */}
      {discardFlight && discardGhost && (
        <motion.div
          key={`discard-flight-${discardGhost.id}`}
          data-testid="discard-flight"
          data-closing={discardClosing ? "true" : undefined}
          style={{
            position: "fixed",
            left: 0,
            top: 0,
            width: discardFlight.w,
            height: discardFlight.h,
            zIndex: 80,
            pointerEvents: "none",
            perspective: 800,
            filter: "drop-shadow(0 12px 24px rgba(0,0,0,0.55))",
          }}
          initial={{ x: discardFlight.fromX, y: discardFlight.fromY, scale: 1.03, rotate: 0, opacity: 1 }}
          animate={
            discardLanded
              ? { x: discardFlight.toX, y: discardFlight.toY, scale: 0.62, rotate: discardClosing ? 180 : -12, opacity: 0 }
              : {
                  x: discardFlight.toX,
                  y: [discardFlight.fromY, discardFlight.apex, discardFlight.toY],
                  scale: [1.03, 1, 0.62],
                  rotate: discardClosing ? [0, 90, 180] : [0, 3, -12],
                  opacity: [1, 1, 1],
                }
          }
          transition={
            discardLanded
              ? { duration: 0.12, ease: "easeOut" }
              : { duration: 0.6, ease: [0.22, 0.9, 0.3, 1] }
          }
          onAnimationComplete={() => {
            if (!discardLanded) beginDiscardLanding();
            else {
              setDiscardFlight(null);
              setDiscardGhost(null);
              setDiscardClosing(false);
            }
          }}
        >
          {discardClosing ? (
            <div className="card-back rounded-lg" style={{ width: "100%", height: "100%" }} />
          ) : (
          <PlayingCard
            card={discardGhost}
            size="lg"
            noAnim
            style={{ width: "100%" }}
          />
          )}
        </motion.div>
      )}

      {/* bot pickup: pile → opponent chip. Stock/jolly stays face-down so
          the bot hand stays secret; discard-pile takes fly face-up. */}
      {botFlight && lastBotDraw && (
        <motion.div
          key={`bot-draw-flight-${lastBotDraw.playerId}-${lastBotDraw.cardId}`}
          data-testid="bot-draw-flight"
          style={{
            position: "fixed",
            left: 0,
            top: 0,
            width: botFlight.w,
            height: botFlight.h,
            zIndex: 80,
            pointerEvents: "none",
            perspective: 800,
            filter: "drop-shadow(0 12px 24px rgba(0,0,0,0.55))",
          }}
          initial={{ x: botFlight.fromX, y: botFlight.fromY, scale: 0.62, rotate: -12, opacity: 0 }}
          animate={
            botLanded
              ? { x: botFlight.toX, y: botFlight.toY, scale: 0.9, rotate: 0, opacity: 0 }
              : {
                  x: botFlight.toX,
                  y: [botFlight.fromY, botFlight.apex, botFlight.toY],
                  scale: [0.62, 1, 1.03],
                  rotate: [-12, 3, 0],
                  opacity: [0, 1, 1],
                }
          }
          transition={
            botLanded
              ? { duration: 0.12, ease: "easeOut" }
              : { duration: 0.6, ease: [0.22, 0.9, 0.3, 1] }
          }
          onAnimationComplete={() => {
            if (!botLanded) beginBotLanding();
            else setBotFlight(null);
          }}
        >
          {lastBotDraw.from === "discard" ? (
            <PlayingCard card={lastBotDraw.card} size="md" noAnim style={{ width: "100%" }} />
          ) : (
            <div className="card-back" style={{ width: "100%", height: "100%" }} />
          )}
        </motion.div>
      )}

      {/* bot discard: opponent chip → pile, then hands off to the pile
          top's pop (mirror of the bot pickup, reversed).
          The closing card flies upside-down and face-down. */}
      {botDiscardFlight && botDiscardGhost && (
        <motion.div
          key={`bot-discard-flight-${botDiscardGhost.id}`}
          data-testid="bot-discard-flight"
          data-closing={botDiscardClosing ? "true" : undefined}
          style={{
            position: "fixed",
            left: 0,
            top: 0,
            width: botDiscardFlight.w,
            height: botDiscardFlight.h,
            zIndex: 80,
            pointerEvents: "none",
            perspective: 800,
            filter: "drop-shadow(0 12px 24px rgba(0,0,0,0.55))",
          }}
          initial={{ x: botDiscardFlight.fromX, y: botDiscardFlight.fromY, scale: 1.03, rotate: 0, opacity: 1 }}
          animate={
            botDiscardLanded
              ? { x: botDiscardFlight.toX, y: botDiscardFlight.toY, scale: 0.62, rotate: botDiscardClosing ? 180 : -12, opacity: 0 }
              : {
                  x: botDiscardFlight.toX,
                  y: [botDiscardFlight.fromY, botDiscardFlight.apex, botDiscardFlight.toY],
                  scale: [1.03, 1, 0.62],
                  rotate: botDiscardClosing ? [0, 90, 180] : [0, 3, -12],
                  opacity: [1, 1, 1],
                }
          }
          transition={
            botDiscardLanded
              ? { duration: 0.12, ease: "easeOut" }
              : { duration: 0.6, ease: [0.22, 0.9, 0.3, 1] }
          }
          onAnimationComplete={() => {
            if (!botDiscardLanded) beginBotDiscardLanding();
            else {
              setBotDiscardFlight(null);
              setBotDiscardGhost(null);
              setBotDiscardClosing(false);
            }
          }}
        >
          {botDiscardClosing ? (
            <div className="card-back rounded-lg" style={{ width: "100%", height: "100%" }} />
          ) : (
          <PlayingCard
            card={botDiscardGhost}
            size="md"
            noAnim
            style={{ width: "100%" }}
          />
          )}
        </motion.div>
      )}
    </div>
  );
}
