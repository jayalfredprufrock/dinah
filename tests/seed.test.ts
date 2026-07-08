import { Type } from "typebox";
import { describe, expect, test, vi } from "vite-plus/test";
import type { Db } from "../src";
import { Table } from "../src";
import { createSeed, isSeed, Seed } from "../src/seed";

const UserTable = new Table(
  Type.Object({ id: Type.String(), name: Type.String(), role: Type.String() }),
  { name: "users", partitionKey: "id" },
);

const PostTable = new Table(
  Type.Object({ id: Type.String(), authorId: Type.String(), title: Type.String() }),
  { name: "posts", partitionKey: "id" },
);

describe("createSeed", () => {
  test("array input is exposed via .items", () => {
    const users = createSeed(UserTable, [
      { id: "u1", name: "Alice", role: "admin" },
      { id: "u2", name: "Bob", role: "user" },
    ]);
    expect(users.items).toHaveLength(2);
    expect(users.items[0]).toEqual({ id: "u1", name: "Alice", role: "admin" });
    // memoized: same reference across accesses
    expect(users.items).toBe(users.items);
  });

  test("thunk input is evaluated lazily and memoized (runs once)", () => {
    const build = vi.fn(() => [{ id: "u1", name: "Alice", role: "admin" }]);
    const users = createSeed(UserTable, build);
    expect(build).not.toHaveBeenCalled(); // lazy
    void users.items;
    void users.items;
    void users.items;
    expect(build).toHaveBeenCalledTimes(1); // memoized
  });

  test("a seed can reference another seed's items", () => {
    const users = createSeed(UserTable, [
      { id: "u1", name: "Alice", role: "admin" },
      { id: "u2", name: "Bob", role: "user" },
    ]);
    const posts = createSeed(PostTable, () => [
      { id: "p1", authorId: users.items[0]!.id, title: "Hello" },
      { id: "p2", authorId: users.items[1]!.id, title: "World" },
    ]);
    expect(posts.items.map((p) => p.authorId)).toEqual(["u1", "u2"]);
  });

  test("detects a circular reference between seeds", () => {
    const a: { items: unknown[] } = createSeed(UserTable, () => [
      { id: "u1", name: (b.items[0] as { title: string }).title, role: "user" },
    ]);
    const b: { items: unknown[] } = createSeed(PostTable, () => [
      { id: "p1", authorId: (a.items[0] as { id: string }).id, title: "t" },
    ]);
    expect(() => a.items).toThrow(/Circular seed reference detected: users → posts → users/);
  });

  test("detects a self-referential cycle", () => {
    const s: { items: unknown[] } = createSeed(UserTable, () => [
      { id: (s.items[0] as { id: string }).id, name: "x", role: "user" },
    ]);
    expect(() => s.items).toThrow(/Circular seed reference detected: users → users/);
  });

  test("is identifiable via isSeed and instanceof Seed", () => {
    const users = createSeed(UserTable, [{ id: "u1", name: "Alice", role: "admin" }]);
    expect(isSeed(users)).toBe(true);
    expect(users).toBeInstanceOf(Seed);

    for (const notASeed of [null, undefined, {}, [], "seed", 42, UserTable]) {
      expect(isSeed(notASeed)).toBe(false);
    }
  });

  test("isSeed recognizes a seed branded via the shared registered symbol", () => {
    // Simulates a seed created by a different copy of the library (dual CJS/ESM
    // build, separate install): different class identity, same Symbol.for brand.
    const fromOtherCopy = { [Symbol.for("dinah.seed")]: true, table: UserTable, items: [] };
    expect(isSeed(fromOtherCopy)).toBe(true);
    expect(fromOtherCopy).not.toBeInstanceOf(Seed); // instanceof would miss it
  });

  test(".put writes every item as a PUT batch request to the table's repo", async () => {
    const batchWrite = vi.fn(async () => ({ items: [] }));
    const makeRepo = vi.fn(() => ({ batchWrite }));
    const db = { makeRepo } as unknown as Db;

    const users = createSeed(UserTable, [
      { id: "u1", name: "Alice", role: "admin" },
      { id: "u2", name: "Bob", role: "user" },
    ]);
    await users.put(db);

    expect(makeRepo).toHaveBeenCalledWith(UserTable);
    expect(batchWrite).toHaveBeenCalledWith([
      { type: "PUT", item: { id: "u1", name: "Alice", role: "admin" } },
      { type: "PUT", item: { id: "u2", name: "Bob", role: "user" } },
    ]);
  });
});
