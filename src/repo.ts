import type { Db } from "./db";
import type { Table } from "./table";
import type { DbBatchOptions, DbTrxGetRequest, DbTrxWriteRequest } from "./db.types";
import type {
  GsiNames,
  RepoBatchGetOptions,
  RepoBatchGetOrThrowResult,
  RepoBatchGetResult,
  RepoBatchUpdateResult,
  RepoBatchWrite,
  RepoBatchWriteResult,
  RepoCreateItem,
  RepoCreateResult,
  RepoDeleteOptions,
  RepoDeleteOrThrowResult,
  RepoExistsOptions,
  RepoGetGsiOptions,
  RepoGetGsiOrThrowResult,
  RepoGetOptions,
  RepoGetOrThrowResult,
  RepoKey,
  RepoPatchFn,
  RepoPatchInput,
  RepoPatchOptions,
  RepoPutOptions,
  RepoPutItem,
  RepoPutResult,
  RepoQueryGsiOptions,
  RepoQueryGsiPagedResult,
  RepoQueryGsiResult,
  RepoQueryOptions,
  RepoQueryPagedResult,
  RepoQueryResult,
  RepoScanGsiOptions,
  RepoScanGsiPagedResult,
  RepoScanGsiResult,
  RepoScanOptions,
  RepoScanPagedResult,
  RepoScanResult,
  RepoTrxGetOptions,
  RepoTrxGetOrThrowResult,
  RepoTrxGetResult,
  RepoTrxWriteRequest,
  RepoUpdateInput,
  RepoUpdateInputFor,
  RepoUpdateOptions,
  RepoUpdateResult,
  RepoQueryGsiQuery,
  RepoQueryQuery,
  StrictOptions,
} from "./repo.types";
import type {
  AllKeys,
  Condition,
  ExtractTableDef,
  ExtractTableDiscriminator,
  ExtractTableSchema,
  Obj,
} from "./types";
import { isOperation } from "./expression-builder";
import { DinahError } from "./error";
import { batchBackoffDelay } from "./batch";
import { deepEqual, discriminatorOf, matchesPartial } from "./util";

const DEFAULT_PATCH_MAX_ATTEMPTS = 5;

// TODO: query/queryGsi needs strongly typed "key" argument
// allows =,>,>=,<,<=,begins_with, between on sort key
// util -> extractExclusiveStartKey(item)

// Minimal structural interface used as the constraint in repo.types.ts.
// Keeps type helper constraints simple (R extends RepoBase) while the full
// Repo class retains separate generic params for inference quality.
export interface RepoBase {
  readonly $schema: object;
  readonly $def: { readonly partitionKey: string; readonly sortKey?: string };
  readonly $computedAttributes: PropertyKey;
  readonly $immutableAttributes: PropertyKey;
  readonly $discriminator: PropertyKey;
  readonly table: Table;
  readonly defaultCreateData: object;
  readonly defaultUpdateData: object;
  transformOutput(item: never): unknown;
}

export type ComputedFieldDef<TSchema extends object, K extends keyof TSchema> =
  | { [J in keyof TSchema]: { from: J; compute: (val: TSchema[J]) => TSchema[K] } }[keyof TSchema]
  | { from: readonly (keyof TSchema)[]; compute: (...vals: any[]) => TSchema[K] };

// Recursively maps a tuple of schema keys to a tuple of their value types.
type ComputeArgs<
  TSchema extends object,
  Js extends readonly (keyof TSchema)[],
> = Js extends readonly [
  infer Head extends keyof TSchema,
  ...infer Tail extends readonly (keyof TSchema)[],
]
  ? [TSchema[Head], ...ComputeArgs<TSchema, Tail>]
  : [];

// Post-inference constraint. Maps each computed attribute key to its expected shape so
// TypeScript's structural assignability check enforces correct param and return types.
// Catching too-narrow param annotations (missing | undefined) and too-broad return types
// falls out of normal contravariant/covariant function subtype checking automatically.
export type ValidComputedMap<TSchema extends object, TComputed> = {
  [K in keyof TComputed]?: K extends keyof TSchema
    ? TComputed[K] extends { from: infer Js extends readonly (keyof TSchema)[]; compute: any }
      ? { from: Js; compute: (...vals: ComputeArgs<TSchema, Js>) => TSchema[K] }
      : TComputed[K] extends { from: infer J extends keyof TSchema; compute: any }
        ? { from: J; compute: (val: TSchema[J]) => TSchema[K] }
        : never
    : never;
};

export interface RepoConfig<
  TSchema extends object,
  TDefaults extends Partial<TSchema> = {},
  TUpdateDefaults extends Partial<TSchema> = {},
  TOutput = TSchema,
  TComputed extends ValidComputedMap<TSchema, TComputed> = {},
  TImmutable extends AllKeys<TSchema> = never,
> {
  resourceName?: string;
  defaultCreateData?: () => TDefaults;
  defaultUpdateData?: () => TUpdateDefaults;
  transformAttributes?: { [K in keyof TSchema]?: (val: TSchema[K]) => TSchema[K] };
  computedAttributes?: TComputed & { [K in keyof TSchema]?: ComputedFieldDef<TSchema, K> };
  // NoInfer: infer the table type from `table` only. Inferring it back through this
  // (context-sensitive) callback means relating typebox's Static over an unresolved
  // type parameter, which costs ~1M type instantiations per repo.
  transformOutput?: (item: NoInfer<TSchema>) => TOutput;
  immutableAttributes?: readonly TImmutable[];
}

// Concrete reconstruction of this repo's `RepoBase` shape, derived from the
// class type parameters rather than from `this`. It mirrors the phantom `$*`
// declarations below. This exists to feed the `Self` type parameter (see the
// `Repo` class): the helper types in repo.types.ts do indexed-access and
// conditional lookups (R["$schema"], R["table"]["def"], GsiProjectionType<R>,
// NarrowByDiscriminator<..., R["$discriminator"]>, ...). Those reduce only when
// their `R` is bound to concrete types. `this` is a polymorphic type parameter,
// and TypeScript defers indexed access on a type parameter, so `this`-based
// helpers never reduce inside a (sub)class method body — even though they do
// reduce at an external call site where `this` binds to the concrete receiver.
// The ordinary class params (T, TImmutable, ...) ARE bound to concrete
// types through a subclass's heritage clause, so a `Self` rebuilt from them
// reduces everywhere, including inside subclass methods like
// `class LogRepo extends makeRepo(t) { m() { this.queryGsi(...) } }`.
type RepoSelf<
  T extends Table,
  TDefaults extends object,
  TUpdateDefaults extends object,
  TOutput,
  TComputed,
  TImmutable extends PropertyKey,
> = {
  readonly $schema: ExtractTableSchema<T>;
  readonly $def: ExtractTableDef<T>;
  readonly $computedAttributes: keyof TComputed;
  readonly $immutableAttributes: TImmutable;
  readonly $discriminator: ExtractTableDiscriminator<T>;
  readonly table: T;
  readonly defaultCreateData: TDefaults;
  readonly defaultUpdateData: TUpdateDefaults;
  // Mirrors the class method's real signature. The param must NOT be `never`
  // (as in the RepoBase constraint): `ReturnType<(x: never) => R>` resolves to
  // `any`, which would poison RepoOutput<Self> and every result type built on it.
  transformOutput(item: ExtractTableSchema<T>): TOutput;
};

export class Repo<
  T extends Table,
  TDefaults extends Partial<ExtractTableSchema<T>> = {},
  TUpdateDefaults extends Partial<ExtractTableSchema<T>> = {},
  TOutput = ExtractTableSchema<T>,
  TComputed extends ValidComputedMap<ExtractTableSchema<T>, TComputed> = {},
  TImmutable extends AllKeys<ExtractTableSchema<T>> = never,
  // Synthetic, never passed explicitly. Bound to its default at every use site;
  // because the default is built from the params above (concrete in a subclass
  // heritage clause), method signatures written against `Self` reduce inside
  // subclass method bodies where `this`-based ones do not. See RepoSelf above.
  Self extends RepoBase = RepoSelf<T, TDefaults, TUpdateDefaults, TOutput, TComputed, TImmutable>,
> {
  // Concrete self-type (the `Self` reconstruction) exposed as a phantom so it
  // can be named when authoring an override. Base method signatures are written
  // against `Self`, which a subclass cannot name via `this` (and `this` would
  // not reduce inside a method body anyway). To override a generic base method,
  // write its signature against `<BaseRepoType>["$self"]`, e.g.:
  //   class LogRepo extends makeRepo(logTable) {
  //     override async get<const O extends RepoGetOptions<Repo<typeof logTable>["$self"]>>(
  //       key: RepoKey<Repo<typeof logTable>["$self"]>,
  //       options?: O & StrictOptions<O, RepoGetOptions<Repo<typeof logTable>["$self"]>, Repo<typeof logTable>["$self"]["$schema"]>,
  //     ): Promise<RepoGetResult<Repo<typeof logTable>["$self"], O>> {
  //       return super.get<O>(key, options);
  //     }
  //   }
  declare readonly $self: Self;

  // these phantom properties are used to pre-compute types derived from T
  // which allows easy lookups using the "this" Repo type
  declare readonly $schema: ExtractTableSchema<T>;
  declare readonly $def: ExtractTableDef<T>;
  declare readonly $computedAttributes: keyof TComputed;
  declare readonly $immutableAttributes: TImmutable;
  declare readonly $discriminator: ExtractTableDiscriminator<T>;

  readonly table: T;
  readonly db: Db;
  private readonly config: RepoConfig<
    ExtractTableSchema<T>,
    TDefaults,
    TUpdateDefaults,
    TOutput,
    TComputed,
    TImmutable
  >;

  constructor(
    db: Db,
    table: T,
    config?: RepoConfig<
      ExtractTableSchema<T>,
      TDefaults,
      TUpdateDefaults,
      TOutput,
      TComputed,
      TImmutable
    >,
  ) {
    this.db = db;
    this.table = table;
    this.config = config ?? {};
  }

  get tableName(): string {
    return `${this.db.config?.tableNamePrefix ?? ""}${this.table.def.name}`;
  }

  get resourceName(): string {
    if (this.config.resourceName) return this.config.resourceName;
    const clsName = this.constructor.name;
    if (clsName && clsName !== "Repo") {
      return clsName.replace(/Repo$/i, "") || clsName;
    }
    const t = this.table.def.name;
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  get defaultCreateData(): TDefaults {
    return (this.config.defaultCreateData?.() ?? {}) as TDefaults;
  }

  get defaultUpdateData(): TUpdateDefaults {
    return (this.config.defaultUpdateData?.() ?? {}) as TUpdateDefaults;
  }

  transformOutput(item: ExtractTableSchema<T>): TOutput {
    return (this.config.transformOutput?.(item) ?? item) as TOutput;
  }

  // TODO: should this throw if pk is missing?
  // should return type by narrower?
  extractKey(item: RepoKey<Self>): RepoKey<Self> {
    const { partitionKey, sortKey } = this.table.def;
    if (sortKey) {
      return {
        [partitionKey]: item[partitionKey as keyof RepoKey<Self>],
        [sortKey]: item[sortKey as keyof RepoKey<Self>],
      } as RepoKey<Self>;
    }

    return { [partitionKey]: item[partitionKey as keyof RepoKey<Self>] } as RepoKey<Self>;
  }

  async get<const O extends RepoGetOptions<Self>>(
    key: RepoKey<Self>,
    options?: O & StrictOptions<O, RepoGetOptions<Self>, Self["$schema"]>,
  ): Promise<RepoGetOrThrowResult<Self, O> | undefined> {
    const { filter, ...restOptions } = (options ?? {}) as RepoGetOptions<Self>;
    const item = await this.db.get({
      table: this.tableName,
      key: this.extractKey(key),
      filter,
      ...restOptions,
    } as any);
    return (item && this.applyTransformIfNeeded(item, options)) as any;
  }

  async getOrThrow<const O extends RepoGetOptions<Self>>(
    key: RepoKey<Self>,
    options?: O & StrictOptions<O, RepoGetOptions<Self>, Self["$schema"]>,
  ): Promise<RepoGetOrThrowResult<Self, O>> {
    const { filter, ...restOptions } = (options ?? {}) as RepoGetOptions<Self>;
    const item = await this.db.getOrThrow({
      table: this.tableName,
      key: this.extractKey(key),
      resource: this.resourceName,
      filter,
      ...restOptions,
    } as any);
    return this.applyTransformIfNeeded(item, options) as any;
  }

  async put<const T extends RepoPutItem<Self>>(
    item: T,
    options?: RepoPutOptions<Self>,
  ): Promise<RepoPutResult<Self, T>> {
    const result = await this.db.put({
      table: this.tableName,
      item: item as any,
      resource: this.resourceName,
      ...options,
    });
    return this.applyTransformIfNeeded(result) as any;
  }

  async update<const K extends RepoKey<Self>>(
    key: K,
    update: RepoUpdateInputFor<Self, K>,
    options?: RepoUpdateOptions<Self>,
  ): Promise<RepoUpdateResult<Self>> {
    const updateWithDefaults = this.applyNormalizersToExpression(update as Obj);
    const result = await this.db.update({
      table: this.tableName,
      key: this.extractKey(key),
      resource: this.resourceName,
      update: updateWithDefaults as any,
      ...options,
      condition: this.withDiscriminatorCondition(key, options?.condition),
    });
    return this.applyTransformIfNeeded(result);
  }

  async create<const T extends RepoCreateItem<Self>>(item: T): Promise<RepoCreateResult<Self, T>> {
    const condition = { $and: [{ [this.table.def.partitionKey]: { $exists: false } }] } as any;

    const normalizedItem = this.applyCreateTransforms(item as Obj);

    let result: Obj;
    try {
      result = await this.db.put({
        table: this.tableName,
        item: normalizedItem,
        resource: this.resourceName,
        condition,
      });
    } catch (err) {
      // The only condition `create` applies is the `<pk> not exists` guard, so a
      // conditional check failure means an item with this key already exists.
      if (err instanceof DinahError && err.details.type === "CONDITIONAL_CHECK_FAILED") {
        throw new DinahError(
          {
            type: "ALREADY_EXISTS",
            key: this.extractKey(item as unknown as RepoKey<Self>) as Record<string, unknown>,
            resource: this.resourceName,
          },
          { cause: err },
        );
      }
      throw err;
    }
    return this.applyTransformIfNeeded(result) as any;
  }

  /**
   * Read-modify-write that only writes what changed. Reads the item
   * (consistently), applies `patch` — an object, or a function of the current
   * item — and diffs the result against what's stored. Changed fields are
   * SET, fields patched to `undefined` are REMOVEd, everything else is left
   * alone, so concurrent writes to other fields (e.g. `$add` counters) are
   * never clobbered. The write is conditioned on every written field still
   * holding the value that was read; on a conflict the read, patch and diff
   * are repeated, up to `maxAttempts` times.
   *
   * When nothing changed, no write happens (so `defaultUpdateData` isn't
   * applied) and the current item is returned. A patch function must be pure,
   * since it can run more than once. Throws `NOT_FOUND` if the item doesn't
   * exist — see {@link createOrPatch}.
   *
   * Prefer `update` when the change doesn't depend on the stored item: it's a
   * single round trip and its operators are atomic under contention.
   */
  async patch<const K extends RepoKey<Self>>(
    key: K,
    patch: RepoPatchInput<Self> | RepoPatchFn<Self>,
    options?: RepoPatchOptions,
  ): Promise<RepoUpdateResult<Self>> {
    return this.withPatchRetries(options, async () => {
      const current = (await this.db.getOrThrow({
        table: this.tableName,
        key: this.extractKey(key),
        resource: this.resourceName,
        consistent: true,
      } as any)) as Obj;
      const input = typeof patch === "function" ? patch(current as any) : patch;
      return this.writePatch(key as Obj, current, input as Obj);
    });
  }

  /**
   * Creates `item` if no item with its key exists; otherwise patches the
   * existing item, as {@link patch} does. The patch is `update(current)` when
   * given, else `item` itself — so fields of `item` are merged in, and fields
   * it doesn't mention (including `defaultCreateData` keys like `createdAt`)
   * are left alone.
   *
   * Reads first, so the common cases cost two requests (read + create, or
   * read + update) and an unchanged item costs one. Only a create that loses a
   * race to another writer pays extra: it falls back to the patch path with a
   * fresh read.
   */
  async createOrPatch<const T extends RepoCreateItem<Self>>(
    item: T,
    update?: RepoPatchFn<Self>,
    options?: RepoPatchOptions,
  ): Promise<RepoUpdateResult<Self>> {
    const key = this.extractKey(item as unknown as RepoKey<Self>) as Obj;
    return this.withPatchRetries(options, async () => {
      const current = (await this.db.get({
        table: this.tableName,
        key,
        consistent: true,
      } as any)) as Obj | undefined;
      if (!current) return (await this.create(item)) as RepoUpdateResult<Self>;
      const input = update ? update(current as any) : item;
      return this.writePatch(key, current, input as Obj);
    });
  }

  // Runs one read-diff-write attempt per call, retrying with jittered backoff
  // while it loses races: a failed write condition (an update lost) or
  // ALREADY_EXISTS (a create lost). The last error is rethrown once attempts
  // run out.
  private async withPatchRetries<R>(
    options: RepoPatchOptions | undefined,
    attempt: () => Promise<R>,
  ): Promise<R> {
    const requested = options?.maxAttempts ?? DEFAULT_PATCH_MAX_ATTEMPTS;
    const maxAttempts = Number.isFinite(requested) ? Math.max(1, Math.trunc(requested)) : 1;
    for (let n = 1; ; n++) {
      try {
        return await attempt();
      } catch (err) {
        const lostRace =
          err instanceof DinahError &&
          (err.details.type === "CONDITIONAL_CHECK_FAILED" ||
            err.details.type === "ALREADY_EXISTS");
        if (!lostRace || n >= maxAttempts) throw err;
        await new Promise((resolve) => setTimeout(resolve, batchBackoffDelay(n)));
      }
    }
  }

  private async writePatch(key: Obj, current: Obj, input: Obj): Promise<RepoUpdateResult<Self>> {
    const { transformAttributes, computedAttributes } = this.config;
    const { partitionKey, sortKey } = this.table.def;
    const keyFields = new Set<string>([partitionKey, sortKey].filter(Boolean) as string[]);

    // Values as they'd be stored, so they compare against `current` (which is
    // post-transform). The untransformed value is what's sent on, since the
    // update path applies transforms itself.
    const stored = (k: string, v: unknown): unknown => {
      const transform = (transformAttributes as Obj | undefined)?.[k];
      return v !== undefined && transform ? transform(v) : v;
    };

    const update: Obj = {};
    const written = new Set<string>();

    for (const [k, v] of Object.entries(input)) {
      if (computedAttributes && k in computedAttributes) {
        throw new DinahError({
          type: "VALIDATION",
          message: `Field "${k}" is a computed attribute and cannot be set directly. Patch the source field instead.`,
        });
      }
      if (keyFields.has(k)) {
        if (v !== undefined && !deepEqual(stored(k, v), current[k])) {
          throw new DinahError({
            type: "VALIDATION",
            message: `Field "${k}" is part of the primary key and cannot be patched to a different value.`,
          });
        }
        continue;
      }
      if (v === undefined) {
        if (current[k] === undefined) continue;
        update[k] = { $remove: true };
      } else if (deepEqual(stored(k, v), current[k])) {
        continue;
      } else {
        update[k] = v;
      }
      written.add(k);
    }

    if (!written.size) return this.applyTransformIfNeeded(current as any);

    // A multi-source computed field is only recomputed when the update carries
    // all of its sources. Fill unchanged ones in from the read, marked so the
    // update path doesn't transform the already-stored value a second time.
    // They're conditioned on below too, since the recomputed value depends on
    // them.
    const preTransformed = new Set<string>();
    for (const def of Object.values(computedAttributes ?? {})) {
      const from = (def as { from: string | readonly string[] }).from;
      if (!Array.isArray(from) || !from.some((k: string) => written.has(k))) continue;
      for (const k of from as string[]) {
        if (written.has(k)) continue;
        update[k] = current[k] === undefined ? { $remove: true } : current[k];
        preTransformed.add(k);
        written.add(k);
      }
    }

    const condition = {
      $and: [
        { [partitionKey]: { $exists: true } },
        ...[...written].map((k) =>
          current[k] === undefined ? { [k]: { $exists: false } } : { [k]: { $eq: current[k] } },
        ),
      ],
    } as unknown as Condition<ExtractTableSchema<T>>;

    const result = await this.db.update({
      table: this.tableName,
      key: this.extractKey(key as RepoKey<Self>),
      resource: this.resourceName,
      update: this.applyNormalizersToExpression(update, preTransformed) as any,
      condition: this.withDiscriminatorCondition(key, condition),
    });
    return this.applyTransformIfNeeded(result);
  }

  async delete(
    key: RepoKey<Self>,
    options?: RepoDeleteOptions<Self>,
  ): Promise<RepoDeleteOrThrowResult<Self> | undefined> {
    const item = await this.db.delete({
      table: this.tableName,
      key: this.extractKey(key),
      resource: this.resourceName,
      ...options,
    });
    return item && this.applyTransformIfNeeded(item);
  }

  async deleteOrThrow(
    key: RepoKey<Self>,
    options?: RepoDeleteOptions<Self>,
  ): Promise<RepoDeleteOrThrowResult<Self>> {
    const item = await this.db.deleteOrThrow({
      table: this.tableName,
      key: this.extractKey(key),
      resource: this.resourceName,
      ...options,
    });
    return this.applyTransformIfNeeded(item);
  }

  async query<const O extends RepoQueryOptions<Self>>(
    query: RepoQueryQuery<Self>,
    options?: O & StrictOptions<O, RepoQueryOptions<Self>, Self["$schema"]>,
  ): Promise<RepoQueryResult<Self, O>> {
    const items = await this.db.query({ table: this.tableName, query, ...options } as any);
    return this.applyTransformsIfNeeded(items, options) as any;
  }

  async *queryPaged<const O extends RepoQueryOptions<Self>>(
    query: RepoQueryQuery<Self>,
    options?: O & StrictOptions<O, RepoQueryOptions<Self>, Self["$schema"]>,
  ): RepoQueryPagedResult<Self, O> {
    for await (const page of this.db.queryPaged({
      table: this.tableName,
      query,
      ...options,
    } as any)) {
      yield this.applyTransformsIfNeeded(page, options) as any;
    }
  }

  async queryGsi<G extends GsiNames<Self>, const O extends RepoQueryGsiOptions<Self, T, G>>(
    gsi: G,
    query: RepoQueryGsiQuery<T, G>,
    options?: O & StrictOptions<O, RepoQueryGsiOptions<Self, T, G>, Self["$schema"]>,
  ): Promise<RepoQueryGsiResult<Self, O, G>> {
    const items = await this.db.query({
      table: this.tableName,
      index: gsi,
      query,
      ...options,
    } as any);
    return this.applyTransformsIfNeeded(items, { ...options, gsi }) as any;
  }

  async *queryGsiPaged<G extends GsiNames<Self>, const O extends RepoQueryGsiOptions<Self, T, G>>(
    gsi: G,
    query: RepoQueryGsiQuery<T, G>,
    options?: O & StrictOptions<O, RepoQueryGsiOptions<Self, T, G>, Self["$schema"]>,
  ): RepoQueryGsiPagedResult<Self, O, G> {
    for await (const page of this.db.queryPaged({
      table: this.tableName,
      index: gsi,
      query,
      ...options,
    } as any)) {
      yield this.applyTransformsIfNeeded(page, { ...options, gsi }) as any;
    }
  }

  async getGsi<G extends GsiNames<Self>, const O extends RepoGetGsiOptions<Self, T, G>>(
    gsi: G,
    query: RepoQueryGsiQuery<T, G>,
    options?: O & StrictOptions<O, RepoGetGsiOptions<Self, T, G>, Self["$schema"]>,
  ): Promise<RepoGetGsiOrThrowResult<Self, O, G> | undefined> {
    const { filter, ...restOptions } = (options ?? {}) as RepoGetGsiOptions<Self, T, G>;
    const items = await this.db.query({
      table: this.tableName,
      index: gsi,
      query,
      ...restOptions,
    } as any);
    if (items.length > 1) {
      throw new DinahError({
        type: "DATA_INTEGRITY",
        message: `getGsi on "${gsi}" returned ${items.length} items; expected at most 1.`,
      });
    }
    const item = items[0];
    if (!item) return undefined;
    if (filter && !matchesPartial(filter, item as any)) return undefined;
    return this.applyTransformIfNeeded(item, { ...options, gsi }) as any;
  }

  async getGsiOrThrow<G extends GsiNames<Self>, const O extends RepoGetGsiOptions<Self, T, G>>(
    gsi: G,
    query: RepoQueryGsiQuery<T, G>,
    options?: O & StrictOptions<O, RepoGetGsiOptions<Self, T, G>, Self["$schema"]>,
  ): Promise<RepoGetGsiOrThrowResult<Self, O, G>> {
    const item = await this.getGsi<G, O>(gsi, query, options);
    if (item === undefined) {
      throw new DinahError({
        type: "NOT_FOUND",
        key: query as Record<string, unknown>,
        resource: this.resourceName,
      });
    }
    return item as any;
  }

  async scan<const O extends RepoScanOptions<Self>>(
    options?: O & StrictOptions<O, RepoScanOptions<Self>, Self["$schema"]>,
  ): Promise<RepoScanResult<Self, O>> {
    const items = await this.db.scan({ table: this.tableName, ...options });
    return this.applyTransformsIfNeeded(items, options) as any;
  }

  async *scanPaged<const O extends RepoScanOptions<Self>>(
    options?: O & StrictOptions<O, RepoScanOptions<Self>, Self["$schema"]>,
  ): RepoScanPagedResult<Self, O> {
    for await (const page of this.db.scanPaged({ table: this.tableName, ...options })) {
      yield this.applyTransformsIfNeeded(page, options) as any;
    }
  }

  async scanGsi<G extends GsiNames<Self>, const O extends RepoScanGsiOptions<Self, T, G>>(
    gsi: G,
    options?: O & StrictOptions<O, RepoScanGsiOptions<Self, T, G>, Self["$schema"]>,
  ): Promise<RepoScanGsiResult<Self, O, G>> {
    const items = await this.db.scan({ table: this.tableName, index: gsi, ...options } as any);
    return this.applyTransformsIfNeeded(items, { ...options, gsi }) as any;
  }

  async *scanGsiPaged<G extends GsiNames<Self>, const O extends RepoScanGsiOptions<Self, T, G>>(
    gsi: G,
    options?: O & StrictOptions<O, RepoScanGsiOptions<Self, T, G>, Self["$schema"]>,
  ): RepoScanGsiPagedResult<Self, O, G> {
    for await (const page of this.db.scanPaged({
      table: this.tableName,
      index: gsi,
      ...options,
    } as any)) {
      yield this.applyTransformsIfNeeded(page, { ...options, gsi }) as any;
    }
  }

  async exists(options?: RepoExistsOptions<Self>): Promise<boolean> {
    return this.db.exists({
      table: this.tableName,
      projection: [this.table.def.partitionKey] as any,
      ...options,
    });
  }

  async existsGsi(gsi: GsiNames<Self>, options?: RepoExistsOptions<Self>): Promise<boolean> {
    return this.db.exists({
      table: this.tableName,
      index: gsi,
      projection: [this.table.def.partitionKey] as any,
      ...options,
    });
  }

  async batchGet<const O extends RepoBatchGetOptions<Self>>(
    keys: RepoKey<Self>[],
    options?: O & StrictOptions<O, RepoBatchGetOptions<Self>, Self["$schema"]>,
  ): Promise<RepoBatchGetResult<Self, O>> {
    const { filter, parallel, maxAttempts, chunkSize, ...restOptions } = (options ??
      {}) as RepoBatchGetOptions<Self>;
    const { items, unprocessed } = await this.db.batchGet(
      {
        [this.tableName]: {
          keys: keys.map((key) => this.extractKey(key)),
          filter,
          ...restOptions,
        },
      } as any,
      { parallel, maxAttempts, chunkSize },
    );
    const tableItems = items[this.tableName];
    return {
      items: (tableItems && this.applyTransformsIfNeeded(tableItems, options)) as any,
      unprocessed: unprocessed?.[this.tableName]?.keys as RepoKey<Self>[] | undefined,
    };
  }

  async batchGetOrThrow<const O extends RepoBatchGetOptions<Self>>(
    keys: RepoKey<Self>[],
    options?: O & StrictOptions<O, RepoBatchGetOptions<Self>, Self["$schema"]>,
  ): Promise<RepoBatchGetOrThrowResult<Self, O>> {
    const { filter, parallel, maxAttempts, chunkSize, ...restOptions } = (options ??
      {}) as RepoBatchGetOptions<Self>;
    const result = await this.db.batchGetOrThrow(
      {
        [this.tableName]: {
          keys: keys.map((key) => this.extractKey(key)),
          resource: this.resourceName,
          filter,
          ...restOptions,
        },
      } as any,
      { parallel, maxAttempts, chunkSize },
    );
    return this.applyTransformsIfNeeded(result[this.tableName] ?? [], options) as any;
  }

  async batchWrite(
    requests: RepoBatchWrite<Self>,
    options?: DbBatchOptions,
  ): Promise<RepoBatchWriteResult<Self>> {
    const { items, unprocessed } = await this.db.batchWrite(
      { [this.tableName]: this.toBatchWriteRequests(requests) },
      options,
    );

    return {
      items: items[this.tableName],
      unprocessed: unprocessed?.[this.tableName],
    } as RepoBatchWriteResult<Self>;
  }

  /**
   * `batchWrite`, but throws a `BATCH_UNPROCESSED` {@link DinahError} instead of
   * returning leftovers. Prefer this for bulk/operator jobs, where silently
   * dropping part of the write is worse than failing.
   */
  async batchWriteOrThrow(requests: RepoBatchWrite<Self>, options?: DbBatchOptions): Promise<void> {
    await this.db.batchWriteOrThrow(
      { [this.tableName]: this.toBatchWriteRequests(requests) },
      options,
    );
  }

  /**
   * Duplicate keys are rejected rather than deduplicated.
   *
   * DynamoDB refuses a batch containing two operations on one item, and
   * chunking makes that position-dependent today: repeats inside a single
   * 25-item chunk raise a ValidationException, while repeats straddling a
   * boundary quietly both apply. Failing consistently is better than either.
   *
   * Collapsing them isn't a safe alternative. A PUT and a DELETE for the same
   * key have no meaningful merge, and honouring "last write wins" would require
   * ordered chunks — which `parallel` explicitly gives up. Deduplicating here
   * would advertise semantics this can't guarantee, so the caller keeps the
   * choice.
   *
   * This lives on `Repo` because it needs the table's key schema; `Db` receives
   * raw PUT items and can't tell which attributes form the key.
   */
  private toBatchWriteRequests(requests: RepoBatchWrite<Self>) {
    const { partitionKey, sortKey } = this.table.def;
    const keyNames = sortKey ? [partitionKey, sortKey] : [partitionKey];
    const seen = new Set<string>();

    return requests.map((request) => {
      const source = request.type === "DELETE" ? request.key : request.item;
      const key = this.extractKey(source as RepoKey<Self>) as Obj;
      const identity = keyNames.map((name) => JSON.stringify(key[name])).join("\u0000");

      if (seen.has(identity)) {
        throw new DinahError({
          type: "VALIDATION",
          message:
            `batchWrite received more than one request for the same key in "${this.tableName}": ` +
            `${JSON.stringify(key)}. DynamoDB rejects a batch containing two operations on one ` +
            `item; deduplicate before calling, keeping whichever request should win.`,
        });
      }
      seen.add(identity);

      return request.type === "DELETE"
        ? { type: "DELETE" as const, key }
        : { type: "PUT" as const, item: request.item };
    });
  }

  async batchUpdate(
    keys: RepoKey<Self>[],
    update: RepoUpdateInput<Self>,
    options?: DbBatchOptions,
  ): Promise<RepoBatchUpdateResult<Self>> {
    const updateWithDefaults = this.applyNormalizersToExpression(update as Obj);
    const result = await this.db.batchUpdate(
      {
        [this.tableName]: {
          keys: keys.map((key) => this.extractKey(key)),
          update: updateWithDefaults as any,
        },
      } as any,
      options,
    );
    return {
      unprocessed: result.unprocessed?.[this.tableName]?.keys as RepoKey<Self>[] | undefined,
    };
  }

  async trxGet<const O extends RepoTrxGetOptions<Self>>(
    keys: RepoKey<Self>[],
    options?: O & StrictOptions<O, RepoTrxGetOptions<Self>, Self["$schema"]>,
  ): Promise<RepoTrxGetResult<Self, O>> {
    const { filter, ...restOptions } = (options ?? {}) as RepoTrxGetOptions<Self>;
    const items = await this.db.trxGet(
      ...keys.map(
        (key) =>
          ({
            table: this.tableName,
            key: this.extractKey(key),
            filter,
            ...restOptions,
          }) as any,
      ),
    );
    return items.map((item: any) => item && this.applyTransformIfNeeded(item, options)) as any;
  }

  async trxGetOrThrow<const O extends RepoTrxGetOptions<Self>>(
    keys: RepoKey<Self>[],
    options?: O & StrictOptions<O, RepoTrxGetOptions<Self>, Self["$schema"]>,
  ): Promise<RepoTrxGetOrThrowResult<Self, O>> {
    const { filter, ...restOptions } = (options ?? {}) as RepoTrxGetOptions<Self>;
    const items = await this.db.trxGetOrThrow(
      ...keys.map(
        (key) =>
          ({
            table: this.tableName,
            key: this.extractKey(key),
            resource: this.resourceName,
            filter,
            ...restOptions,
          }) as any,
      ),
    );
    return this.applyTransformsIfNeeded(items, options) as any;
  }

  async trxWrite(...requests: RepoTrxWriteRequest<Self>[]): Promise<void> {
    await this.db.trxWrite(
      ...requests.map((request) => {
        switch (request.type) {
          case "CONDITION": {
            const { key, condition } = request;
            return this.trxConditionRequest(key, condition);
          }

          case "DELETE": {
            const { key, ...options } = request;
            return this.trxDeleteRequest(key, options);
          }

          case "PUT": {
            const { item, ...options } = request;
            return this.trxPutRequest(item, options);
          }

          case "UPDATE": {
            const { key, update, ...options } = request;
            return this.trxUpdateRequest(
              key,
              update as RepoUpdateInputFor<Self, typeof key>,
              options,
            );
          }

          default:
            throw new Error("Unexpected request type.");
        }
      }),
    );
  }

  async trxDelete(keys: RepoKey<Self>[], options?: RepoDeleteOptions<Self>): Promise<void> {
    return this.db.trxWrite(...keys.map((key) => this.trxDeleteRequest(key, options)));
  }

  // todo: return items
  async trxPut(items: RepoPutItem<Self>[], options?: RepoPutOptions<Self>): Promise<void> {
    return this.db.trxWrite(...items.map((item) => this.trxPutRequest(item, options)));
  }

  async trxUpdate(
    keys: RepoKey<Self>[],
    update: RepoUpdateInput<Self>,
    options?: RepoUpdateOptions<Self>,
  ): Promise<void> {
    return this.db.trxWrite(
      ...keys.map((key) =>
        this.trxUpdateRequest(key, update as RepoUpdateInputFor<Self, typeof key>, options),
      ),
    );
  }

  // todo: return items
  async trxCreate(items: RepoCreateItem<Self>[]): Promise<void> {
    return this.db.trxWrite(...items.map((item) => this.trxCreateRequest(item)));
  }

  trxGetRequest<O extends RepoGetOptions<Self>>(
    key: RepoKey<Self>,
    options?: O,
  ): DbTrxGetRequest<RepoGetOrThrowResult<Self, O>> {
    return { table: this.tableName, key: this.extractKey(key), ...options } as any;
  }

  trxDeleteRequest(key: RepoKey<Self>, options?: RepoDeleteOptions<Self>): DbTrxWriteRequest {
    return { table: this.tableName, type: "DELETE", key: this.extractKey(key), ...options };
  }

  trxConditionRequest(
    key: RepoKey<Self>,
    condition: Condition<Self["$schema"]>,
  ): DbTrxWriteRequest {
    return {
      table: this.tableName,
      type: "CONDITION",
      key: this.extractKey(key),
      condition,
    };
  }

  trxPutRequest(item: RepoPutItem<Self>, options?: RepoPutOptions<Self>): DbTrxWriteRequest {
    return { table: this.tableName, type: "PUT", item: item as any, ...options };
  }

  trxUpdateRequest<const K extends RepoKey<Self>>(
    key: K,
    update: RepoUpdateInputFor<Self, K>,
    options?: RepoUpdateOptions<Self>,
  ): DbTrxWriteRequest {
    const updateWithDefaults = this.applyNormalizersToExpression(update as Obj);
    return {
      table: this.tableName,
      type: "UPDATE",
      key: this.extractKey(key),
      update: updateWithDefaults as any,
      ...options,
      condition: this.withDiscriminatorCondition(key, options?.condition),
    };
  }

  trxCreateRequest(item: RepoCreateItem<Self>): DbTrxWriteRequest {
    const condition = { $and: [{ [this.table.def.partitionKey]: { $exists: false } }] } as any;

    const normalizedItem = this.applyCreateTransforms(item as Obj);

    return {
      table: this.tableName,
      type: "PUT",
      item: normalizedItem,
      condition,
    };
  }

  private applyCreateTransforms(item: Obj): Partial<ExtractTableSchema<T>> {
    const { transformAttributes, computedAttributes } = this.config;

    if (computedAttributes) {
      for (const key of Object.keys(computedAttributes)) {
        if (key in item) {
          throw new DinahError({
            type: "VALIDATION",
            message: `Field "${key}" is a computed attribute and cannot be set directly. Remove it from the create input.`,
          });
        }
      }
    }

    const merged: Obj = { ...this.defaultCreateData, ...item };

    if (transformAttributes) {
      for (const [key, transform] of Object.entries(transformAttributes)) {
        if (key in merged && merged[key] !== undefined) {
          merged[key] = (transform as (v: unknown) => unknown)(merged[key]);
        }
      }
    }

    if (computedAttributes) {
      for (const [key, def] of Object.entries(computedAttributes)) {
        const { from, compute } = def as {
          from: string | readonly string[];
          compute: (...v: unknown[]) => unknown;
        };
        const args = Array.isArray(from)
          ? (from as string[]).map((k) => merged[k])
          : [merged[from as string]];
        const computed = compute(...args);
        if (computed !== undefined) {
          merged[key] = computed;
        } else {
          delete merged[key];
        }
      }
    }

    return merged as Partial<ExtractTableSchema<T>>;
  }

  // `preTransformed` names fields whose values are already in stored form
  // (taken from a read), so `transformAttributes` must not run on them again.
  private applyNormalizersToExpression(userUpdate: Obj, preTransformed?: Set<string>): Obj {
    const { transformAttributes, computedAttributes, immutableAttributes } = this.config;

    if (computedAttributes) {
      for (const key of Object.keys(computedAttributes)) {
        if (key in userUpdate) {
          throw new DinahError({
            type: "VALIDATION",
            message: `Field "${key}" is a computed attribute and cannot be set directly in an update. Update the source field instead.`,
          });
        }
      }
    }

    for (const key of immutableAttributes ?? []) {
      if ((key as string) in userUpdate) {
        throw new DinahError({
          type: "VALIDATION",
          message: `Field "${key as string}" is immutable and cannot be updated.`,
        });
      }
    }

    const result: Obj = { ...this.defaultUpdateData, ...userUpdate };

    if (transformAttributes) {
      for (const [key, transform] of Object.entries(transformAttributes)) {
        if (!(key in result) || preTransformed?.has(key)) continue;
        const val = result[key];
        const fn = transform as (v: unknown) => unknown;
        if (val === undefined || (isOperation(val) && val.$remove === true)) {
          // nothing to transform
        } else if (!isOperation(val)) {
          result[key] = fn(val);
        } else if (val.$set !== undefined) {
          result[key] = { ...val, $set: fn(val.$set) };
        } else if (val.$literal !== undefined) {
          result[key] = { ...val, $literal: fn(val.$literal) };
        } else if (val.$ifNotExists !== undefined) {
          const ifne = val.$ifNotExists as unknown;
          result[key] = {
            ...val,
            $ifNotExists: Array.isArray(ifne)
              ? [(ifne as unknown[])[0], fn((ifne as unknown[])[1])]
              : fn(ifne),
          };
        }
      }
    }

    if (computedAttributes) {
      for (const [computedKey, def] of Object.entries(computedAttributes)) {
        const { from, compute } = def as {
          from: string | readonly string[];
          compute: (...v: unknown[]) => unknown;
        };

        if (Array.isArray(from)) {
          const fromArr = from as string[];
          const presentKeys = fromArr.filter((k) => k in result);
          if (presentKeys.length === 0) continue;
          const missingKeys = fromArr.filter((k) => !(k in result));
          if (missingKeys.length > 0) {
            throw new DinahError({
              type: "VALIDATION",
              message: `Field "${computedKey}" is computed from [${fromArr.join(", ")}]. All source fields must be included in the update or none. Missing: [${missingKeys.join(", ")}].`,
            });
          }
          const args: unknown[] = [];
          for (const key of fromArr) {
            const val = result[key];
            if (val === undefined || (isOperation(val) && val.$remove === true)) {
              args.push(undefined);
            } else if (!isOperation(val)) {
              args.push(val);
            } else if (val.$set !== undefined) {
              args.push(val.$set);
            } else if (val.$literal !== undefined) {
              args.push(val.$literal);
            } else {
              throw new DinahError({
                type: "VALIDATION",
                message: `Field "${key}" drives computed field "${computedKey}" and cannot use arithmetic or list operators in updates.`,
              });
            }
          }
          const computed = compute(...args);
          result[computedKey] = computed !== undefined ? computed : { $remove: true };
        } else {
          const fromKey = from as string;
          if (!(fromKey in result)) continue;

          const val = result[fromKey];
          let resolvedVal: unknown;
          if (val === undefined || (isOperation(val) && val.$remove === true)) {
            resolvedVal = undefined;
          } else if (!isOperation(val)) {
            resolvedVal = val;
          } else if (val.$set !== undefined) {
            resolvedVal = val.$set;
          } else if (val.$literal !== undefined) {
            resolvedVal = val.$literal;
          } else {
            throw new DinahError({
              type: "VALIDATION",
              message: `Field "${fromKey}" drives computed field "${computedKey}" and cannot use arithmetic or list operators in updates.`,
            });
          }
          const computed = compute(resolvedVal);
          result[computedKey] = computed !== undefined ? computed : { $remove: true };
        }
      }
    }

    return result;
  }

  // If the caller passed a key that carries the schema's discriminator
  // value, AND condition that field against the same value. Guards against the
  // row on the wire having a different variant than the type-level narrowing
  // assumed.
  private withDiscriminatorCondition(
    key: Obj,
    condition: Condition<ExtractTableSchema<T>> | undefined,
  ): Condition<ExtractTableSchema<T>> | undefined {
    const discriminator = discriminatorOf(this.table.schema);
    if (!discriminator) return condition;
    const value = key[discriminator];
    if (value === undefined) return condition;
    const guard = { [discriminator]: value } as Condition<ExtractTableSchema<T>>;
    if (!condition) return guard;
    return { $and: [guard, condition] } as Condition<ExtractTableSchema<T>>;
  }

  protected applyTransformsIfNeeded(
    items: Obj[],
    options?: { projection?: any[]; gsi?: string },
  ): any[] {
    // transforms aren't applied when applying a projection
    if (options?.projection?.length) return items;
    if (options?.gsi) {
      // projections inherited to GSIs also prevent transformation
      const gsiProj = this.table.def.gsis?.[options.gsi]?.projection;
      if (gsiProj === "KEYS_ONLY" || Array.isArray(gsiProj)) return items;
    }

    return items.map((item) => this.transformOutput(item as ExtractTableSchema<T>));
  }

  protected applyTransformIfNeeded(item: Obj, options?: { projection?: any[]; gsi?: string }): any {
    const [transformedItem] = this.applyTransformsIfNeeded([item], options);
    return transformedItem;
  }
}

export interface MakeRepoResult<
  T extends Table,
  TDefaults extends Partial<ExtractTableSchema<T>> = {},
  TUpdateDefaults extends Partial<ExtractTableSchema<T>> = {},
  TOutput = ExtractTableSchema<T>,
  TComputed extends ValidComputedMap<ExtractTableSchema<T>, TComputed> = {},
  TImmutable extends AllKeys<ExtractTableSchema<T>> = never,
> {
  new (db: Db): Repo<T, TDefaults, TUpdateDefaults, TOutput, TComputed, TImmutable>;
  readonly table: T;
}

export const makeRepo = <
  T extends Table,
  TDefaults extends Partial<ExtractTableSchema<T>> = {},
  TUpdateDefaults extends Partial<ExtractTableSchema<T>> = {},
  TOutput = ExtractTableSchema<T>,
  const TComputed extends ValidComputedMap<ExtractTableSchema<T>, TComputed> = {},
  const TImmutable extends AllKeys<ExtractTableSchema<T>> = never,
>(
  table: T,
  config?: RepoConfig<
    ExtractTableSchema<T>,
    TDefaults,
    TUpdateDefaults,
    TOutput,
    TComputed,
    TImmutable
  >,
): MakeRepoResult<T, TDefaults, TUpdateDefaults, TOutput, TComputed, TImmutable> => {
  return class extends Repo<T, TDefaults, TUpdateDefaults, TOutput, TComputed, TImmutable> {
    static readonly table = table;
    constructor(db: Db) {
      super(db, table, config);
    }
  };
};
