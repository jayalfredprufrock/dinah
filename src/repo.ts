import type { TSchema } from "typebox";
import type { Db } from "./db";
import type { Table } from "./table";
import type {
  DbTrxGetRequest,
  DbTrxWriteRequest,
  ExtractTableDef,
  GsiNames,
  Obj,
  RepoBatchGet,
  RepoBatchGetOrThrowResult,
  RepoBatchGetResult,
  RepoBatchWrite,
  RepoBatchWriteResult,
  RepoCreate,
  RepoCreateItem,
  RepoCreateResult,
  RepoDelete,
  RepoDeleteOrThrowResult,
  RepoDeleteResult,
  RepoExists,
  RepoGet,
  RepoGetOrThrowResult,
  RepoGetResult,
  RepoKey,
  RepoPut,
  RepoPutItem,
  RepoPutResult,
  RepoQuery,
  RepoQueryGsi,
  RepoQueryGsiPagedResult,
  RepoQueryGsiResult,
  RepoQueryPagedResult,
  RepoQueryResult,
  RepoScan,
  RepoScanGsi,
  RepoScanGsiPagedResult,
  RepoScanGsiResult,
  RepoScanPagedResult,
  RepoScanResult,
  RepoTrxGet,
  RepoTrxGetOrThrowResult,
  RepoTrxGetResult,
  RepoTrxWriteRequest,
  RepoUpdate,
  RepoUpdateData,
  RepoUpdateResult,
  RepoUpsert,
  RepoUpsertResult,
} from "./types";

// TODO: query/queryGsi needs strongly typed "key" argument
// allows =,>,>=,<,<=,begins_with, between on sort key
// util -> extractExclusiveStartKey(item)

export class Repository<T extends Table<any, any>> {
  readonly table: Table<TSchema, any>;
  readonly db: Db;
  constructor(table: T, db: Db) {
    this.table = table;
    this.db = db;
  }

  get tableName(): string {
    return `${this.db.config?.tableNamePrefix ?? ""}${this.table.def.name}`;
  }

  get def(): ExtractTableDef<T> {
    return this.table.def as never;
  }

  extractKey(item: RepoKey<T>): RepoKey<T> {
    const { partitionKey, sortKey } = this.table.def;
    if (sortKey) {
      return {
        [partitionKey]: item[partitionKey],
        [sortKey]: item[sortKey],
      } as RepoKey<T>;
    }

    return { [partitionKey]: item[partitionKey] } as RepoKey<T>;
  }

  async get<O extends RepoGet<T>>(key: RepoKey<T>, options?: O): Promise<RepoGetResult<T, O>> {
    return this.db.get({ table: this.tableName, key: this.extractKey(key), ...options });
  }

  async getOrThrow<O extends RepoGet<T>>(
    key: RepoKey<T>,
    options?: O,
  ): Promise<RepoGetOrThrowResult<T, O>> {
    return this.db.getOrThrow({ table: this.tableName, key: this.extractKey(key), ...options });
  }

  async put<O extends RepoPut<T>>(item: RepoPutItem<T>, options?: O): Promise<RepoPutResult<T, O>> {
    const itemWithDefaults = this.table.def.beforePut
      ? { ...this.table.def.beforePut(item), ...item }
      : item;
    return this.db.put({ table: this.tableName, item: itemWithDefaults, ...options });
  }

  async update<O extends RepoUpdate<T>>(
    key: RepoKey<T>,
    update: RepoUpdateData<T>,
    options?: O,
  ): Promise<RepoUpdateResult<T, O>> {
    const updateWithDefaults = this.table.def.beforeUpdate
      ? { ...this.table.def.beforeUpdate(update), ...update }
      : update;
    return this.db.update({
      table: this.tableName,
      key: this.extractKey(key),
      update: updateWithDefaults,
      ...options,
    }) as RepoUpdateResult<T, O>;
  }

  async create<O extends RepoCreate<T>>(
    item: RepoCreateItem<T>,
    options?: O,
  ): Promise<RepoCreateResult<T, O>> {
    const itemWithDefaults = this.table.def.beforePut
      ? { ...this.table.def.beforePut(item), ...item }
      : item;
    return this.db.create({
      table: this.tableName,
      item: itemWithDefaults,
      partitionKeyName: this.table.def.partitionKey,
      ...options,
    });
  }

  async upsert(data: RepoUpsert<T>): Promise<RepoUpsertResult<T>> {
    const { update, item, key, ...options } = data;
    const updateWithDefaults = this.table.def.beforeUpdate
      ? { ...this.table.def.beforeUpdate(update), ...update }
      : update;
    const itemWithDefaults = this.table.def.beforePut
      ? { ...this.table.def.beforePut(item), ...item }
      : item;
    return this.db.upsert({
      table: this.tableName,
      key: this.extractKey(key),
      update: updateWithDefaults,
      item: itemWithDefaults,
      ...options,
    });
  }

  async delete(key: RepoKey<T>, options?: RepoDelete<T>): Promise<RepoDeleteResult<T>> {
    return this.db.delete({ table: this.tableName, key: this.extractKey(key), ...options });
  }

  async deleteOrThrow(
    key: RepoKey<T>,
    options?: Omit<RepoDelete<T>, "return">,
  ): Promise<RepoDeleteOrThrowResult<T>> {
    return this.db.deleteOrThrow({ table: this.tableName, key: this.extractKey(key), ...options });
  }

  async query<O extends RepoQuery<T>>(query: Obj, options?: O): Promise<RepoQueryResult<T, O>> {
    return this.db.query({ table: this.tableName, query, ...options });
  }

  async *queryPaged<O extends RepoQuery<T>>(query: Obj, options?: O): RepoQueryPagedResult<T, O> {
    yield* this.db.queryPaged({ table: this.tableName, query, ...options }) as RepoQueryPagedResult<
      T,
      O
    >;
  }

  async queryGsi<G extends GsiNames<T>, O extends RepoQueryGsi<T>>(
    gsi: G,
    query: Obj,
    options?: O,
  ): Promise<RepoQueryGsiResult<T, O>> {
    return this.db.query({ table: this.tableName, index: gsi, query, ...options });
  }

  async *queryGsiPaged<G extends GsiNames<T>, O extends RepoQueryGsi<T>>(
    gsi: G,
    query: Obj,
    options?: O,
  ): RepoQueryGsiPagedResult<T, O> {
    yield* this.db.queryPaged({
      table: this.tableName,
      index: gsi,
      query,
      ...options,
    }) as RepoQueryGsiPagedResult<T, O>;
  }

  async scan<O extends RepoScan<T>>(options?: O): Promise<RepoScanResult<T, O>> {
    return this.db.scan({ table: this.tableName, ...options });
  }

  async *scanPaged<O extends RepoScan<T>>(options?: O): RepoScanPagedResult<T, O> {
    yield* this.db.scanPaged({ table: this.tableName, ...options }) as RepoScanPagedResult<T, O>;
  }

  async scanGsi<G extends GsiNames<T>, O extends RepoScanGsi<T>>(
    gsi: G,
    options?: O,
  ): Promise<RepoScanGsiResult<T, O>> {
    return this.db.scan({ table: this.tableName, index: gsi, ...options });
  }

  async *scanGsiPaged<G extends GsiNames<T>, O extends RepoScanGsi<T>>(
    gsi: G,
    options?: O,
  ): RepoScanGsiPagedResult<T, O> {
    yield* this.db.scanPaged({
      table: this.tableName,
      index: gsi,
      ...options,
    }) as RepoScanGsiPagedResult<T, O>;
  }

  async exists(options?: RepoExists<T>): Promise<boolean> {
    return this.db.exists({
      table: this.tableName,
      projection: [this.table.def.partitionKey],
      ...options,
    });
  }

  async existsGsi(gsi: GsiNames<T>, options?: RepoExists<T>): Promise<boolean> {
    return this.db.exists({
      table: this.tableName,
      index: gsi,
      projection: [this.table.def.partitionKey],
      ...options,
    });
  }

  async batchGet<O extends RepoBatchGet<T>>(
    keys: RepoKey<T>[],
    options?: O,
  ): Promise<RepoBatchGetResult<T, O>> {
    const { items, unprocessed } = await this.db.batchGet({
      [this.tableName]: { keys: keys.map((key) => this.extractKey(key)), ...options },
    });
    return {
      items: items[this.tableName],
      unprocessed: unprocessed?.[this.tableName]?.keys,
    } as RepoBatchGetResult<T, O>;
  }

  async batchGetOrThrow<O extends RepoBatchGet<T>>(
    keys: RepoKey<T>[],
    options?: O,
  ): Promise<RepoBatchGetOrThrowResult<T, O>> {
    const result = await this.db.batchGetOrThrow({
      [this.tableName]: { keys: keys.map((key) => this.extractKey(key)), ...options },
    });
    return result[this.tableName] as RepoBatchGetOrThrowResult<T, O>;
  }

  async batchWrite(requests: RepoBatchWrite<T>): Promise<RepoBatchWriteResult<T>> {
    const { items, unprocessed } = await this.db.batchWrite({
      [this.tableName]: requests.map((request) => {
        if (request.type === "DELETE") {
          return { type: "DELETE", key: this.extractKey(request.key) };
        } else {
          const itemWithDefaults = this.table.def.beforePut
            ? { ...this.table.def.beforePut(request.item), ...request.item }
            : request.item;
          return { type: "PUT", item: itemWithDefaults };
        }
      }),
    });

    return {
      items: items[this.tableName],
      unprocessed: unprocessed?.[this.tableName],
    } as RepoBatchWriteResult<T>;
  }

  // this can be simplified now
  // also add upsert

  async trxGet<O extends RepoTrxGet<T>>(
    keys: RepoKey<T>[],
    options?: O,
  ): Promise<RepoTrxGetResult<T, O>> {
    return this.db.trxGet(
      ...keys.map((key) => ({ table: this.tableName, key: this.extractKey(key), ...options })),
    ) as Promise<RepoTrxGetResult<T, O>>;
  }

  async trxGetOrThrow<O extends RepoTrxGet<T>>(
    keys: RepoKey<T>[],
    options?: O,
  ): Promise<RepoTrxGetOrThrowResult<T, O>> {
    return this.db.trxGetOrThrow(
      ...keys.map((key) => ({ table: this.tableName, key: this.extractKey(key), ...options })),
    ) as Promise<RepoTrxGetOrThrowResult<T, O>>;
  }

  async trxWrite(...requests: RepoTrxWriteRequest<T>[]): Promise<void> {
    await this.db.trxWrite(
      ...requests.map((request) => {
        switch (request.type) {
          case "CONDITION": {
            const { key, condition, ...options } = request;
            return this.trxConditionRequest(key, condition, options);
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
            return this.trxUpdateRequest(key, update, options);
          }

          default:
            throw new Error("Unexpected request type.");
        }
      }),
    );
  }

  async trxDelete(keys: RepoKey<T>[], options?: Omit<RepoDelete<T>, "return">): Promise<void> {
    return this.db.trxWrite(...keys.map((key) => this.trxDeleteRequest(key, options)));
  }

  // todo: return items
  async trxPut(items: RepoPutItem<T>[], options?: Omit<RepoPut<T>, "return">): Promise<void> {
    return this.db.trxWrite(...items.map((item) => this.trxPutRequest(item, options)));
  }

  async trxUpdate(
    keys: RepoKey<T>[],
    update: RepoUpdateData<T>,
    options?: Omit<RepoUpdate<T>, "return">,
  ): Promise<void> {
    return this.db.trxWrite(...keys.map((key) => this.trxUpdateRequest(key, update, options)));
  }

  // todo: return items
  async trxCreate(items: RepoCreateItem<T>[], options?: RepoCreate<T>): Promise<void> {
    return this.db.trxWrite(...items.map((item) => this.trxCreateRequest(item, options)));
  }

  trxGetRequest<O extends RepoGet<T>>(
    key: RepoKey<T>,
    options?: O,
  ): DbTrxGetRequest<RepoGetOrThrowResult<T, O>> {
    return { table: this.tableName, key: this.extractKey(key), ...options };
  }

  trxDeleteRequest(key: RepoKey<T>, options?: Omit<RepoDelete<T>, "return">): DbTrxWriteRequest {
    return { table: this.tableName, type: "DELETE", key: this.extractKey(key), ...options };
  }

  trxConditionRequest(
    key: RepoKey<T>,
    condition: Obj,
    options?: Omit<RepoDelete<T>, "return" | "condition">,
  ): DbTrxWriteRequest {
    return {
      table: this.tableName,
      type: "CONDITION",
      key: this.extractKey(key),
      condition,
      ...options,
    };
  }

  trxPutRequest(item: RepoPutItem<T>, options?: Omit<RepoPut<T>, "return">): DbTrxWriteRequest {
    const itemWithDefaults = this.table.def.beforePut
      ? { ...this.table.def.beforePut(item), ...item }
      : item;
    return { table: this.tableName, type: "PUT", item: itemWithDefaults, ...options };
  }

  trxUpdateRequest(
    key: RepoKey<T>,
    update: RepoUpdateData<T>,
    options?: Omit<RepoUpdate<T>, "return">,
  ): DbTrxWriteRequest {
    const updateWithDefaults = this.table.def.beforeUpdate
      ? { ...this.table.def.beforeUpdate(update), ...update }
      : update;
    return {
      table: this.tableName,
      type: "UPDATE",
      key: this.extractKey(key),
      update: updateWithDefaults,
      ...options,
    };
  }

  trxCreateRequest(item: RepoCreateItem<T>, options?: RepoCreate<T>): DbTrxWriteRequest {
    const { condition: otherCondition, ...otherOptions } = options ?? {};

    const condition = { $and: [{ [this.table.def.partitionKey]: { $exists: false } }] };

    if (otherCondition) {
      condition.$and.push(otherCondition);
    }

    const itemWithDefaults = this.table.def.beforePut
      ? { ...this.table.def.beforePut(item), ...item }
      : item;

    return {
      table: this.tableName,
      type: "PUT",
      item: itemWithDefaults,
      condition,
      ...otherOptions,
    };
  }
}
