import type { Db } from "./db";
import type { Table } from "./table";
import type { DbTrxGetRequest, DbTrxWriteRequest } from "./db.types";
import type {
  GsiNames,
  RepoBatchGetOptions,
  RepoBatchGetOrThrowResult,
  RepoBatchGetResult,
  RepoBatchUpdateResult,
  RepoBatchWrite,
  RepoBatchWriteResult,
  RepoCreateOptions,
  RepoCreateItem,
  RepoCreateResult,
  RepoDeleteOptions,
  RepoDeleteOrThrowResult,
  RepoDeleteResult,
  RepoExistsOptions,
  RepoGetGsiOptions,
  RepoGetGsiOrThrowResult,
  RepoGetGsiResult,
  RepoGetOptions,
  RepoGetOrThrowResult,
  RepoGetResult,
  RepoKey,
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
} from "./repo.types";
import type { AllKeys, Condition, ExtractTableDef, ExtractTableSchema, Obj } from "./types";
import { isOperation } from "./expression-builder";
import { DinahError } from "./error";
import { matchesPartial } from "./util";

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

export type ComputedFieldDef<TSchema extends object, K extends keyof TSchema> = {
  [J in keyof TSchema]: { from: J; compute: (val: TSchema[J]) => TSchema[K] };
}[keyof TSchema];

export interface RepoConfig<
  TSchema extends object,
  TDefaults extends Partial<TSchema> = {},
  TUpdateDefaults extends Partial<TSchema> = {},
  TOutput = TSchema,
  TComputed extends { [K in keyof TSchema]?: ComputedFieldDef<TSchema, K> } = {},
  TImmutable extends AllKeys<TSchema> = never,
  TDiscriminator extends keyof TSchema = never,
> {
  resourceName?: string;
  discriminator?: TDiscriminator;
  defaultCreateData?: () => TDefaults;
  defaultUpdateData?: () => TUpdateDefaults;
  transformAttributes?: { [K in keyof TSchema]?: (val: TSchema[K]) => TSchema[K] };
  computedAttributes?: TComputed & { [K in keyof TSchema]?: ComputedFieldDef<TSchema, K> };
  transformOutput?: (item: TSchema) => TOutput;
  immutableAttributes?: readonly TImmutable[];
}

export class Repo<
  T extends Table,
  TDefaults extends Partial<ExtractTableSchema<T>> = {},
  TUpdateDefaults extends Partial<ExtractTableSchema<T>> = {},
  TOutput = ExtractTableSchema<T>,
  TComputed extends {
    [K in keyof ExtractTableSchema<T>]?: ComputedFieldDef<ExtractTableSchema<T>, K>;
  } = {},
  TImmutable extends AllKeys<ExtractTableSchema<T>> = never,
  TDiscriminator extends keyof ExtractTableSchema<T> = never,
> {
  // these phantom properties are used to pre-compute types derived from T
  // which allows easy lookups using the "this" Repo type
  declare readonly $schema: ExtractTableSchema<T>;
  declare readonly $def: ExtractTableDef<T>;
  declare readonly $computedAttributes: keyof TComputed;
  declare readonly $immutableAttributes: TImmutable;
  declare readonly $discriminator: TDiscriminator;

  readonly table: T;
  readonly db: Db;
  private readonly config: RepoConfig<
    ExtractTableSchema<T>,
    TDefaults,
    TUpdateDefaults,
    TOutput,
    TComputed,
    TImmutable,
    TDiscriminator
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
      TImmutable,
      TDiscriminator
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
  extractKey(item: RepoKey<this>): RepoKey<this> {
    const { partitionKey, sortKey } = this.table.def;
    if (sortKey) {
      return {
        [partitionKey]: item[partitionKey as keyof RepoKey<this>],
        [sortKey]: item[sortKey as keyof RepoKey<this>],
      } as RepoKey<this>;
    }

    return { [partitionKey]: item[partitionKey as keyof RepoKey<this>] } as RepoKey<this>;
  }

  async get<const O extends RepoGetOptions<this>>(
    key: RepoKey<this>,
    options?: O,
  ): Promise<RepoGetResult<this, O>> {
    const { filter, ...restOptions } = (options ?? {}) as RepoGetOptions<this>;
    const item = await this.db.get({
      table: this.tableName,
      key: this.extractKey(key),
      filter,
      ...restOptions,
    } as any);
    return (item && this.applyTransformIfNeeded(item, options)) as any;
  }

  async getOrThrow<const O extends RepoGetOptions<this>>(
    key: RepoKey<this>,
    options?: O,
  ): Promise<RepoGetOrThrowResult<this, O>> {
    const { filter, ...restOptions } = (options ?? {}) as RepoGetOptions<this>;
    const item = await this.db.getOrThrow({
      table: this.tableName,
      key: this.extractKey(key),
      resource: this.resourceName,
      filter,
      ...restOptions,
    } as any);
    return this.applyTransformIfNeeded(item, options) as any;
  }

  async put<const T extends RepoPutItem<this>>(
    item: T,
    options?: RepoPutOptions<this>,
  ): Promise<RepoPutResult<this, T>> {
    const result = await this.db.put({
      table: this.tableName,
      item: item as any,
      resource: this.resourceName,
      ...options,
    });
    return this.applyTransformIfNeeded(result) as any;
  }

  async update<const K extends RepoKey<this>>(
    key: K,
    update: RepoUpdateInputFor<this, K>,
    options?: RepoUpdateOptions<this>,
  ): Promise<RepoUpdateResult<this>> {
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

  async create<const T extends RepoCreateItem<this>>(
    item: T,
    options?: RepoCreateOptions<this>,
  ): Promise<RepoCreateResult<this, T>> {
    const { condition: otherCondition, ...otherOptions } = options ?? {};

    const condition = { $and: [{ [this.table.def.partitionKey]: { $exists: false } }] } as any;

    if (otherCondition) {
      condition.$and.push(otherCondition);
    }

    const normalizedItem = this.applyCreateTransforms(item as Obj);
    const result = await this.db.put({
      table: this.tableName,
      item: normalizedItem,
      resource: this.resourceName,
      condition,
      ...otherOptions,
    });
    return this.applyTransformIfNeeded(result) as any;
  }

  async delete(
    key: RepoKey<this>,
    options?: RepoDeleteOptions<this>,
  ): Promise<RepoDeleteResult<this>> {
    const item = await this.db.delete({
      table: this.tableName,
      key: this.extractKey(key),
      resource: this.resourceName,
      ...options,
    });
    return item && this.applyTransformIfNeeded(item);
  }

  async deleteOrThrow(
    key: RepoKey<this>,
    options?: RepoDeleteOptions<this>,
  ): Promise<RepoDeleteOrThrowResult<this>> {
    const item = await this.db.deleteOrThrow({
      table: this.tableName,
      key: this.extractKey(key),
      resource: this.resourceName,
      ...options,
    });
    return this.applyTransformIfNeeded(item);
  }

  async query<const O extends RepoQueryOptions<this>>(
    query: RepoQueryQuery<this>,
    options?: O,
  ): Promise<RepoQueryResult<this, O>> {
    const items = await this.db.query({ table: this.tableName, query, ...options } as any);
    return this.applyTransformsIfNeeded(items, options) as any;
  }

  async *queryPaged<const O extends RepoQueryOptions<this>>(
    query: RepoQueryQuery<this>,
    options?: O,
  ): RepoQueryPagedResult<this, O> {
    for await (const page of this.db.queryPaged({
      table: this.tableName,
      query,
      ...options,
    } as any)) {
      yield this.applyTransformsIfNeeded(page, options) as any;
    }
  }

  async queryGsi<G extends GsiNames<this>, const O extends RepoQueryGsiOptions<this, T, G>>(
    gsi: G,
    query: RepoQueryGsiQuery<T, G>,
    options?: O,
  ): Promise<RepoQueryGsiResult<this, O, G>> {
    const items = await this.db.query({
      table: this.tableName,
      index: gsi,
      query,
      ...options,
    } as any);
    return this.applyTransformsIfNeeded(items, { ...options, gsi }) as any;
  }

  async *queryGsiPaged<G extends GsiNames<this>, const O extends RepoQueryGsiOptions<this, T, G>>(
    gsi: G,
    query: RepoQueryGsiQuery<T, G>,
    options?: O,
  ): RepoQueryGsiPagedResult<this, O, G> {
    for await (const page of this.db.queryPaged({
      table: this.tableName,
      index: gsi,
      query,
      ...options,
    } as any)) {
      yield this.applyTransformsIfNeeded(page, { ...options, gsi }) as any;
    }
  }

  async getGsi<G extends GsiNames<this>, const O extends RepoGetGsiOptions<this, T, G>>(
    gsi: G,
    query: RepoQueryGsiQuery<T, G>,
    options?: O,
  ): Promise<RepoGetGsiResult<this, O, G>> {
    const { filter, ...restOptions } = (options ?? {}) as RepoGetGsiOptions<this, T, G>;
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

  async getGsiOrThrow<G extends GsiNames<this>, const O extends RepoGetGsiOptions<this, T, G>>(
    gsi: G,
    query: RepoQueryGsiQuery<T, G>,
    options?: O,
  ): Promise<RepoGetGsiOrThrowResult<this, O, G>> {
    const item = await this.getGsi(gsi, query, options);
    if (item === undefined) {
      throw new DinahError({
        type: "NOT_FOUND",
        key: query as Record<string, unknown>,
        resource: this.resourceName,
      });
    }
    return item as any;
  }

  async scan<const O extends RepoScanOptions<this>>(options?: O): Promise<RepoScanResult<this, O>> {
    const items = await this.db.scan({ table: this.tableName, ...options });
    return this.applyTransformsIfNeeded(items, options) as any;
  }

  async *scanPaged<const O extends RepoScanOptions<this>>(
    options?: O,
  ): RepoScanPagedResult<this, O> {
    for await (const page of this.db.scanPaged({ table: this.tableName, ...options })) {
      yield this.applyTransformsIfNeeded(page, options) as any;
    }
  }

  async scanGsi<G extends GsiNames<this>, const O extends RepoScanGsiOptions<this, T, G>>(
    gsi: G,
    options?: O,
  ): Promise<RepoScanGsiResult<this, O, G>> {
    const items = await this.db.scan({ table: this.tableName, index: gsi, ...options } as any);
    return this.applyTransformsIfNeeded(items, { ...options, gsi }) as any;
  }

  async *scanGsiPaged<G extends GsiNames<this>, const O extends RepoScanGsiOptions<this, T, G>>(
    gsi: G,
    options?: O,
  ): RepoScanGsiPagedResult<this, O, G> {
    for await (const page of this.db.scanPaged({
      table: this.tableName,
      index: gsi,
      ...options,
    } as any)) {
      yield this.applyTransformsIfNeeded(page, { ...options, gsi }) as any;
    }
  }

  async exists(options?: RepoExistsOptions<this>): Promise<boolean> {
    return this.db.exists({
      table: this.tableName,
      projection: [this.table.def.partitionKey] as any,
      ...options,
    });
  }

  async existsGsi(gsi: GsiNames<this>, options?: RepoExistsOptions<this>): Promise<boolean> {
    return this.db.exists({
      table: this.tableName,
      index: gsi,
      projection: [this.table.def.partitionKey] as any,
      ...options,
    });
  }

  async batchGet<const O extends RepoBatchGetOptions<this>>(
    keys: RepoKey<this>[],
    options?: O,
  ): Promise<RepoBatchGetResult<this, O>> {
    const { filter, ...restOptions } = (options ?? {}) as RepoBatchGetOptions<this>;
    const { items, unprocessed } = await this.db.batchGet({
      [this.tableName]: {
        keys: keys.map((key) => this.extractKey(key)),
        filter,
        ...restOptions,
      },
    } as any);
    const tableItems = items[this.tableName];
    return {
      items: (tableItems && this.applyTransformsIfNeeded(tableItems, options)) as any,
      unprocessed: unprocessed?.[this.tableName]?.keys as RepoKey<this>[] | undefined,
    };
  }

  async batchGetOrThrow<const O extends RepoBatchGetOptions<this>>(
    keys: RepoKey<this>[],
    options?: O,
  ): Promise<RepoBatchGetOrThrowResult<this, O>> {
    const { filter, ...restOptions } = (options ?? {}) as RepoBatchGetOptions<this>;
    const result = await this.db.batchGetOrThrow({
      [this.tableName]: {
        keys: keys.map((key) => this.extractKey(key)),
        resource: this.resourceName,
        filter,
        ...restOptions,
      },
    } as any);
    return this.applyTransformsIfNeeded(result[this.tableName] ?? [], options) as any;
  }

  async batchWrite(requests: RepoBatchWrite<this>): Promise<RepoBatchWriteResult<this>> {
    const { items, unprocessed } = await this.db.batchWrite({
      [this.tableName]: requests.map((request) => {
        if (request.type === "DELETE") {
          return { type: "DELETE", key: this.extractKey(request.key) };
        } else {
          return { type: "PUT", item: request.item };
        }
      }),
    });

    return {
      items: items[this.tableName],
      unprocessed: unprocessed?.[this.tableName],
    } as RepoBatchWriteResult<this>;
  }

  async batchUpdate(
    keys: RepoKey<this>[],
    update: RepoUpdateInput<this>,
  ): Promise<RepoBatchUpdateResult<this>> {
    const updateWithDefaults = this.applyNormalizersToExpression(update as Obj);
    const result = await this.db.batchUpdate({
      [this.tableName]: {
        keys: keys.map((key) => this.extractKey(key)),
        update: updateWithDefaults as any,
      },
    } as any);
    return {
      unprocessed: result.unprocessed?.[this.tableName]?.keys as RepoKey<this>[] | undefined,
    };
  }

  async trxGet<const O extends RepoTrxGetOptions<this>>(
    keys: RepoKey<this>[],
    options?: O,
  ): Promise<RepoTrxGetResult<this, O>> {
    const { filter, ...restOptions } = (options ?? {}) as RepoTrxGetOptions<this>;
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

  async trxGetOrThrow<const O extends RepoTrxGetOptions<this>>(
    keys: RepoKey<this>[],
    options?: O,
  ): Promise<RepoTrxGetOrThrowResult<this, O>> {
    const { filter, ...restOptions } = (options ?? {}) as RepoTrxGetOptions<this>;
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

  async trxWrite(...requests: RepoTrxWriteRequest<this>[]): Promise<void> {
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
              update as RepoUpdateInputFor<this, typeof key>,
              options,
            );
          }

          default:
            throw new Error("Unexpected request type.");
        }
      }),
    );
  }

  async trxDelete(keys: RepoKey<this>[], options?: RepoDeleteOptions<this>): Promise<void> {
    return this.db.trxWrite(...keys.map((key) => this.trxDeleteRequest(key, options)));
  }

  // todo: return items
  async trxPut(items: RepoPutItem<this>[], options?: RepoPutOptions<this>): Promise<void> {
    return this.db.trxWrite(...items.map((item) => this.trxPutRequest(item, options)));
  }

  async trxUpdate(
    keys: RepoKey<this>[],
    update: RepoUpdateInput<this>,
    options?: RepoUpdateOptions<this>,
  ): Promise<void> {
    return this.db.trxWrite(
      ...keys.map((key) =>
        this.trxUpdateRequest(key, update as RepoUpdateInputFor<this, typeof key>, options),
      ),
    );
  }

  // todo: return items
  async trxCreate(items: RepoCreateItem<this>[], options?: RepoCreateOptions<this>): Promise<void> {
    return this.db.trxWrite(...items.map((item) => this.trxCreateRequest(item, options)));
  }

  trxGetRequest<O extends RepoGetOptions<this>>(
    key: RepoKey<this>,
    options?: O,
  ): DbTrxGetRequest<RepoGetOrThrowResult<this, O>> {
    return { table: this.tableName, key: this.extractKey(key), ...options } as any;
  }

  trxDeleteRequest(key: RepoKey<this>, options?: RepoDeleteOptions<this>): DbTrxWriteRequest {
    return { table: this.tableName, type: "DELETE", key: this.extractKey(key), ...options };
  }

  trxConditionRequest(
    key: RepoKey<this>,
    condition: Condition<this["$schema"]>,
  ): DbTrxWriteRequest {
    return {
      table: this.tableName,
      type: "CONDITION",
      key: this.extractKey(key),
      condition,
    };
  }

  trxPutRequest(item: RepoPutItem<this>, options?: RepoPutOptions<this>): DbTrxWriteRequest {
    return { table: this.tableName, type: "PUT", item: item as any, ...options };
  }

  trxUpdateRequest<const K extends RepoKey<this>>(
    key: K,
    update: RepoUpdateInputFor<this, K>,
    options?: RepoUpdateOptions<this>,
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

  trxCreateRequest(
    item: RepoCreateItem<this>,
    options?: RepoCreateOptions<this>,
  ): DbTrxWriteRequest {
    const { condition: otherCondition, ...otherOptions } = options ?? {};

    const condition = { $and: [{ [this.table.def.partitionKey]: { $exists: false } }] } as any;

    if (otherCondition) {
      condition.$and.push(otherCondition);
    }

    const normalizedItem = this.applyCreateTransforms(item as Obj);

    return {
      table: this.tableName,
      type: "PUT",
      item: normalizedItem,
      condition,
      ...otherOptions,
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
        const { from, compute } = def as { from: string; compute: (v: unknown) => unknown };
        const computed = compute(merged[from]);
        if (computed !== undefined) {
          merged[key] = computed;
        } else {
          delete merged[key];
        }
      }
    }

    return merged as Partial<ExtractTableSchema<T>>;
  }

  private applyNormalizersToExpression(userUpdate: Obj): Obj {
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
        if (!(key in result)) continue;
        const val = result[key];
        const fn = transform as (v: unknown) => unknown;
        if (val === undefined || (isOperation(val) && val.$remove === true)) {
          // nothing to transform
        } else if (!isOperation(val)) {
          result[key] = fn(val);
        } else if (val.$set !== undefined) {
          result[key] = { ...val, $set: fn(val.$set) };
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
        const { from, compute } = def as { from: string; compute: (v: unknown) => unknown };
        if (!(from in result)) continue;

        const val = result[from];
        if (val === undefined || (isOperation(val) && val.$remove === true)) {
          result[computedKey] = undefined;
        } else if (!isOperation(val)) {
          result[computedKey] = compute(val);
        } else if (val.$set !== undefined) {
          result[computedKey] = compute(val.$set);
        } else {
          throw new DinahError({
            type: "VALIDATION",
            message: `Field "${from}" drives computed field "${computedKey}" and cannot use arithmetic or list operators in updates.`,
          });
        }
      }
    }

    return result;
  }

  // If the caller passed a key that carries the configured discriminator
  // value, AND condition that field against the same value. Guards against the
  // row on the wire having a different variant than the type-level narrowing
  // assumed.
  private withDiscriminatorCondition(
    key: Obj,
    condition: Condition<ExtractTableSchema<T>> | undefined,
  ): Condition<ExtractTableSchema<T>> | undefined {
    const discriminator = this.config.discriminator as string | undefined;
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
  TComputed extends {
    [K in keyof ExtractTableSchema<T>]?: ComputedFieldDef<ExtractTableSchema<T>, K>;
  } = {},
  TImmutable extends AllKeys<ExtractTableSchema<T>> = never,
  TDiscriminator extends keyof ExtractTableSchema<T> = never,
> {
  new (db: Db): Repo<T, TDefaults, TUpdateDefaults, TOutput, TComputed, TImmutable, TDiscriminator>;
  readonly table: T;
}

export const makeRepo = <
  T extends Table,
  TDefaults extends Partial<ExtractTableSchema<T>> = {},
  TUpdateDefaults extends Partial<ExtractTableSchema<T>> = {},
  TOutput = ExtractTableSchema<T>,
  const TComputed extends {
    [K in keyof ExtractTableSchema<T>]?: ComputedFieldDef<ExtractTableSchema<T>, K>;
  } = {},
  const TImmutable extends AllKeys<ExtractTableSchema<T>> = never,
  const TDiscriminator extends keyof ExtractTableSchema<T> = never,
>(
  table: T,
  config?: RepoConfig<
    ExtractTableSchema<T>,
    TDefaults,
    TUpdateDefaults,
    TOutput,
    TComputed,
    TImmutable,
    TDiscriminator
  >,
): MakeRepoResult<
  T,
  TDefaults,
  TUpdateDefaults,
  TOutput,
  TComputed,
  TImmutable,
  TDiscriminator
> => {
  return class extends Repo<
    T,
    TDefaults,
    TUpdateDefaults,
    TOutput,
    TComputed,
    TImmutable,
    TDiscriminator
  > {
    static readonly table = table;
    constructor(db: Db) {
      super(db, table, config);
    }
  };
};
