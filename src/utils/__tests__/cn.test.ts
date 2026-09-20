import { describe, expect, it } from "vitest";
import { cn } from "../cn";

describe("cn", () => {
  it("joins class names and drops falsy inputs", () => {
    expect(cn("a", "b")).toBe("a b");
    expect(cn("a", false, null, undefined, "b")).toBe("a b");
  });

  it("merges conflicting tailwind classes, last wins", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
  });
});
