import type { Db } from "./db";
import type { Table } from "./table";
import type {
  Condition,
  DbTrxGetRequest,
  DbTrxWriteRequest,
  ExtractTableDef,
  ExtractTableSchema,
  TableGsiNames,
  Obj,
  RepoBatchGetOptions,
  RepoBatchGetOrThrowResult,
  RepoBatchGetResult,
  RepoBatchWrite,
  RepoBatchWriteResult,
  RepoCreateOptions,
  RepoCreateItem,
  RepoCreateResult,
  RepoDeleteOptions,
  RepoDeleteOrThrowResult,
  RepoDeleteResult,
  RepoExistsOptions,
  RepoGetOptions,
  RepoGetOrThrowResult,
  RepoGetResult,
  RepoKey,
  RepoPutOptions,
  RepoPutItem,
  RepoPutResult,
  RepoQueryOptions,
  RepoQueryGsiOptions,
  RepoQueryGsiPagedResult,
  RepoQueryGsiResult,
  RepoQueryPagedResult,
  RepoQueryResult,
  RepoScanOptions,
  RepoScanGsiOptions,
  RepoScanGsiPagedResult,
  RepoScanGsiResult,
  RepoScanPagedResult,
  RepoScanResult,
  RepoTrxGetOptions,
  RepoTrxGetOrThrowResult,
  RepoTrxGetResult,
  RepoTrxWriteRequest,
  RepoUpdateOptions,
  RepoUpdateData,
  RepoUpdateResult,
  RepoQueryGsiQuery,
  RepoQueryQuery,
} from "./types";

// TODO: query/queryGsi needs strongly typed "key" argument
// allows =,>,>=,<,<=,begins_with, between on sort key
// util -> extractExclusiveStartKey(item)

export abstract class AbstractRepo<T extends Table> {
  // these phantom properties are used to pre-compute types derived from T
  // which allows easy lookups using the "this" AbstractRepo type
  declare readonly $schema: ExtractTableSchema<T>;
  declare readonly $def: ExtractTableDef<T>;

  abstract readonly table: T;
  readonly db: Db;
  constructor(db: Db) {
    this.db = db;
  }

  get tableName(): string {
    return `${this.db.config?.tableNamePrefix ?? ""}${this.table.def.name}`;
  }

  get defaultPutData(): Partial<ExtractTableSchema<T>> {
    return {};
  }

  get defaultUpdateData(): Partial<ExtractTableSchema<T>> {
    return {};
  }

  transformItem(item: ExtractTableSchema<T>): ExtractTableSchema<T> {
    return item;
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

  async get<O extends RepoGetOptions<this>>(
    key: RepoKey<this>,
    options?: O,
  ): Promise<RepoGetResult<this, O>> {
    const item = await this.db.get({
      table: this.tableName,
      key: this.extractKey(key),
      ...options,
    });
    return item && this.applyTransformIfNeeded(item, options);
  }

  async getOrThrow<O extends RepoGetOptions<this>>(
    key: RepoKey<this>,
    options?: O,
  ): Promise<RepoGetOrThrowResult<this, O>> {
    const item = await this.db.getOrThrow({
      table: this.tableName,
      key: this.extractKey(key),
      ...options,
    });
    return this.applyTransformIfNeeded(item, options);
  }

  async put(item: RepoPutItem<this>, options?: RepoPutOptions<this>): Promise<RepoPutResult<this>> {
    const itemWithDefaults = { ...this.defaultPutData, ...item };
    const result = await this.db.put({ table: this.tableName, item: itemWithDefaults, ...options });
    return this.applyTransformIfNeeded(result);
  }

  async update(
    key: RepoKey<this>,
    update: RepoUpdateData,
    options?: RepoUpdateOptions<this>,
  ): Promise<RepoUpdateResult<this>> {
    const updateWithDefaults = { ...this.defaultUpdateData, ...update };
    const result = await this.db.update({
      table: this.tableName,
      key: this.extractKey(key),
      update: updateWithDefaults,
      ...options,
    });
    return this.applyTransformIfNeeded(result);
  }

  async create(
    item: RepoPutItem<this>,
    options?: RepoCreateOptions<this>,
  ): Promise<RepoCreateResult<this>> {
    const { condition: otherCondition, ...otherOptions } = options ?? {};

    const condition = { $and: [{ [this.table.def.partitionKey]: { $exists: false } }] } as any;

    if (otherCondition) {
      condition.$and.push(otherCondition);
    }

    return this.put(item, { condition, ...otherOptions });
  }

  async delete(
    key: RepoKey<this>,
    options?: RepoDeleteOptions<this>,
  ): Promise<RepoDeleteResult<this>> {
    const item = await this.db.delete({
      table: this.tableName,
      key: this.extractKey(key),
      ...options,
    });
    return item && this.applyTransformIfNeeded(item);
  }

  async deleteOrThrow(
    key: RepoKey<this>,
    options?: Omit<RepoDeleteOptions<this>, "return">,
  ): Promise<RepoDeleteOrThrowResult<this>> {
    const item = await this.db.deleteOrThrow({
      table: this.tableName,
      key: this.extractKey(key),
      ...options,
    });
    return this.applyTransformIfNeeded(item);
  }

  async query<O extends RepoQueryOptions<this>>(
    query: RepoQueryQuery<this>,
    options?: O,
  ): Promise<RepoQueryResult<this, O>> {
    const items = await this.db.query({ table: this.tableName, query, ...options });
    return this.applyTransformsIfNeeded(items, options);
  }

  async *queryPaged<O extends RepoQueryOptions<this>>(
    query: RepoQueryQuery<this>,
    options?: O,
  ): RepoQueryPagedResult<this, O> {
    for await (const page of this.db.queryPaged({ table: this.tableName, query, ...options })) {
      yield this.applyTransformsIfNeeded(page, options);
    }
  }

  async queryGsi<G extends TableGsiNames<T>, O extends RepoQueryGsiOptions<this, T, G>>(
    gsi: G,
    query: RepoQueryGsiQuery<T, G>,
    options?: O,
  ): Promise<RepoQueryGsiResult<this, O, G>> {
    const items = await this.db.query({ table: this.tableName, index: gsi, query, ...options });
    return this.applyTransformsIfNeeded(items, { ...options, gsi });
  }

  async *queryGsiPaged<G extends TableGsiNames<T>, O extends RepoQueryGsiOptions<this, T, G>>(
    gsi: G,
    query: RepoQueryGsiQuery<T, G>,
    options?: O,
  ): RepoQueryGsiPagedResult<this, O, G> {
    for await (const page of this.db.queryPaged({
      table: this.tableName,
      index: gsi,
      query,
      ...options,
    })) {
      yield this.applyTransformsIfNeeded(page, { ...options, gsi });
    }
  }

  async scan<O extends RepoScanOptions<this>>(options?: O): Promise<RepoScanResult<this, O>> {
    const items = await this.db.scan({ table: this.tableName, ...options });
    return this.applyTransformsIfNeeded(items, options);
  }

  async *scanPaged<O extends RepoScanOptions<this>>(options?: O): RepoScanPagedResult<this, O> {
    for await (const page of this.db.scanPaged({ table: this.tableName, ...options })) {
      yield this.applyTransformsIfNeeded(page, options);
    }
  }

  async scanGsi<G extends TableGsiNames<T>, O extends RepoScanGsiOptions<this, T, G>>(
    gsi: G,
    options?: O,
  ): Promise<RepoScanGsiResult<this, O, G>> {
    const items = await this.db.scan({ table: this.tableName, index: gsi, ...options });
    return this.applyTransformsIfNeeded(items, { ...options, gsi });
  }

  async *scanGsiPaged<G extends TableGsiNames<T>, O extends RepoScanGsiOptions<this, T, G>>(
    gsi: G,
    options?: O,
  ): RepoScanGsiPagedResult<this, O, G> {
    for await (const page of this.db.scanPaged({
      table: this.tableName,
      index: gsi,
      ...options,
    })) {
      yield this.applyTransformsIfNeeded(page, { ...options, gsi });
    }
  }

  async exists(options?: RepoExistsOptions<this>): Promise<boolean> {
    return this.db.exists({
      table: this.tableName,
      projection: [this.table.def.partitionKey],
      ...options,
    });
  }

  async existsGsi(gsi: TableGsiNames<T>, options?: RepoExistsOptions<this>): Promise<boolean> {
    return this.db.exists({
      table: this.tableName,
      index: gsi,
      projection: [this.table.def.partitionKey],
      ...options,
    });
  }

  async batchGet<O extends RepoBatchGetOptions<this>>(
    keys: RepoKey<this>[],
    options?: O,
  ): Promise<RepoBatchGetResult<this, O>> {
    const { items, unprocessed } = await this.db.batchGet({
      // TODO: fix this as any assertion
      [this.tableName]: { keys: keys.map((key) => this.extractKey(key)), ...(options as any) },
    });
    const tableItems = items[this.tableName];
    return {
      items: tableItems && this.applyTransformsIfNeeded(tableItems, options),
      unprocessed: unprocessed?.[this.tableName]?.keys,
    } as RepoBatchGetResult<this, O>;
  }

  async batchGetOrThrow<O extends RepoBatchGetOptions<this>>(
    keys: RepoKey<this>[],
    options?: O,
  ): Promise<RepoBatchGetOrThrowResult<this, O>> {
    const result = await this.db.batchGetOrThrow({
      // TODO: fix this as any assertion
      [this.tableName]: { keys: keys.map((key) => this.extractKey(key)), ...(options as any) },
    });
    return this.applyTransformsIfNeeded(result[this.tableName] ?? [], options);
  }

  async batchWrite(requests: RepoBatchWrite<this>): Promise<RepoBatchWriteResult<this>> {
    const { items, unprocessed } = await this.db.batchWrite({
      [this.tableName]: requests.map((request) => {
        if (request.type === "DELETE") {
          return { type: "DELETE", key: this.extractKey(request.key) };
        } else {
          const itemWithDefaults = { ...this.defaultPutData, ...request.item };
          return { type: "PUT", item: itemWithDefaults };
        }
      }),
    });

    return {
      items: items[this.tableName],
      unprocessed: unprocessed?.[this.tableName],
    } as RepoBatchWriteResult<this>;
  }

  async trxGet<O extends RepoTrxGetOptions<this>>(
    keys: RepoKey<this>[],
    options?: O,
  ): Promise<RepoTrxGetResult<this, O>> {
    const items = await this.db.trxGet(
      ...keys.map((key) => ({
        table: this.tableName,
        key: this.extractKey(key),
        // TODO: fix this as any assertion
        ...(options as any),
      })),
    );
    return items.map((item: any) => item && this.applyTransformIfNeeded(item, options)) as any;
  }

  async trxGetOrThrow<O extends RepoTrxGetOptions<this>>(
    keys: RepoKey<this>[],
    options?: O,
  ): Promise<RepoTrxGetOrThrowResult<this, O>> {
    const items = await this.db.trxGetOrThrow(
      ...keys.map((key) => ({
        table: this.tableName,
        key: this.extractKey(key),
        // TODO: fix this as any assertion
        ...(options as any),
      })),
    );
    return this.applyTransformsIfNeeded(items, options);
  }

  async trxWrite(...requests: RepoTrxWriteRequest<this>[]): Promise<void> {
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

  async trxDelete(
    keys: RepoKey<this>[],
    options?: Omit<RepoDeleteOptions<this>, "return">,
  ): Promise<void> {
    return this.db.trxWrite(...keys.map((key) => this.trxDeleteRequest(key, options)));
  }

  // todo: return items
  async trxPut(
    items: RepoPutItem<this>[],
    options?: Omit<RepoPutOptions<this>, "return">,
  ): Promise<void> {
    return this.db.trxWrite(...items.map((item) => this.trxPutRequest(item, options)));
  }

  async trxUpdate(
    keys: RepoKey<this>[],
    update: RepoUpdateData,
    options?: Omit<RepoUpdateOptions<this>, "return">,
  ): Promise<void> {
    return this.db.trxWrite(...keys.map((key) => this.trxUpdateRequest(key, update, options)));
  }

  // todo: return items
  async trxCreate(items: RepoCreateItem<this>[], options?: RepoCreateOptions<this>): Promise<void> {
    return this.db.trxWrite(...items.map((item) => this.trxCreateRequest(item, options)));
  }

  trxGetRequest<O extends RepoGetOptions<this>>(
    key: RepoKey<this>,
    options?: O,
  ): DbTrxGetRequest<RepoGetOrThrowResult<this, O>> {
    // TODO: fix this as any assertion
    return { table: this.tableName, key: this.extractKey(key), ...(options as any) };
  }

  trxDeleteRequest(
    key: RepoKey<this>,
    options?: Omit<RepoDeleteOptions<this>, "return">,
  ): DbTrxWriteRequest {
    return { table: this.tableName, type: "DELETE", key: this.extractKey(key), ...options };
  }

  trxConditionRequest(
    key: RepoKey<this>,
    condition: Condition<ExtractTableSchema<T>>,
    options?: Omit<RepoDeleteOptions<this>, "return" | "condition">,
  ): DbTrxWriteRequest {
    return {
      table: this.tableName,
      type: "CONDITION",
      key: this.extractKey(key),
      condition,
      ...options,
    };
  }

  trxPutRequest(
    item: RepoPutItem<this>,
    options?: Omit<RepoPutOptions<this>, "return">,
  ): DbTrxWriteRequest {
    const itemWithDefaults = { ...this.defaultPutData, ...item };
    return { table: this.tableName, type: "PUT", item: itemWithDefaults, ...options };
  }

  trxUpdateRequest(
    key: RepoKey<this>,
    update: RepoUpdateData,
    options?: Omit<RepoUpdateOptions<this>, "return">,
  ): DbTrxWriteRequest {
    const updateWithDefaults = { ...this.defaultUpdateData, ...update };
    return {
      table: this.tableName,
      type: "UPDATE",
      key: this.extractKey(key),
      update: updateWithDefaults,
      ...options,
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

    const itemWithDefaults = { ...this.defaultPutData, ...item };

    return {
      table: this.tableName,
      type: "PUT",
      item: itemWithDefaults,
      condition,
      ...otherOptions,
    };
  }

  private applyTransformsIfNeeded(
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

    return items.map((item) => this.transformItem(item as ExtractTableSchema<T>));
  }

  private applyTransformIfNeeded(item: Obj, options?: { projection?: any[]; gsi?: string }): any {
    const [transformedItem] = this.applyTransformsIfNeeded([item], options);
    return transformedItem;
  }
}

export class Repo<T extends Table<any, any>> extends AbstractRepo<T> {
  readonly table: T;

  constructor(db: Db, table: T) {
    super(db);
    this.table = table;
  }
}
