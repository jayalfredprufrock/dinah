import type { Db } from "./db";
import type { Table } from "./table";
import type { ExtractTableSchema } from "./types";

/** The item shape a seed produces — the full static type of the table's schema. */
export type SeedItem<T extends Table> = ExtractTableSchema<T>;

/**
 * Seed items, provided either as a static array or as a thunk. Use the thunk
 * form to reference other seeds (e.g. `() => [{ authorId: users.items[0].id }]`);
 * it is evaluated lazily and memoized, so cross-seed references stay cheap and
 * consistent.
 */
export type SeedInput<T extends Table> = SeedItem<T>[] | (() => SeedItem<T>[]);

// Tracks seeds whose items are currently being generated, so a reference cycle
// between lazy seeds fails with a clear error instead of a stack overflow.
const generating = new Set<Seed>();

export class Seed<T extends Table = Table> {
  readonly table: T;
  #input: SeedInput<T>;
  #cache: SeedItem<T>[] | undefined;

  constructor(table: T, input: SeedInput<T>) {
    this.table = table;
    this.#input = input;
  }

  /** The resolved items, generated once on first access and memoized. */
  get items(): SeedItem<T>[] {
    if (this.#cache) return this.#cache;

    if (typeof this.#input !== "function") {
      this.#cache = this.#input;
      return this.#cache;
    }

    if (generating.has(this)) {
      const chain = [...generating, this].map((s) => s.table.def.name).join(" → ");
      throw new Error(`Circular seed reference detected: ${chain}`);
    }

    generating.add(this);
    try {
      this.#cache = this.#input();
    } finally {
      generating.delete(this);
    }
    return this.#cache;
  }

  /** Write every item to its table via a batched `PUT` (overwrites by key). */
  async put(db: Db): Promise<void> {
    const repo = db.makeRepo(this.table);
    await repo.batchWrite(this.items.map((item) => ({ type: "PUT", item })) as never);
  }
}

/**
 * Define a set of items to seed into a table.
 *
 * ```ts
 * const users = createSeed(UserTable, [
 *   { id: "u1", name: "Alice", role: "admin" },
 *   { id: "u2", name: "Bob", role: "user" },
 * ]);
 *
 * // Reference another seed (lazy + memoized):
 * const posts = createSeed(PostTable, () => [
 *   { id: "p1", authorId: users.items[0].id, title: "Hello" },
 * ]);
 *
 * await users.put(db);
 * await posts.put(db);
 * ```
 */
export const createSeed = <T extends Table>(table: T, items: SeedInput<T>): Seed<T> =>
  new Seed(table, items);
