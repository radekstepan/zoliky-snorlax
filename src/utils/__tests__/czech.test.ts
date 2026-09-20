import { describe, expect, it } from "vitest";
import { bodyCount, czWord, kartyCount, kombinaceAccCount, kombinaceCount } from "../czech";

describe("czWord", () => {
  it("uses one / few / many forms", () => {
    expect(czWord(1, "a", "b", "c")).toBe("a");
    expect(czWord(2, "a", "b", "c")).toBe("b");
    expect(czWord(4, "a", "b", "c")).toBe("b");
    expect(czWord(0, "a", "b", "c")).toBe("c");
    expect(czWord(5, "a", "b", "c")).toBe("c");
  });

  it("uses abs() so negative scores decline correctly", () => {
    expect(czWord(-1, "a", "b", "c")).toBe("a");
    expect(czWord(-3, "a", "b", "c")).toBe("b");
    expect(czWord(-7, "a", "b", "c")).toBe("c");
  });
});

describe("czCount", () => {
  it("declines karty / kombinace / body", () => {
    expect(kartyCount(1)).toBe("1 karta");
    expect(kartyCount(3)).toBe("3 karty");
    expect(kartyCount(5)).toBe("5 karet");
    expect(kartyCount(0)).toBe("0 karet");
    expect(kombinaceCount(1)).toBe("1 kombinace");
    expect(kombinaceCount(3)).toBe("3 kombinace");
    expect(kombinaceCount(7)).toBe("7 kombinací");
    expect(kombinaceAccCount(1)).toBe("1 kombinaci");
    expect(kombinaceAccCount(2)).toBe("2 kombinace");
    expect(kombinaceAccCount(5)).toBe("5 kombinací");
    expect(bodyCount(1)).toBe("1 bod");
    expect(bodyCount(3)).toBe("3 body");
    expect(bodyCount(36)).toBe("36 bodů");
  });
});
