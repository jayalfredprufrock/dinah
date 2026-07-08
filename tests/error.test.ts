import { describe, expect, test } from "vite-plus/test";
import { DinahError, isDinahError } from "../src";

describe("isDinahError", () => {
  test("recognizes a DinahError (and instanceof still works)", () => {
    const err = new DinahError({ type: "VALIDATION", message: "bad" });
    expect(isDinahError(err)).toBe(true);
    expect(err).toBeInstanceOf(DinahError);
    expect(err).toBeInstanceOf(Error);
  });

  test("rejects non-DinahErrors", () => {
    for (const notDinah of [new Error("x"), null, undefined, {}, "err", 42]) {
      expect(isDinahError(notDinah)).toBe(false);
    }
  });

  test("recognizes an error branded via the shared registered symbol", () => {
    // Simulates a DinahError thrown by a different copy of the library: different
    // class identity, same Symbol.for brand. `instanceof` would miss it.
    const fromOtherCopy = Object.assign(new Error("boom"), {
      [Symbol.for("dinah.error")]: true,
      details: { type: "NOT_FOUND", key: {} },
    });
    expect(isDinahError(fromOtherCopy)).toBe(true);
    expect(fromOtherCopy).not.toBeInstanceOf(DinahError);
  });

  test("brand does not leak into serialization", () => {
    const err = new DinahError({ type: "DATA_INTEGRITY", message: "x" });
    expect(Object.keys(err)).not.toContain("Symbol(dinah.error)");
    expect(JSON.stringify({ ...err })).not.toContain("dinah.error");
  });
});
