import { motion } from "framer-motion";
import { CSSProperties, MouseEvent as ReactMouseEvent, useMemo, useState } from "react";
import {
  Card,
  Suit,
  SUIT_SYMBOL,
  RED_SUITS,
  rankLabel,
  ACE,
} from "../game/core";

export type CardSize = "lg" | "md" | "sm" | "xs";

export interface CardSizeSpec {
  w: string;
  corner: number;
  center: number;
  badge: number;
  radius: number;
}

export const CARD_SIZES: Record<CardSize, CardSizeSpec> = {
  lg: { w: "clamp(52px, 9.5vw, 72px)", corner: 11, center: 26, badge: 8, radius: 9 },
  md: { w: "clamp(38px, 7vw, 54px)", corner: 9, center: 20, badge: 7, radius: 7 },
  sm: { w: "clamp(30px, 5.4vw, 42px)", corner: 7, center: 15, badge: 6, radius: 6 },
  xs: { w: "clamp(20px, 3.8vw, 28px)", corner: 6, center: 11, badge: 5, radius: 5 },
};

interface PlayingCardProps {
  card: Card;
  size?: CardSize;
  selected?: boolean;
  faceDown?: boolean;
  hoverable?: boolean;
  /** lift on hover; disable where hover can't end (touch) so tapped cards don't stick up */
  hoverLift?: boolean;
  dimmed?: boolean;
  target?: boolean;
  lifted?: boolean;
  dealDelay?: number;
  zIndex?: number;
  /** when this card is a joker standing in for another card */
  asRank?: number;
  asSuit?: Suit;
  /** scopes layoutId so cards from previous rounds don't hijack animations */
  prefix?: string;
  /** render without any entrance/layout animation (e.g. static previews) */
  noAnim?: boolean;
  onClick?: (e: ReactMouseEvent<HTMLDivElement>) => void;
  className?: string;
  style?: CSSProperties;
}

export default function PlayingCard({
  card,
  size = "lg",
  selected,
  faceDown,
  hoverable,
  hoverLift = true,
  dimmed,
  target,
  lifted,
  dealDelay = 0,
  zIndex,
  asRank,
  asSuit,
  prefix = "",
  noAnim = false,
  onClick,
  className = "",
  style,
}: PlayingCardProps) {
  const spec = CARD_SIZES[size];
  // Hovered card jumps above everything (incl. selected cards at z 50)
  // so it stays fully visible in the overlapping fan.
  const [hovered, setHovered] = useState(false);
  const front = hoverable && hovered;

  const wrapperStyle: CSSProperties = useMemo(
    () => ({
      width: spec.w,
      aspectRatio: "5 / 7",
      zIndex: front ? 100 : zIndex,
      ...style,
    }),
    [spec.w, zIndex, front, style]
  );

  const isReplacedJoker = card.joker && asRank !== undefined;
  const showRank = isReplacedJoker ? asRank! : card.rank;
  const showSuit: Suit | undefined = isReplacedJoker ? asSuit : card.suit;
  const red = showSuit ? RED_SUITS.includes(showSuit) : false;

  const cornerContent =
    card.joker && !isReplacedJoker ? (
      <span className="leading-none select-none font-pixel" style={{ fontSize: spec.corner - 1 }}>
        Ž
      </span>
    ) : (
      <div className="flex flex-col items-center leading-none select-none">
        <span style={{ fontSize: spec.corner, fontWeight: 700 }}>
          {rankLabel(showRank)}
        </span>
        {showSuit && (
          <span style={{ fontSize: spec.corner - 1, lineHeight: 1 }}>
            {SUIT_SYMBOL[showSuit]}
          </span>
        )}
      </div>
    );

  return (
    <motion.div
      layout={!noAnim}
      layoutId={noAnim ? undefined : `${prefix}card-${card.id}`}
      initial={noAnim ? false : { y: -140, opacity: 0, rotate: -12, scale: 0.6 }}
      animate={{ y: lifted ? -16 : 0, opacity: dimmed ? 0.45 : 1, rotate: 0, scale: 1 }}
      exit={noAnim ? undefined : { opacity: 0, scale: 0.5 }}
      transition={{
        type: "spring",
        stiffness: 320,
        damping: 28,
        delay: dealDelay,
        mass: 0.9,
      }}
      style={wrapperStyle}
      className={[
        "relative shrink-0",
        faceDown
          ? "card-back"
          : isReplacedJoker
            ? "playing-card joker-card"
            : `playing-card ${red ? "red-suit" : ""}`,
        selected ? "card-selected" : "",
        isReplacedJoker ? "joker-placed" : "",
        hoverable ? "card-hoverable" : "",
        target ? "card-layoff-target" : "",
        className,
      ].join(" ")}
      onClick={onClick}
      onHoverStart={hoverLift ? () => setHovered(true) : undefined}
      onHoverEnd={hoverLift ? () => setHovered(false) : undefined}
      whileHover={!noAnim && hoverable && hoverLift ? { y: -14, scale: 1.03 } : undefined}
      whileTap={!noAnim && onClick ? { scale: 0.95 } : undefined}
    >
      {faceDown ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            className="font-pixel opacity-70"
            style={{ fontSize: spec.center, textShadow: "0 0 8px rgba(181,55,242,0.9)" }}
          >
            Ž
          </span>
        </div>
      ) : (
        <div className="absolute inset-0 p-[8%] flex flex-col justify-between">
          <div className="flex items-start justify-between">
            {cornerContent}
          </div>
          <div className="flex-1 flex items-center justify-center relative">
            {card.joker && !isReplacedJoker ? (
              <div className="flex flex-col items-center">
                <span
                  className="font-pixel"
                  style={{ fontSize: spec.center, textShadow: "0 0 10px rgba(0,0,0,0.45)" }}
                >
                  Ž
                </span>
                <span
                  className="font-pixel opacity-90"
                  style={{ fontSize: spec.badge, marginTop: 2 }}
                >
                  ŽOLÍK
                </span>
              </div>
            ) : (
              <span
                style={{ fontSize: spec.center, lineHeight: 1 }}
                className={isReplacedJoker ? "drop-shadow-[0_0_6px_rgba(0,0,0,0.5)]" : ""}
              >
                {showSuit ? SUIT_SYMBOL[showSuit] : "★"}
              </span>
            )}
            {isReplacedJoker && (
              <span
                className="absolute top-0 right-0 font-pixel bg-black/40 rounded-sm px-[2px]"
                style={{ fontSize: spec.badge - 1, lineHeight: 1.3 }}
              >
                Ž
              </span>
            )}
          </div>
          <div className="flex items-end justify-between" style={{ transform: "rotate(180deg)" }}>
            {cornerContent}
          </div>
        </div>
      )}
    </motion.div>
  );
}

export { ACE };
