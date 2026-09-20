import { afterEach, describe, expect, it } from "vitest";
import { deviceHovers } from "../device";

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("deviceHovers", () => {
  it("is false without a window", () => {
    expect(deviceHovers()).toBe(false);
  });

  it("is false when matchMedia is missing", () => {
    (globalThis as { window?: unknown }).window = {};
    expect(deviceHovers()).toBe(false);
  });

  it("follows the hover media query", () => {
    (globalThis as { window?: unknown }).window = {
      matchMedia: (query: string) => ({ matches: query === "(hover: hover)" }),
    };
    expect(deviceHovers()).toBe(true);
  });

  it("is false on touch-only devices", () => {
    (globalThis as { window?: unknown }).window = {
      matchMedia: () => ({ matches: false }),
    };
    expect(deviceHovers()).toBe(false);
  });
});
