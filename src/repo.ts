import type { Db } from "./db";
import type { Table } from "./table";
import type { DbTrxGetRequest, DbTrxWriteRequest } from "./db.types";
import type {
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
  TableGsiNames,
} from "./repo.types";
import type { Condition, ExtractTableDef, ExtractTableSchema, Obj } from "./types";
import { isOperation } from "./expression-builder";

// TODO: query/queryGsi needs strongly typed "key" argument
// allows =,>,>=,<,<=,begins_with, between on sort key
// util -> extractExclusiveStartKey(item)

export class Repo<T extends Table> {
  // these phantom properties are used to pre-compute types derived from T
  // which allows easy lookups using the "this" Repo type
  declare readonly $schema: ExtractTableSchema<T>;
  declare readonly $def: ExtractTableDef<T>;

  readonly table: T;
  readonly db: Db;
  constructor(db: Db, table: T) {
    this.db = db;
    this.table = table;
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

  transformOutput(item: ExtractTableSchema<T>): ExtractTableSchema<T> {
    return item;
  }

  transformInput(item: Partial<ExtractTableSchema<T>>): Partial<ExtractTableSchema<T>> {
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
    } as any);
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
    } as any);
    return this.applyTransformIfNeeded(item, options);
  }

  async put(item: RepoPutItem<this>, options?: RepoPutOptions<this>): Promise<RepoPutResult<this>> {
    const itemWithDefaults = this.transformInput({ ...this.defaultPutData, ...item });
    const result = await this.db.put({ table: this.tableName, item: itemWithDefaults, ...options });
    return this.applyTransformIfNeeded(result);
  }

  async update(
    key: RepoKey<this>,
    update: RepoUpdateData<ExtractTableSchema<T>>,
    options?: RepoUpdateOptions<this>,
  ): Promise<RepoUpdateResult<this>> {
    const updateWithDefaults = this.applyNormalizersToExpression({
      ...this.defaultUpdateData,
      ...update,
    });
    const result = await this.db.update({
      table: this.tableName,
      key: this.extractKey(key),
      update: updateWithDefaults as any,
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
    const items = await this.db.query({ table: this.tableName, query, ...options } as any);
    return this.applyTransformsIfNeeded(items, options);
  }

  async *queryPaged<O extends RepoQueryOptions<this>>(
    query: RepoQueryQuery<this>,
    options?: O,
  ): RepoQueryPagedResult<this, O> {
    for await (const page of this.db.queryPaged({
      table: this.tableName,
      query,
      ...options,
    } as any)) {
      yield this.applyTransformsIfNeeded(page, options);
    }
  }

  async queryGsi<G extends TableGsiNames<T>, O extends RepoQueryGsiOptions<this, T, G>>(
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
    } as any)) {
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
    const items = await this.db.scan({ table: this.tableName, index: gsi, ...options } as any);
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
    } as any)) {
      yield this.applyTransformsIfNeeded(page, { ...options, gsi });
    }
  }

  async exists(options?: RepoExistsOptions<this>): Promise<boolean> {
    return this.db.exists({
      table: this.tableName,
      projection: [this.table.def.partitionKey] as any,
      ...options,
    });
  }

  async existsGsi(gsi: TableGsiNames<T>, options?: RepoExistsOptions<this>): Promise<boolean> {
    return this.db.exists({
      table: this.tableName,
      index: gsi,
      projection: [this.table.def.partitionKey] as any,
      ...options,
    });
  }

  async batchGet<O extends RepoBatchGetOptions<this>>(
    keys: RepoKey<this>[],
    options?: O,
  ): Promise<RepoBatchGetResult<this, O>> {
    const { items, unprocessed } = await this.db.batchGet({
      [this.tableName]: { keys: keys.map((key) => this.extractKey(key)), ...options },
    } as any);
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
      [this.tableName]: { keys: keys.map((key) => this.extractKey(key)), ...options },
    } as any);
    return this.applyTransformsIfNeeded(result[this.tableName] ?? [], options);
  }

  async batchWrite(requests: RepoBatchWrite<this>): Promise<RepoBatchWriteResult<this>> {
    const { items, unprocessed } = await this.db.batchWrite({
      [this.tableName]: requests.map((request) => {
        if (request.type === "DELETE") {
          return { type: "DELETE", key: this.extractKey(request.key) };
        } else {
          const itemWithDefaults = this.transformInput({ ...this.defaultPutData, ...request.item });
          return { type: "PUT", item: itemWithDefaults };
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
    update: RepoUpdateData<ExtractTableSchema<T>>,
  ): Promise<RepoBatchUpdateResult<this>> {
    const updateWithDefaults = this.applyNormalizersToExpression({
      ...this.defaultUpdateData,
      ...update,
    });
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

  async trxGet<O extends RepoTrxGetOptions<this>>(
    keys: RepoKey<this>[],
    options?: O,
  ): Promise<RepoTrxGetResult<this, O>> {
    const items = await this.db.trxGet(
      ...keys.map(
        (key) =>
          ({
            table: this.tableName,
            key: this.extractKey(key),
            ...options,
          }) as any,
      ),
    );
    return items.map((item: any) => item && this.applyTransformIfNeeded(item, options)) as any;
  }

  async trxGetOrThrow<O extends RepoTrxGetOptions<this>>(
    keys: RepoKey<this>[],
    options?: O,
  ): Promise<RepoTrxGetOrThrowResult<this, O>> {
    const items = await this.db.trxGetOrThrow(
      ...keys.map(
        (key) =>
          ({
            table: this.tableName,
            key: this.extractKey(key),
            ...options,
          }) as any,
      ),
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
    update: RepoUpdateData<ExtractTableSchema<T>>,
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
    return { table: this.tableName, key: this.extractKey(key), ...options } as any;
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
    const itemWithDefaults = this.transformInput({ ...this.defaultPutData, ...item });
    return { table: this.tableName, type: "PUT", item: itemWithDefaults, ...options };
  }

  trxUpdateRequest(
    key: RepoKey<this>,
    update: RepoUpdateData<ExtractTableSchema<T>>,
    options?: Omit<RepoUpdateOptions<this>, "return">,
  ): DbTrxWriteRequest {
    const updateWithDefaults = this.applyNormalizersToExpression({
      ...this.defaultUpdateData,
      ...update,
    });
    return {
      table: this.tableName,
      type: "UPDATE",
      key: this.extractKey(key),
      update: updateWithDefaults as any,
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

    const itemWithDefaults = this.transformInput({ ...this.defaultPutData, ...item });

    return {
      table: this.tableName,
      type: "PUT",
      item: itemWithDefaults,
      condition,
      ...otherOptions,
    };
  }

  private applyNormalizersToExpression(expression: Obj): Obj {
    const partial: Obj = {};
    for (const [key, val] of Object.entries(expression)) {
      if (val === undefined) continue;
      if (!isOperation(val)) {
        partial[key] = val;
      } else if (val.$set !== undefined) {
        partial[key] = val.$set;
      } else if (val.$ifNotExists !== undefined) {
        partial[key] = Array.isArray(val.$ifNotExists) ? val.$ifNotExists[1] : val.$ifNotExists;
      }
    }

    const normalized = this.transformInput(partial as Partial<ExtractTableSchema<T>>);

    const result = { ...expression };
    for (const [key, normalizedVal] of Object.entries(normalized)) {
      if (key in partial) {
        const original = expression[key];
        if (!isOperation(original)) {
          result[key] = normalizedVal;
        } else if ((original as Obj).$set !== undefined) {
          result[key] = { ...(original as Obj), $set: normalizedVal };
        } else if ((original as Obj).$ifNotExists !== undefined) {
          result[key] = {
            ...(original as Obj),
            $ifNotExists: Array.isArray((original as Obj).$ifNotExists)
              ? [(original as Obj).$ifNotExists[0], normalizedVal]
              : normalizedVal,
          };
        }
      } else if (normalizedVal !== undefined) {
        result[key] = normalizedVal;
      }
    }

    return result;
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

export interface MakeRepoResult<T extends Table> {
  new (db: Db): Repo<T>;
  readonly table: T;
}

export const makeRepo = <T extends Table>(table: T): MakeRepoResult<T> => {
  return class extends Repo<T> {
    static readonly table = table;
    constructor(db: Db) {
      super(db, table);
    }
  };
};
