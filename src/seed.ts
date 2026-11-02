import type { Db } from "./db";
import type { DbBatchOptions } from "./db.types";
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

// Requests in flight for a seed. Past ~5 the gain flattens out, and DynamoDB
// Local (where seeds usually land) serializes writes anyway.
const SEED_PARALLEL = 5;

// Tracks seeds whose items are currently being generated, so a reference cycle
// between lazy seeds fails with a clear error instead of a stack overflow.
const generating = new Set<Seed>();

// A registered-symbol brand for identifying seeds. Unlike `instanceof`, this is
// stable across module copies (dual CJS/ESM builds, multiple installed versions,
// bundled CLIs), so `isSeed` reliably recognizes seeds loaded dynamically — e.g.
// a CLI globbing and importing seed files. See `isSeed`.
const SEED_BRAND: unique symbol = Symbol.for("dinah.seed");

export class Seed<T extends Table = Table> {
  // Symbol-keyed, so it never shows up in `Object.keys` / `JSON.stringify`.
  readonly [SEED_BRAND] = true;
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

  /**
   * Write every item to its table via a batched `PUT` (overwrites by key).
   *
   * Throws a `BATCH_UNPROCESSED` `DinahError` if the table could not accept
   * every item. A seed that silently wrote only part of its data is worse than
   * one that fails, since everything downstream assumes it completed.
   */
  async put(db: Db, options?: DbBatchOptions): Promise<void> {
    const repo = db.makeRepo(this.table);
    await repo.batchWriteOrThrow(this.items.map((item) => ({ type: "PUT", item })) as never, {
      // Batch writes are serial by default because the library can't know
      // whether something above it is already running many of them at once.
      // Seeding can: it's a single process, off the request path, and usually
      // the only thing touching the table.
      parallel: SEED_PARALLEL,
      ...options,
    });
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
// NoInfer: infer the table type from `table` only. Inferring it back through the items
// (or from a contextual return type) means relating typebox's Static over an unresolved
// type parameter, which costs ~1M type instantiations per call site.
export const createSeed = <T extends Table>(
  table: T,
  items: NoInfer<SeedInput<T>>,
): NoInfer<Seed<T>> => new Seed(table, items);

/**
 * Type guard identifying a {@link Seed}. Prefer this over `instanceof Seed` when
 * seeds may cross module boundaries — e.g. a CLI that globs and dynamically
 * imports seed files — since it recognizes seeds from any copy of the library:
 *
 * ```ts
 * const mod = await import(file);
 * const seeds = Object.values(mod).filter(isSeed);
 * for (const seed of seeds) await seed.put(db);
 * ```
 */
export const isSeed = (value: unknown): value is Seed =>
  typeof value === "object" &&
  value !== null &&
  (value as { [SEED_BRAND]?: unknown })[SEED_BRAND] === true;
