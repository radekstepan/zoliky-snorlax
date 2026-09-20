import { motion, AnimatePresence, Reorder } from "framer-motion";
import { useMemo, useRef } from "react";
import { GameState, meldsLocked } from "../game/engine";
import { Meld, canAddToMeld, coverAll, findJokerSwap, meldPoints, isCleanRun } from "../game/melds";
import { Card, RULES } from "../game/core";
import PlayingCard, { CARD_SIZES } from "./PlayingCard";

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
  onSort: () => void;
  onHint: () => void;
  onMeldClick: (meld: Meld, jokerCardId?: number) => void;
  onReorderHand: (orderedIds: number[]) => void;
  onOpenMenu: () => void;
  muted: boolean;
  onToggleMute: () => void;
}

const hueColor = (hue: number, l = 60) => `hsl(${hue} 80% ${l}%)`;

/* ------------------------------------------------------------------ */
/*  Small player chip                                                  */
/* ------------------------------------------------------------------ */

function PlayerChip({ state, idx, isTurn, thinking }: { state: GameState; idx: number; isTurn: boolean; thinking: boolean }) {
  const p = state.players[idx];
  const active = state.phase === "play" && isTurn;
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
          {p.hand.slice(0, Math.min(5, p.hand.length)).map((c, i) => (
            <div key={c.id} className="card-back w-4 h-6 rounded-[4px] relative" style={{ zIndex: 5 - i }} />
          ))}
        </div>
        <span className="font-pixel text-[8px] opacity-70">{p.hand.length} karet</span>
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
  prefix: string;
  onMeldClick: () => void;
  onJokerClick: (jokerCardId: number) => void;
}

function MeldView({ meld, ownerHue, ownerName, interactive, targetable, swapJokerId, prefix, onMeldClick, onJokerClick }: MeldViewProps) {
  const pts = meldPoints(meld);
  const isRun = meld.type === "run";
  const size = meld.cards.length > 7 ? "sm" : "md";
  const clean = isCleanRun(meld);
  return (
    <div
      className={`relative rounded-lg border-2 transition-colors ${
        targetable ? "border-neon-gold/80 shadow-[0_0_16px_rgba(255,211,25,0.35)]" : "border-white/10"
      } ${interactive && !targetable ? "border-white/5" : ""}`}
      style={{ background: "rgba(13,9,32,0.55)", cursor: interactive ? "pointer" : "default" }}
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
          return (
            <PlayingCard
              key={c.id}
              card={c}
              prefix={prefix}
              noAnim={c.joker && c.jokerAs !== undefined}
              size={size}
              asRank={c.joker && c.jokerAs !== undefined ? c.jokerAs : undefined}
              asSuit={c.joker && c.jokerAs !== undefined && isRun ? meld.suit : undefined}
              target={isSwapTarget ?? false}
              hoverable={interactive}
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
}: {
  state: GameState;
  humanTurn: boolean;
  prefix: string;
  onDraw: (from: "stock" | "discard") => void;
  onTakeJolly: () => void;
  canJolly: boolean;
}) {
  const canDraw = humanTurn && state.turnPhase === "draw" && !state.skipDraw && state.phase === "play";
  const top = state.discard[state.discard.length - 1];
  return (
    <div className="flex items-center justify-center gap-6 sm:gap-10">
      {/* stock */}
      <div className="flex flex-col items-center gap-1.5">
        <motion.button
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
          type="button"
          aria-label="Odhazovací hromádka"
          onClick={() => canDraw && state.discard.length > 0 && onDraw("discard")}
          className={`relative ${canDraw && state.discard.length > 0 ? "cursor-pointer" : "cursor-default"}`}
          whileHover={canDraw && state.discard.length > 0 ? { y: -4, scale: 1.04 } : undefined}
          whileTap={canDraw && state.discard.length > 0 ? { scale: 0.95 } : undefined}
        >
          {top ? (
            <div style={{ filter: canDraw ? "drop-shadow(0 0 14px rgba(255,211,25,0.45))" : undefined }}>
              <PlayingCard card={top} size="md" prefix={prefix} noAnim />
            </div>
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
  onSort,
  onHint,
  onMeldClick,
  onReorderHand,
  onOpenMenu,
  muted,
  onToggleMute,
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
  // set while a card drag is in flight so the trailing click doesn't toggle select
  const dragMoved = useRef(false);
  const isNewRound = roundRef.current !== state.round;
  roundRef.current = state.round;
  const prefix = `g${animKey}-`;

  const canJolly = useMemo(() => {
    if (!humanTurn || state.phase !== "play") return false;
    if (state.turnPhase !== "draw" || state.skipDraw) return false;
    if (!state.jollyCard || human.hand.length !== RULES.HAND_SIZE) return false;
    return coverAll([...human.hand, state.jollyCard]) !== null;
  }, [humanTurn, state, human.hand]);

  const status = (() => {
    if (state.phase !== "play") return { title: "", sub: "", cls: "" };
    if (!humanTurn) {
      const bot = state.players[state.current];
      return { title: `${bot.name}`, sub: thinkingBot !== null ? stepText || "přemýšlí…" : "čekej…", cls: "neon-pink" };
    }
    if (state.jollyRush) return { title: "JOLLY HAND!", sub: "musíš vyložit celou ruku najednou", cls: "neon-gold" };
    if (state.skipDraw) return { title: "ODHOĎ KARTU", sub: "začínáš kolo jako předák", cls: "neon-gold" };
    if (state.turnPhase === "draw") return { title: "TÁHNI SI", sub: "balíček, hromádka (hned vyložit) nebo JOLLY", cls: "neon-blue" };
    if (state.pendingLayId !== null && human.hand.some((c) => c.id === state.pendingLayId))
      return { title: "VYLOŽ KARTU", sub: "kartu z hromádky musíš hned vyložit", cls: "neon-gold" };
    if (state.pendingJokerId !== null && human.hand.some((c) => c.id === state.pendingJokerId))
      return { title: "VYUŽIJ ŽOLÍKA", sub: "vyměněného žolíka musíš v tomto tahu využít", cls: "neon-gold" };
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
            <PlayerChip key={b.id} state={state} idx={b.id} isTurn={state.current === b.id} thinking={thinkingBot === b.id} />
          ))}
        </div>
      </div>

      {/* center: piles + status + log + table melds */}
      <div className="flex-1 min-h-0 px-3 sm:px-5 py-2 flex flex-col lg:flex-row gap-3">
        <div className="flex lg:flex-col items-center justify-center gap-3 lg:gap-2 lg:w-72 shrink-0">
          <Piles state={state} humanTurn={humanTurn} prefix={prefix} onDraw={onDraw} onTakeJolly={onTakeJolly} canJolly={canJolly} />
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
            {state.phase === "play" && meldsLocked(state) ? (
              <span className="font-pixel text-[7px] px-1.5 py-0.5 rounded bg-neon-gold/20 text-neon-gold border border-neon-gold/40">
                VYKLÁDÁNÍ AŽ PO {RULES.MELD_WAIT_ROUNDS}. KOLE
              </span>
            ) : (
              <span className="font-pixel text-[7px] opacity-50">{state.melds.length} kombinací</span>
            )}
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
          className="panel px-3 py-2.5 transition-shadow"
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
              T
            </div>
            <div className="flex items-center gap-2">
              <span className="font-pixel text-[9px]">Ty</span>
              <span className="font-pixel text-[10px] neon-gold">{human.score}</span>
              {human.melded && (
                <span className="font-pixel text-[7px] px-1.5 py-0.5 rounded bg-neon-green/20 text-neon-green border border-neon-green/40">
                  VYLOŽEN
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 ml-auto flex-wrap justify-end">
              <button
                type="button"
                data-testid="btn-hint"
                onClick={onHint}
                disabled={!humanTurn || state.turnPhase !== "action"}
                className="btn-arcade btn-blue px-2.5 py-2 text-[8px]"
              >
                RADCE
              </button>
              <button
                type="button"
                data-testid="btn-sort"
                onClick={onSort}
                disabled={!humanTurn}
                className="btn-arcade btn-ghost px-2.5 py-2 text-[8px]"
              >
                TŘÍDIT
              </button>
              <button
                type="button"
                data-testid="btn-lay"
                onClick={onLay}
                disabled={!humanTurn || state.turnPhase !== "action" || selected.length < 3}
                className="btn-arcade btn-green px-2.5 py-2 text-[8px]"
              >
                VYLOŽIT{selected.length > 0 ? ` (${selected.length})` : ""}
              </button>
              <button
                type="button"
                data-testid="btn-discard"
                onClick={onDiscard}
                disabled={!humanTurn || state.turnPhase !== "action" || selected.length !== 1}
                className="btn-arcade btn-primary px-2.5 py-2 text-[8px]"
              >
                ODHODIT
              </button>
            </div>
          </div>

          {/* hand — draggable on the human turn, static otherwise */}
          {humanTurn && state.phase === "play" ? (
            <Reorder.Group
              as="div"
              axis="x"
              values={human.hand}
              onReorder={(cards) => onReorderHand(cards.map((c) => c.id))}
              className="fan-hand flex justify-center mt-3 overflow-x-auto no-scrollbar pt-4 pb-2 px-1"
              data-testid="player-hand"
            >
              {human.hand.map((c, i) => {
                const isSel = selected.includes(c.id);
                return (
                  <Reorder.Item
                    as="div"
                    key={c.id}
                    value={c}
                    className="hand-draggable relative shrink-0"
                    style={{ zIndex: isSel ? 50 : i }}
                    whileDrag={{ scale: 1.12, zIndex: 100 }}
                    onDragStart={() => {
                      dragMoved.current = true;
                    }}
                    onDragEnd={() => {
                      window.setTimeout(() => {
                        dragMoved.current = false;
                      }, 0);
                    }}
                    title="Přetáhni pro změnu pořadí"
                  >
                    <PlayingCard
                      card={c}
                      prefix={prefix}
                      size="lg"
                      selected={isSel}
                      hoverable
                      lifted={isSel}
                      dealDelay={isNewRound ? Math.min(i * 0.04, 0.6) : 0}
                      zIndex={isSel ? 50 : i}
                      onClick={() => {
                        if (!dragMoved.current) onToggleCard(c.id);
                      }}
                    />
                  </Reorder.Item>
                );
              })}
              {human.hand.length === 0 && (
                <span className="font-pixel text-[8px] opacity-40 py-6">Ruka je prázdná…</span>
              )}
            </Reorder.Group>
          ) : (
            <div className="fan-hand flex justify-center mt-3 overflow-x-auto no-scrollbar pt-4 pb-2 px-1" data-testid="player-hand">
              {human.hand.map((c, i) => {
                const isSel = selected.includes(c.id);
                return (
                  <PlayingCard
                    key={c.id}
                    card={c}
                    prefix={prefix}
                    size="lg"
                    selected={isSel}
                    hoverable={false}
                    lifted={isSel}
                    dealDelay={isNewRound ? Math.min(i * 0.04, 0.6) : 0}
                    zIndex={isSel ? 50 : i}
                  />
                );
              })}
              {human.hand.length === 0 && (
                <span className="font-pixel text-[8px] opacity-40 py-6">Ruka je prázdná…</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
