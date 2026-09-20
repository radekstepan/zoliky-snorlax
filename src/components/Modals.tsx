import { motion } from "framer-motion";
import { ReactNode } from "react";
import { Difficulty, GameState } from "../game/engine";
import { RULES } from "../game/core";

/* ------------------------------------------------------------------ */
/*  Shell                                                              */
/* ------------------------------------------------------------------ */

function ModalShell({
  children,
  wide,
  onClose,
}: {
  children: ReactNode;
  wide?: boolean;
  onClose?: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm overflow-y-auto"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.85, y: 24, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.9, y: 12, opacity: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 26 }}
        className={`panel w-full ${wide ? "max-w-2xl" : "max-w-md"} max-h-[88vh] overflow-y-auto pixel-scroll p-5 sm:p-6 relative`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

function SegButton({
  active,
  onClick,
  children,
  color = "pink",
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  color?: "pink" | "blue" | "gold" | "green";
}) {
  const glow =
    color === "pink"
      ? "border-neon-pink shadow-[0_0_14px_rgba(255,42,109,0.4)] text-[#ff8ab0]"
      : color === "blue"
        ? "border-neon-blue shadow-[0_0_14px_rgba(5,217,232,0.4)] text-[#8df4ff]"
        : color === "gold"
          ? "border-neon-gold shadow-[0_0_14px_rgba(255,211,25,0.4)] text-[#ffe27a]"
          : "border-neon-green shadow-[0_0_14px_rgba(61,245,133,0.4)] text-[#7cfcae]";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`font-pixel text-[9px] px-3 py-2.5 rounded-lg border-2 transition-all ${
        active ? `${glow} bg-white/10` : "border-white/15 bg-white/[0.03] opacity-60 hover:opacity-90"
      }`}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Start screen                                                       */
/* ------------------------------------------------------------------ */

export interface StartConfig {
  playerCount: number;
  difficulty: Difficulty;
  target: number;
}

const FLOATING_SUITS = ["♠", "♥", "♦", "♣", "Ž"];

export function StartScreen({
  config,
  setConfig,
  onStart,
  onShowRules,
}: {
  config: StartConfig;
  setConfig: (c: StartConfig) => void;
  onStart: () => void;
  onShowRules: () => void;
}) {
  return (
    <div className="h-full arcade-bg flex flex-col items-center justify-center relative overflow-hidden p-4" data-testid="start-screen">
      {/* floating suits */}
      {FLOATING_SUITS.map((s, i) => (
        <motion.span
          key={i}
          className="absolute font-pixel opacity-[0.07] select-none pointer-events-none"
          style={{
            left: `${8 + i * 19}%`,
            top: `${12 + ((i * 29) % 60)}%`,
            fontSize: 90 + i * 14,
            ["--r" as string]: `${(i % 2 ? -1 : 1) * (8 + i * 5)}deg`,
            color: i % 2 ? "#ff2a6d" : "#05d9e8",
          }}
          animate={{ y: [0, -18, 0] }}
          transition={{ duration: 5 + i, repeat: Infinity, ease: "easeInOut", delay: i * 0.7 }}
        >
          {s}
        </motion.span>
      ))}

      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 160, damping: 16 }}
        className="text-center mb-6"
      >
        <div className="font-pixel text-[40px] sm:text-[56px] leading-none neon-pink tracking-wider anim-pulse-glow">
          ŽOLÍKY
        </div>
        <div className="font-pixel text-[8px] sm:text-[10px] mt-3 neon-blue tracking-[0.3em]">
          ★ RETRO KARETNÍ KLASIKA ★
        </div>
      </motion.div>

      <motion.div
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.15 }}
        className="panel w-full max-w-md p-5 sm:p-6 space-y-5"
      >
        <div>
          <div className="panel-title mb-2">Počet hráčů</div>
          <div className="flex gap-2">
            {[2, 3, 4].map((n) => (
              <SegButton key={n} active={config.playerCount === n} onClick={() => setConfig({ ...config, playerCount: n })} color="blue">
                {n} HRÁČI
              </SegButton>
            ))}
          </div>
        </div>

        <div>
          <div className="panel-title mb-2">Obtížnost botů</div>
          <div className="flex gap-2">
            <SegButton active={config.difficulty === "easy"} onClick={() => setConfig({ ...config, difficulty: "easy" })} color="green">
              LEHKÁ
            </SegButton>
            <SegButton active={config.difficulty === "medium"} onClick={() => setConfig({ ...config, difficulty: "medium" })} color="gold">
              STŘEDNÍ
            </SegButton>
            <SegButton active={config.difficulty === "hard"} onClick={() => setConfig({ ...config, difficulty: "hard" })} color="pink">
              TĚŽKÁ
            </SegButton>
          </div>
        </div>

        <div>
          <div className="panel-title mb-2">Cíl hry (minusové body — přežij nad limitem)</div>
          <div className="flex gap-2">
            {[200, 300, 500].map((t) => (
              <SegButton key={t} active={config.target === t} onClick={() => setConfig({ ...config, target: t })} color="pink">
                {t}
              </SegButton>
            ))}
          </div>
        </div>

        <div className="pt-1 flex flex-col gap-2.5">
          <button type="button" onClick={onStart} data-testid="start-game" className="btn-arcade btn-primary py-4 text-[13px] w-full">
            ▶ HRÁT
          </button>
          <button type="button" onClick={onShowRules} data-testid="show-rules" className="btn-arcade btn-ghost py-3 text-[9px] w-full">
            PRAVIDLA HRY
          </button>
        </div>
      </motion.div>

      <div className="font-pixel text-[6.5px] opacity-40 mt-5 text-center leading-relaxed">
        2 BALÍČKY + 4 ŽOLÍCI · PRVNÍ VÝKLAD {RULES.FIRST_MELD_POINTS} BODŮ + ČISTÁ POSTUPKA · -1 BOD ZA KARTU
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Rules                                                              */
/* ------------------------------------------------------------------ */

function RuleSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-5">
      <h3 className="font-pixel text-[10px] neon-blue mb-2.5">▸ {title}</h3>
      <div className="text-term text-[16px] leading-snug text-[#cfc7f5] space-y-1.5">{children}</div>
    </section>
  );
}

export function RulesModal({ onClose }: { onClose: () => void }) {
  return (
    <ModalShell wide onClose={onClose}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-pixel text-[14px] neon-pink">PRAVIDLA ŽOLÍKŮ</h2>
        <button type="button" onClick={onClose} className="btn-arcade btn-ghost px-3 py-2 text-[9px]">
          ZAVŘÍT
        </button>
      </div>

      <RuleSection title="Cíl hry">
        <p>
          Cílem je zbavit se všech karet z ruky skládáním postupek, trojic a čtveřic.
          Kolo končí, když má hráč na konci tahu jedinou kartu a dramaticky ji odhodí{" "}
          <b>lícem dolů</b>. Ostatní pak dostanou <b>−1 bod za každou kartu v ruce</b>.
          Skóre jen klesá — hra končí, když někdo spadne pod cílovou hranici, a{" "}
          <b>vítězí hráč s nejvyšším (nejméně záporným) skóre</b>.
        </p>
      </RuleSection>

      <RuleSection title="Karty a rozdání">
        <p>
          Hraje se se <b>dvěma francouzskými balíčky</b> (2 × 52 karet) a <b>čtyřmi žolíky</b> —
          celkem 108 karet. Každý hráč dostane <b>12 karet</b>, předák (hráč po levici
          rozdávajícího) o jednu navíc a hru zahajuje odhozením karty.
        </p>
        <p>
          Hráč po pravici rozdávajícího snímá: koukne na <b>spodní 3 karty</b>, najde-li
          žolíka, nechá si ho (a dostane o kartu méně). Spodní karta balíčku se pak otočí{" "}
          <b>lícem nahoru pod balíček</b> — slouží jen pro Jolly Hand.
        </p>
      </RuleSection>

      <RuleSection title="Průběh tahu">
        <p>1. <b>Táhnutí</b> — kartu z balíčku, vrchní kartu z hromádky (musí se <b>hned vyložit</b>), nebo spodní kartu při Jolly Hand.</p>
        <p>2. <b>Vykládání</b> — až po {RULES.MELD_WAIT_ROUNDS}. kole: kombinace, přikládání, výměna žolíka.</p>
        <p>3. <b>Odhození</b> — tah končí odhozením jedné karty na hromádku.</p>
      </RuleSection>

      <RuleSection title="Kombinace">
        <p>
          <b>Postupka</b> — alespoň 3 po sobě jdoucí karty stejné barvy (např. ♥7, ♥8, ♥9).
          Eso může být nejnižší (A,2,3) i nejvyšší (Q,K,A), ale nikdy <b>„za rohem“</b> (K,A,2 neplatí).
        </p>
        <p>
          <b>Trojice / čtveřice</b> — 3 až 4 karty stejné hodnoty, každá jiné barvy.
        </p>
        <p>
          <b>Žolík</b> nahrazuje libovolnou kartu, ale kombinace s žolíkem není „čistá“.
          V kombinaci smí být žolíků méně než ostatních karet a <b>dva žolíci nesmí ležet vedle sebe</b>.
        </p>
      </RuleSection>

      <RuleSection title="První výklad — 36 bodů + čistá postupka">
        <p>
          Při prvním vyložení musí mít hráč kombinace v součtu alespoň{" "}
          <b>{RULES.FIRST_MELD_POINTS} bodů</b> a součástí musí být alespoň jedna{" "}
          <b>čistá postupka</b> (postupka bez žolíka). Body: 2–10 = hodnota karty,
          J/Q/K = 10, eso nízké (A,2,3) = <b>1 bod</b> (např. A♥,2♥,3♥ = 6 bodů),
          eso vysoké (Q,K,A) = 10, žolík = hodnota karty, kterou nahrazuje
          (např. 7♠,8♠,🃏,10♠,J♠ = 44 bodů).
        </p>
      </RuleSection>

      <RuleSection title="Přikládání a výměna žolíka">
        <p>
          Vyložený hráč může <b>přikládat</b> karty do kterékoliv kombinace na stole.
          Pokud v kombinaci leží žolík, může ho kterýkoliv hráč <b>vyměnit</b> za skutečnou
          kartu, kterou žolík zastupuje — ale vyměněného žolíka musí <b>v tom samém tahu využít</b>.
          Žolíka z trojice lze vzít, až když v ní budou <b>všechny 4 barvy</b>.
        </p>
      </RuleSection>

      <RuleSection title="Jolly Hand">
        <p>
          Kdo má v ruce stále <b>12 karet</b>, může si místo táhnutí vzít spodní kartu
          pod balíčkem — ale v tom tahu <b>musí vyložit všechny ostatní karty a poslední
          kartou kolo zavřít (odhodit ji)</b>.
          Ostatním se pak počítá <b>−2 body za každou kartu v ruce</b>. Vzácné, ale dramatické…
        </p>
      </RuleSection>

      <RuleSection title="Žolíci do příštího kola">
        <p>
          Žolíky v ruce na konci kola <b>nemusíš vykládat</b> — nepočítají se do bodů
          a schováš si je do příštího kola.
        </p>
      </RuleSection>

      <RuleSection title="Dojde-li balíček">
        <p>
          Hromádka se <b>bez míchání obrátí</b> a stane se novým balíčkem.
        </p>
      </RuleSection>

      <RuleSection title="Ovládání (proti botům)">
        <p>· Kliknutím kartu vybereš, dalším kliknutím výběr zrušíš.</p>
        <p>· <b>VYLOŽIT</b> — vyloží všechny vybrané karty jako kombinace.</p>
        <p>· S jednou vybranou kartou klikni na kombinaci na stole — přiložíš ji.</p>
        <p>· S vybranou kartou klikni na žolíka ve výkladu — vyměníš ho (a hned ho využij).</p>
        <p>· <b>ODHODIT</b> — odhodí vybranou kartu. <b>RADCE</b> ti navrhne kombinaci.</p>
        <p>· <b>JOLLY HAND</b> — vezme spodní kartu, když s ní jde vyložit celá ruka.</p>
      </RuleSection>
    </ModalShell>
  );
}

/* ------------------------------------------------------------------ */
/*  Round end                                                          */
/* ------------------------------------------------------------------ */

export function RoundEndModal({
  state,
  onNextRound,
}: {
  state: GameState;
  onNextRound: () => void;
}) {
  const info = state.roundEndInfo;
  if (!info) return null;
  const closer = info.closedBy >= 0 ? state.players[info.closedBy] : null;
  return (
    <ModalShell>
      <div className="text-center mb-4">
        <h2 className="font-pixel text-[15px] neon-gold">KOLO {state.round} KONČÍ</h2>
        <div className="font-pixel text-[9px] mt-3 text-[#cfc7f5]">
          {closer ? (
            <>
              <span className={closer.id === 0 ? "neon-green" : "neon-blue"}>{closer.name}</span>
              {" "}zavírá
              {info.jolly ? (
                <span className="neon-pink"> JOLLY HAND — DVOJNÁSOBNÉ BODY!</span>
              ) : (
                "!"
              )}
            </>
          ) : (
            "Karty došly — kolo končí bez zavření."
          )}
        </div>
      </div>

      <div className="space-y-1.5 mb-5">
        {[...state.players]
          .sort((a, b) => b.roundDelta - a.roundDelta)
          .map((p) => (
            <div
              key={p.id}
              className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${
                closer?.id === p.id
                  ? "border-neon-green/50 bg-neon-green/10"
                  : "border-white/10 bg-white/[0.03]"
              }`}
            >
              <span
                className="w-6 h-6 rounded flex items-center justify-center font-pixel text-[9px] shrink-0"
                style={{ background: `hsl(${p.hue} 70% 45%)` }}
              >
                {p.name[0]}
              </span>
              <span className="font-pixel text-[9px] flex-1 truncate">{p.name}</span>
              <span className="font-pixel text-[7px] opacity-60">{p.hand.length} karet v ruce</span>
              <span
                className={`font-pixel text-[11px] w-16 text-right ${
                  p.roundDelta < 0 ? "text-neon-pink" : "neon-green"
                }`}
              >
                {info.deltas.find((d) => d.id === p.id)?.doubled ? "2× " : ""}
                {p.roundDelta}
              </span>
              <span className="font-pixel text-[10px] neon-gold w-14 text-right">{p.score}</span>
            </div>
          ))}
      </div>

      <button type="button" onClick={onNextRound} className="btn-arcade btn-green py-3.5 text-[11px] w-full">
        DALŠÍ KOLO →
      </button>
    </ModalShell>
  );
}

/* ------------------------------------------------------------------ */
/*  Game end                                                           */
/* ------------------------------------------------------------------ */

export function GameEndModal({
  state,
  onRematch,
  onMenu,
}: {
  state: GameState;
  onRematch: () => void;
  onMenu: () => void;
}) {
  const winner = state.winner !== null ? state.players[state.winner] : null;
  const humanWon = winner?.id === 0;
  return (
    <ModalShell>
      <div className="text-center mb-5">
        <motion.div
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 200, damping: 12, delay: 0.1 }}
          className={`font-pixel text-[22px] sm:text-[26px] ${humanWon ? "neon-gold" : "neon-pink"}`}
        >
          {humanWon ? "★ VYHRÁL JSI ★" : `${winner?.name ?? "Nikdo"} VÍTĚZÍ`}
        </motion.div>
        <div className="font-pixel text-[8px] mt-3 opacity-60">
          {humanWon ? "Skvělá hra! Botové se klanějí." : "Zkus to znovu — pomsta bude sladká."}
        </div>
      </div>

      <div className="space-y-1.5 mb-5">
        {[...state.players]
          .sort((a, b) => b.score - a.score)
          .map((p, i) => (
            <div
              key={p.id}
              className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 ${
                i === 0 ? "border-neon-gold/60 bg-neon-gold/10" : "border-white/10 bg-white/[0.03]"
              }`}
            >
              <span className="font-pixel text-[10px] w-5 text-center opacity-70">{i + 1}.</span>
              <span
                className="w-6 h-6 rounded flex items-center justify-center font-pixel text-[9px] shrink-0"
                style={{ background: `hsl(${p.hue} 70% 45%)` }}
              >
                {p.name[0]}
              </span>
              <span className="font-pixel text-[9px] flex-1 truncate">{p.name}</span>
              <span className="font-pixel text-[7px] opacity-50">{p.closedRounds}× zavřel</span>
              <span className="font-pixel text-[12px] neon-gold">{p.score}</span>
            </div>
          ))}
      </div>

      <div className="flex flex-col gap-2.5">
        <button type="button" onClick={onRematch} className="btn-arcade btn-primary py-3.5 text-[11px] w-full">
          ▶ HRÁT ZNOVU
        </button>
        <button type="button" onClick={onMenu} className="btn-arcade btn-ghost py-3 text-[9px] w-full">
          ZPĚT DO MENU
        </button>
      </div>
    </ModalShell>
  );
}

/* ------------------------------------------------------------------ */
/*  Pause menu                                                         */
/* ------------------------------------------------------------------ */

export function PauseMenu({
  onResume,
  onRestart,
  onRules,
  onMenu,
}: {
  onResume: () => void;
  onRestart: () => void;
  onRules: () => void;
  onMenu: () => void;
}) {
  return (
    <ModalShell onClose={onResume}>
      <h2 className="font-pixel text-[15px] neon-pink mb-5 text-center">PAUZA</h2>
      <div className="flex flex-col gap-2.5">
        <button type="button" onClick={onResume} className="btn-arcade btn-green py-3.5 text-[11px] w-full">
          POKRAČOVAT
        </button>
        <button type="button" onClick={onRestart} className="btn-arcade btn-gold py-3 text-[10px] w-full">
          NOVÁ HRA
        </button>
        <button type="button" onClick={onRules} className="btn-arcade btn-blue py-3 text-[10px] w-full">
          PRAVIDLA
        </button>
        <button type="button" onClick={onMenu} className="btn-arcade btn-ghost py-3 text-[10px] w-full">
          ZPĚT DO MENU
        </button>
      </div>
    </ModalShell>
  );
}
