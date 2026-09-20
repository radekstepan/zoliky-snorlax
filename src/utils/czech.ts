/* ------------------------------------------------------------------ */
/*  Czech plural helpers (1 → one, 2–4 → few, else → many)              */
/* ------------------------------------------------------------------ */

/** Pick the right Czech word form for a count. Uses abs() so negative scores work. */
export function czWord(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n);
  if (a === 1) return one;
  if (a >= 2 && a <= 4) return few;
  return many;
}

/** Count + correctly declined word, e.g. "1 karta", "3 karty", "5 karet". */
export function czCount(n: number, one: string, few: string, many: string): string {
  return `${n} ${czWord(n, one, few, many)}`;
}

/** "1 karta" / "3 karty" / "5 karet" (hand sizes, nominative). */
export const kartyCount = (n: number): string => czCount(n, "karta", "karty", "karet");

/** "1 kombinace" / "3 kombinace" / "5 kombinací" (bare counts, nominative). */
export const kombinaceCount = (n: number): string =>
  czCount(n, "kombinace", "kombinace", "kombinací");

/** "vykládá 1 kombinaci" / "2 kombinace" / "5 kombinací" (accusative object). */
export const kombinaceAccCount = (n: number): string =>
  czCount(n, "kombinaci", "kombinace", "kombinací");

/** "1 bod" / "3 body" / "5 bodů". */
export const bodyCount = (n: number): string => czCount(n, "bod", "body", "bodů");
