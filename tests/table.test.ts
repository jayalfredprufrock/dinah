import { Type } from "typebox";
import { describe, expect, test } from "vite-plus/test";
import { isTable, Table } from "../src";

const UserTable = new Table(Type.Object({ id: Type.String(), name: Type.String() }), {
  name: "users",
  partitionKey: "id",
});

describe("isTable", () => {
  test("recognizes a Table (and instanceof still works)", () => {
    expect(isTable(UserTable)).toBe(true);
    expect(UserTable).toBeInstanceOf(Table);
  });

  test("rejects non-tables", () => {
    for (const notTable of [null, undefined, {}, [], "table", 42, { def: {}, schema: {} }]) {
      expect(isTable(notTable)).toBe(false);
    }
  });

  test("recognizes a table branded via the shared registered symbol", () => {
    // Simulates a Table created by a different copy of the library: different
    // class identity, same Symbol.for brand. `instanceof` would miss it.
    const fromOtherCopy = {
      [Symbol.for("dinah.table")]: true,
      schema: UserTable.schema,
      def: UserTable.def,
    };
    expect(isTable(fromOtherCopy)).toBe(true);
    expect(fromOtherCopy).not.toBeInstanceOf(Table);
  });

  test("brand does not leak into serialization", () => {
    expect(Object.keys(UserTable)).toEqual(["schema", "def"]);
  });
});
