import { describe, expect, test } from "vite-plus/test";
import { ExpressionBuilder, isOperation } from "../src/expression-builder";

describe("isOperation", () => {
  test("empty object is a value, not an operation", () => {
    expect(isOperation({})).toBe(false);
  });
});

describe("update with empty-object and falsy operands", () => {
  test.each([
    ["plain {}", { m: {} }, "SET #0 = :0 ", {}],
    ["$set {}", { m: { $set: {} } }, "SET #0 = :0 ", {}],
    ["$ifNotExists {}", { m: { $ifNotExists: {} } }, "SET #0 = if_not_exists(#0, :0) ", {}],
    ["$set 0", { m: { $set: 0 } }, "SET #0 = :0 ", 0],
    ["$set false", { m: { $set: false } }, "SET #0 = :0 ", false],
    ["$set empty string", { m: { $set: "" } }, "SET #0 = :0 ", ""],
    ["$ifNotExists 0", { m: { $ifNotExists: 0 } }, "SET #0 = if_not_exists(#0, :0) ", 0],
    [
      "$ifNotExists [path, false]",
      { m: { $ifNotExists: ["n", false] } },
      "SET #0 = if_not_exists(#1, :0) ",
      false,
    ],
  ])("%s", (_, expression, expected, value) => {
    const eb = new ExpressionBuilder();
    expect(eb.update(expression)).toBe(expected);
    expect(eb.attributeValues).toEqual({ ":0": value });
  });

  test("partiql $set {} and $set 0", () => {
    const eb = new ExpressionBuilder();
    expect(eb.partiqlUpdate({ m: { $set: {} }, n: { $set: 0 }, o: {} })).toEqual({
      sets: ['"m"=?', '"n"=?', '"o"=?'],
      removes: [],
      params: [{}, 0, {}],
    });
  });
});

describe("$literal", () => {
  test.each([
    ["top level", { m: { $literal: { $foo: 1 } } }, "SET #0 = :0 "],
    [
      "inside $ifNotExists",
      { m: { $ifNotExists: { $literal: { $foo: 1 } } } },
      "SET #0 = if_not_exists(#0, :0) ",
    ],
    ["inside $set", { m: { $set: { $literal: { $foo: 1 } } } }, "SET #0 = :0 "],
  ])("%s writes operator-shaped object as a value", (_, expression, expected) => {
    const eb = new ExpressionBuilder();
    expect(eb.update(expression)).toBe(expected);
    expect(eb.attributeValues).toEqual({ ":0": { $foo: 1 } });
  });

  test("escapes itself", () => {
    const eb = new ExpressionBuilder();
    eb.update({ m: { $literal: { $literal: 1 } } });
    expect(eb.attributeValues).toEqual({ ":0": { $literal: 1 } });
  });

  test("does not treat $remove as an operator", () => {
    const eb = new ExpressionBuilder();
    expect(eb.update({ m: { $literal: { $remove: true } } })).toBe("SET #0 = :0 ");
  });

  test("partiql", () => {
    const eb = new ExpressionBuilder();
    expect(eb.partiqlUpdate({ m: { $literal: { $foo: 1 } } })).toEqual({
      sets: ['"m"=?'],
      removes: [],
      params: [{ $foo: 1 }],
    });
  });
});

describe("equality conditions on non-scalar values", () => {
  test.each([
    ["map", { m: { $eq: { a: 1 } } }, "#0 = :0", { a: 1 }],
    ["list", { l: { $ne: [1, 2] } }, "#0 <> :0", [1, 2]],
    ["null", { n: { $eq: null } }, "#0 = :0", null],
    ["shorthand null", { n: null }, "#0 = :0", null],
    ["map with $-prefixed keys", { m: { $eq: { $x: 1 } } }, "#0 = :0", { $x: 1 }],
  ])("%s", (_, condition, expected, value) => {
    const eb = new ExpressionBuilder();
    expect(eb.condition(condition)).toBe(expected);
    expect(eb.attributeValues).toEqual({ ":0": value });
  });

  test("$eq undefined still throws", () => {
    expect(() => new ExpressionBuilder().condition({ m: { $eq: undefined } })).toThrow();
  });

  test("ordering comparators still require scalars", () => {
    expect(() => new ExpressionBuilder().condition({ m: { $gt: { a: 1 } } })).toThrow();
  });
});
