import {
  type BatchGetItemInput,
  type BatchWriteItemInput,
  ConditionalCheckFailedException,
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDB,
  DynamoDBClient,
  type DynamoDBClientConfig,
  ListTablesCommand,
  TransactionCanceledException,
  type WriteRequest,
} from "@aws-sdk/client-dynamodb";
import { runBatched } from "./batch";
import { type BatchStatementFailure, DinahError } from "./error";
//import { DynamoDBStreams } from '@aws-sdk/client-dynamodb-streams';
import type { TransactGetCommandInput, TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";
import * as Lib from "@aws-sdk/lib-dynamodb";
import { ExpressionBuilder } from "./expression-builder";
import { Repo, type RepoConfig, type ValidComputedMap } from "./repo";
import type { Table } from "./table";
import type {
  DbBatchGet,
  DbBatchOptions,
  DbBatchGetResponse,
  DbBatchUpdate,
  DbBatchUpdateResponse,
  DbBatchWrite,
  DbBatchWriteResponse,
  DbConfig,
  DbDelete,
  DbExists,
  DbGet,
  DbListTables,
  DbPut,
  DbQuery,
  DbScan,
  DbTrxGetOrThrowResult,
  DbTrxGetRequest,
  DbTrxGetResult,
  DbTrxWriteRequest,
  DbUpdate,
} from "./db.types";
import type { AllKeys, ExtractTableSchema, Obj } from "./types";
import { extractTableDesc, matchesPartial, removeUndefined } from "./util";

// TODO
// - caching support?
// - consider special "limit" handling for paged scans, maybe have "scanLimit" too
// - consider "sort" shorthand for methods that return unpaginated collections
//   i.e. sort: { by: 'createdAt', dir: 'ASC' } or sort: (a,b) => a.createdAt - b.createdAt
// - consider support for batchUpdates leveraging BatchExecute and PartiQL
// - consider batchPut (batchPutOrThrow) and batchDelete that operate on a single table
// - getGsi? throws if > 1 result, allows for assert, and filtering
// - bug $in doesn't handle empty arrays, I imagine other operators are affected
// - consider beforeCreate, beforePut, beforeUpdate, beforeDelete, after, etc.
// - type out repo update data
// - does it handle nested undefined removal? nested $remove
// - maybe extract resourceName from schema?
// - maybe repos with discriminators should have options like defaultCreateData and defaultUpdateData return
//   an object keyed by the discriminator value...?

/**
 * Stable identity for a primary key, used to spot the duplicates DynamoDB
 * rejects. Driven off a fixed `keyNames` list rather than each object's own
 * property order, so two objects describing the same key always agree, and
 * JSON-encoded per value so a numeric `1` and a string `"1"` stay distinct.
 */
const keyIdentity = (keyNames: string[], source: Obj): string =>
  keyNames.map((name) => JSON.stringify(source[name])).join("\u0000");

/**
 * PartiQL `BatchExecuteStatement` reports per-statement failures inline rather
 * than as a request error. Only these codes are transient; everything else
 * (ValidationError, ConditionalCheckFailed, ResourceNotFound, DuplicateItem,
 * AccessDenied, ItemCollectionSizeLimitExceeded) is a permanent failure that
 * must be surfaced instead of retried.
 */
const RETRYABLE_STATEMENT_ERROR_CODES = new Set<string>([
  "InternalServerError",
  "ProvisionedThroughputExceeded",
  "RequestLimitExceeded",
  "ThrottlingError",
  "TransactionConflict",
]);

export class Db {
  readonly client: Lib.DynamoDBDocumentClient;
  readonly config: DbConfig | undefined;

  //protected streamEventListeners: DbStreamEventListener[] = [];

  constructor(
    clientOrConfig: DynamoDBClient | DynamoDB | Lib.DynamoDBDocumentClient | DynamoDBClientConfig,
    dbConfig?: DbConfig,
  ) {
    // Every field of DynamoDBClientConfig is optional, so any object satisfies
    // that branch structurally — these instance checks are what actually
    // discriminate the union, and a missed one silently falls through to
    // "treat this client as a bag of config", producing a default client.
    if (clientOrConfig instanceof Lib.DynamoDBDocumentClient) {
      // Already a document client (possibly with its own translateConfig) —
      // wrapping it again would double up the marshalling middleware.
      this.client = clientOrConfig;
    } else if (clientOrConfig instanceof DynamoDBClient) {
      // Covers DynamoDB too, which extends DynamoDBClient. Wrap the caller's
      // client rather than reconstructing one from it: a client instance only
      // exposes `config` / `middlewareStack` / `handlers` at the top level, so
      // `new DynamoDBClient(client)` would silently discard their region,
      // endpoint, credentials and retry settings.
      this.client = Lib.DynamoDBDocumentClient.from(clientOrConfig);
    } else {
      const { endpoint, ...clientConfig } = clientOrConfig;
      // client doesn't interpret an empty string endpoint as falsy so normalize things
      // here so consumers don't have to worry about that quirk
      this.client = Lib.DynamoDBDocumentClient.from(
        new DynamoDBClient({
          ...(endpoint ? { endpoint } : {}),
          ...clientConfig,
        }),
      );
    }

    this.config = dbConfig;
  }

  private normalizeUpdate(expression: Obj): Obj {
    const behavior = this.config?.updateUndefinedBehavior ?? "throw";
    if (behavior === "throw") return expression;
    const entries = Object.entries(expression);
    if (behavior === "strip") return Object.fromEntries(entries.filter(([, v]) => v !== undefined));
    return Object.fromEntries(
      entries.map(([k, v]) => [k, v === undefined ? { $remove: true } : v]),
    );
  }

  makeRepo<
    T extends Table,
    TDefaults extends Partial<ExtractTableSchema<T>> = {},
    TUpdateDefaults extends Partial<ExtractTableSchema<T>> = {},
    TOutput = ExtractTableSchema<T>,
    const TComputed extends ValidComputedMap<ExtractTableSchema<T>, TComputed> = {},
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
  ): Repo<T, TDefaults, TUpdateDefaults, TOutput, TComputed, TImmutable, TDiscriminator> {
    return new Repo(this, table, config);
  }

  async createTable(table: Table): Promise<void> {
    await this.client.send(new CreateTableCommand(extractTableDesc(table)));
  }

  async deleteTable(tableName: string): Promise<void> {
    await this.client.send(new DeleteTableCommand({ TableName: tableName }));
  }

  async listTables(data?: DbListTables): Promise<string[]> {
    const tables: string[] = [];
    let lastEvaluatedTableName: string | undefined;
    do {
      const output = await this.client.send(
        new ListTablesCommand({
          Limit: data?.limit,
          ExclusiveStartTableName: lastEvaluatedTableName,
        }),
      );

      tables.push(...(output.TableNames ?? []));
      lastEvaluatedTableName = output.LastEvaluatedTableName;
    } while (lastEvaluatedTableName);
    return tables;
  }

  async get<T = Obj>(data: DbGet<T>): Promise<T | undefined> {
    const exp = new ExpressionBuilder();

    const input = new Lib.GetCommand({
      TableName: data.table,
      Key: data.key,
      ConsistentRead: data.consistent,
      ProjectionExpression: exp.projection(data.projection),
      ExpressionAttributeNames: exp.attributeNames,
    });

    const output = await this.client.send(input);

    if (output.Item && data.filter && !matchesPartial(data.filter as any, output.Item as any)) {
      return undefined;
    }

    return output.Item as T;
  }

  async getOrThrow<T = Obj>(data: DbGet<T>): Promise<T> {
    const item = await this.get<T>(data);
    if (!item) {
      throw new DinahError({
        type: "NOT_FOUND",
        key: data.key as Record<string, unknown>,
        resource: data.resource,
      });
    }
    return item;
  }

  async put<T = Obj>(data: DbPut<T>): Promise<T> {
    const exp = new ExpressionBuilder();

    const item = removeUndefined(data.item as Obj);

    const input = new Lib.PutCommand({
      TableName: data.table,
      Item: item,
      ReturnValues: data.returnOld ? "ALL_OLD" : "NONE",
      ReturnValuesOnConditionCheckFailure: "ALL_OLD",
      ConditionExpression: exp.condition(data.condition),
      ExpressionAttributeNames: exp.attributeNames,
      ExpressionAttributeValues: exp.attributeValues,
    });

    try {
      const output = await this.client.send(input);
      return (data.returnOld ? output.Attributes : item) as T;
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) {
        throw new DinahError(
          { type: "CONDITIONAL_CHECK_FAILED", resource: data.resource },
          { cause: err },
        );
      }
      throw err;
    }
  }

  async update<T = Obj>(data: DbUpdate<T>): Promise<T> {
    const exp = new ExpressionBuilder();

    const condition: any = {
      $and: Object.keys(data.key).map((field) => ({
        [field]: { $exists: true },
      })),
    };

    if (data.condition) {
      condition.$and.push(data.condition);
    }

    const input = new Lib.UpdateCommand({
      TableName: data.table,
      Key: data.key,
      ReturnValues: "ALL_NEW",
      ReturnValuesOnConditionCheckFailure: "ALL_OLD",
      UpdateExpression: exp.update(this.normalizeUpdate(data.update as Obj)),
      ConditionExpression: exp.condition(condition),
      ExpressionAttributeNames: exp.attributeNames,
      ExpressionAttributeValues: exp.attributeValues,
    });

    try {
      const output = await this.client.send(input);
      return output.Attributes as T;
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) {
        throw new DinahError(
          {
            type: "CONDITIONAL_CHECK_FAILED",
            key: data.key as Record<string, unknown>,
            resource: data.resource,
          },
          { cause: err },
        );
      }
      throw err;
    }
  }

  async delete<T = Obj>(data: DbDelete<T>): Promise<T | undefined> {
    const exp = new ExpressionBuilder();

    const input = new Lib.DeleteCommand({
      TableName: data.table,
      Key: data.key,
      ReturnValues: "ALL_OLD",
      ConditionExpression: exp.condition(data.condition),
      ReturnValuesOnConditionCheckFailure: "ALL_OLD",
      ExpressionAttributeNames: exp.attributeNames,
      ExpressionAttributeValues: exp.attributeValues,
    });

    try {
      const output = await this.client.send(input);
      return output.Attributes as T | undefined;
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) {
        throw new DinahError(
          {
            type: "CONDITIONAL_CHECK_FAILED",
            key: data.key as Record<string, unknown>,
            resource: data.resource,
          },
          { cause: err },
        );
      }
      throw err;
    }
  }

  async deleteOrThrow<T = Obj>(data: DbDelete<T>): Promise<T> {
    const item = await this.delete<T>(data);
    if (!item) {
      throw new DinahError({
        type: "NOT_FOUND",
        key: data.key as Record<string, unknown>,
        resource: data.resource,
      });
    }
    return item;
  }

  async *queryPaged<T = Obj>(data: DbQuery<T>): AsyncGenerator<T[]> {
    const exp = new ExpressionBuilder();

    let lastEvaluatedKey: Obj | undefined = data.startKey as Obj | undefined;
    do {
      const input = new Lib.QueryCommand({
        TableName: data.table,
        IndexName: data.index,
        ExclusiveStartKey: lastEvaluatedKey,
        Limit: data.limit,
        ScanIndexForward: data.sort !== "DESC",
        ConsistentRead: data.consistent,
        KeyConditionExpression: exp.condition(data.query),
        ProjectionExpression: exp.projection(data.projection),
        FilterExpression: exp.condition(data.filter),
        ExpressionAttributeNames: exp.attributeNames,
        ExpressionAttributeValues: exp.attributeValues,
      });

      const output = await this.client.send(input);

      if (output.Items?.length) {
        yield output.Items as T[];
      }
      lastEvaluatedKey = output.LastEvaluatedKey;
    } while (lastEvaluatedKey);
  }

  async query<T = Obj>(data: DbQuery<T>): Promise<T[]> {
    const items: T[] = [];

    for await (const page of this.queryPaged(data)) {
      items.push(...page);
    }

    return items;
  }

  async *scanPaged<T = Obj>(data: DbScan<T>): AsyncGenerator<T[]> {
    const exp = new ExpressionBuilder();

    const totalSegments = data.parallel ?? 1;
    const segments = [...Array(totalSegments).keys()];

    // undefined: initial value when a start key isn't specified
    // null: scanning a particular segment is finished
    const lastEvaluatedKeys: (Obj | undefined | null)[] = segments.map(
      () => data.startKey as Obj | undefined,
    );
    do {
      const results = await Promise.all(
        segments.map(async (segment) => {
          if (lastEvaluatedKeys[segment] === null) return [];

          const input = new Lib.ScanCommand({
            ExclusiveStartKey: lastEvaluatedKeys[segment],
            Segment: segment,
            TotalSegments: totalSegments,
            TableName: data.table,
            IndexName: data.index,
            Limit: data.limit,
            ConsistentRead: data.consistent,
            ProjectionExpression: exp.projection(data.projection),
            FilterExpression: exp.condition(data.filter),
            ExpressionAttributeNames: exp.attributeNames,
            ExpressionAttributeValues: exp.attributeValues,
          });

          const output = await this.client.send(input);
          lastEvaluatedKeys[segment] = output.LastEvaluatedKey ?? null;
          return output.Items ?? [];
        }),
      );

      const items = results.flat();

      if (items.length) {
        yield items as T[];
      }
    } while (lastEvaluatedKeys.some((key) => key !== null));
  }

  async scan<T = Obj>(data: DbScan<T>): Promise<T[]> {
    const items: T[] = [];

    for await (const page of this.scanPaged(data)) {
      items.push(...(page as T[]));
    }

    return items;
  }

  async exists<T = Obj>(data: DbExists<T>): Promise<boolean> {
    const { query, ...otherOptions } = data;

    // we can't rely on the limit when a filter is being applied, since the filter is
    // applied after the scan/query page, so we only apply a limit of 1 when there is no filter.
    // otherwise, we page through the results and return true as soon as we see a single item
    const sharedOptions = {
      ...otherOptions,
      limit: data.filter ? undefined : 1,
    };

    const pagedItems = query
      ? this.queryPaged({ query, ...sharedOptions })
      : this.scanPaged(sharedOptions);

    for await (const items of pagedItems) {
      if (items.length) return true;
    }

    return false;
  }

  // Chunks are a constant 100 keys, but DynamoDB also caps a response at 16MB,
  // which 100 large items can exceed — the overflow comes back in
  // `UnprocessedKeys` even though nothing was throttled. That can't be avoided
  // by sizing the chunk, since a get only holds keys and the response size
  // isn't knowable until it arrives. The retry loop absorbs it: each pass
  // returns what fit, which is progress, so it converges in a few round trips
  // without touching the stall budget. See tests/batch-retry.test.ts.
  async batchGet(data: DbBatchGet, options?: DbBatchOptions): Promise<DbBatchGetResponse> {
    const result: DbBatchGetResponse = { items: {} };

    const tableData = Object.fromEntries(
      Object.entries(data).map(([table, request]) => {
        const exp = new ExpressionBuilder();

        result.items[table] = [];

        return [
          table,
          {
            request: {
              ConsistentRead: request?.consistent,
              ProjectionExpression: exp.projection(request?.projection),
              ExpressionAttributeNames: exp.attributeNames,
            },
            keyNames: Object.keys(request.keys.at(0) ?? {}),
            itemIndexMap: new Map<string, number>(),
            filter: request.filter,
          },
        ];
      }),
    );

    // Duplicate keys are dropped rather than rejected. DynamoDB refuses a
    // request containing the same key twice, and chunking makes that
    // position-dependent: repeats inside one chunk raise a ValidationException
    // while repeats straddling a boundary quietly return the item more than
    // once. Neither is useful, and a repeated read carries no information, so
    // the first occurrence wins and the rest are discarded. Contrast
    // `batchWrite` / `batchUpdate`, where collapsing a repeat would change
    // what the caller asked for.
    const flattenedBatches = Object.entries(data).flatMap(([table, request]) => {
      const seen = new Set<string>();

      return request.keys.flatMap((key, i) => {
        const itemIndexKey = keyIdentity(tableData[table]?.keyNames ?? [], key);
        if (seen.has(itemIndexKey)) return [];

        seen.add(itemIndexKey);
        tableData[table]?.itemIndexMap.set(itemIndexKey, i);
        return [[table, key] as const];
      });
    });

    const leftover = await runBatched(
      flattenedBatches,
      async (chunk) => {
        const request: BatchGetItemInput["RequestItems"] = {};
        for (const [table, key] of chunk) {
          if (!request[table]) {
            request[table] = { ...tableData[table]?.request, Keys: [] };
          }

          request[table].Keys?.push(key);
        }

        const input = new Lib.BatchGetCommand({ RequestItems: request });
        const output = await this.client.send(input);

        for (const [table, items] of Object.entries(output.Responses ?? {})) {
          //just to appease typescript
          if (!result.items[table]) continue;

          const filteredItems = tableData[table]?.filter
            ? items.filter((item) => matchesPartial(tableData[table]!.filter as any, item as any))
            : items;

          result.items[table].push(...filteredItems);
        }

        return Object.entries(output.UnprocessedKeys ?? {}).flatMap(([table, request]) =>
          (request.Keys ?? []).map((key) => [table, key] as const),
        );
      },
      { limit: 100, ...options },
    );

    // anything the service couldn't process needs to be returned in unprocessed
    if (leftover.length) {
      result.unprocessed = {};
      for (const [table, key] of leftover) {
        if (!result.unprocessed[table]) {
          result.unprocessed[table] = {
            ...tableData[table]?.request,
            keys: [],
          };
        }
        result.unprocessed[table].keys.push(key);
      }
    }

    // finally, sort any returned items by their original index to preserve order
    for (const [table, items] of Object.entries(result.items)) {
      const itemIndexMap = tableData[table]?.itemIndexMap;
      const keyNames = tableData[table]?.keyNames;

      if (!itemIndexMap || !keyNames) continue;

      items.sort((item1, item2) => {
        const item1IndexKey = keyIdentity(keyNames, item1);
        const item2IndexKey = keyIdentity(keyNames, item2);

        return (itemIndexMap.get(item1IndexKey) ?? 0) - (itemIndexMap.get(item2IndexKey) ?? 0);
      });
    }

    return result;
  }

  async batchGetOrThrow(
    data: DbBatchGet,
    options?: DbBatchOptions,
  ): Promise<DbBatchGetResponse["items"]> {
    const { items, unprocessed } = await this.batchGet(data, options);

    for (const table of Object.keys(data)) {
      if (unprocessed?.[table]) {
        throw new Error(`One or more batch get requests were not processed in "${table}" table.`);
      }

      // Compared against *distinct* keys, since batchGet collapses repeats.
      const requestedKeys = data[table]?.keys ?? [];
      const distinctRequested = new Set(
        requestedKeys.map((key) => keyIdentity(Object.keys(requestedKeys.at(0) ?? {}), key)),
      ).size;

      if (items[table]?.length !== distinctRequested) {
        // Key identity is not tracked through batchGet — key: {} is a known limitation here.
        throw new DinahError({ type: "NOT_FOUND", key: {}, resource: data[table]?.resource });
      }
    }

    return items;
  }

  // Item size can't push a write chunk over DynamoDB's 16MB request cap: 25
  // items at the 400KB per-item maximum is 10MB. Unlike batchGet, unprocessed
  // items here always mean throttling.
  async batchWrite(data: DbBatchWrite, options?: DbBatchOptions): Promise<DbBatchWriteResponse> {
    const result: DbBatchWriteResponse = { items: {} };

    const flattenedBatches = Object.keys(data).flatMap((table) => {
      return (
        data[table]?.map((r) => {
          if (r.type === "DELETE") {
            return [table, { DeleteRequest: { Key: r.key } }] as [string, WriteRequest];
          } else {
            return [table, { PutRequest: { Item: r.item } }] as [string, WriteRequest];
          }
        }) ?? []
      );
    });

    const leftover = await runBatched(
      flattenedBatches,
      async (chunk) => {
        const request: BatchWriteItemInput["RequestItems"] = {};
        for (const [table, req] of chunk) {
          if (!request[table]) {
            request[table] = [];
          }
          request[table].push(req);
        }

        const input = new Lib.BatchWriteCommand({ RequestItems: request });
        const output = await this.client.send(input);

        return Object.entries(output.UnprocessedItems ?? {}).flatMap(([table, requests]) =>
          requests.map((request) => [table, request] as [string, WriteRequest]),
        );
      },
      { limit: 25, ...options },
    );

    // anything the service couldn't process needs to be returned in unprocessed
    if (leftover.length) {
      result.unprocessed = {};
      for (const [table, request] of leftover) {
        if (!result.unprocessed[table]) {
          result.unprocessed[table] = [];
        }

        if ("DeleteRequest" in request && request.DeleteRequest?.Key) {
          result.unprocessed[table].push({
            type: "DELETE",
            key: request.DeleteRequest.Key,
          });
        } else if ("PutRequest" in request && request.PutRequest?.Item) {
          result.unprocessed[table].push({
            type: "PUT",
            item: request.PutRequest.Item,
          });
        }
      }
    }

    return result;
  }

  /**
   * `batchWrite`, but throws a `BATCH_UNPROCESSED` {@link DinahError} instead of
   * returning leftovers. Prefer this for bulk/operator jobs, where silently
   * dropping part of the write is worse than failing.
   */
  async batchWriteOrThrow(data: DbBatchWrite, options?: DbBatchOptions): Promise<void> {
    const { unprocessed } = await this.batchWrite(data, options);

    if (unprocessed) {
      throw new DinahError({
        type: "BATCH_UNPROCESSED",
        unprocessed: Object.fromEntries(
          Object.entries(unprocessed).map(([table, requests]) => [table, requests.length]),
        ),
      });
    }
  }

  async batchUpdate(data: DbBatchUpdate, options?: DbBatchOptions): Promise<DbBatchUpdateResponse> {
    // Rejected rather than deduplicated: an update expression need not be
    // idempotent (`{ count: { $plus: 1 } }` twice is not the same as once), so
    // silently dropping a repeat would change the result the caller asked for.
    const queue = Object.entries(data).flatMap(([table, req]) => {
      const keyNames = Object.keys(req.keys.at(0) ?? {});
      const seen = new Set<string>();

      return req.keys.map((key) => {
        const identity = keyIdentity(keyNames, key);
        if (seen.has(identity)) {
          throw new DinahError({
            type: "VALIDATION",
            message:
              `batchUpdate received the same key twice for table "${table}": ${JSON.stringify(key)}. ` +
              `DynamoDB rejects a batch containing two operations on one item, and an update may not ` +
              `be idempotent, so duplicates are not dropped automatically.`,
          });
        }
        seen.add(identity);

        return [table, key, req.update] as [string, Obj, Obj];
      });
    });

    // Permanent per-statement errors are collected rather than retried — a
    // ValidationException or a failed conditional check will never succeed on
    // a second attempt, and retrying it burns the stall budget that genuine
    // throttling needs.
    const failures: BatchStatementFailure[] = [];

    const leftover = await runBatched(
      queue,
      async (chunk) => {
        const statements = chunk.map(([table, key, update]) => {
          const exp = new ExpressionBuilder();
          const { sets, removes, params } = exp.partiqlUpdate(this.normalizeUpdate(update));

          const whereParts: string[] = [];
          for (const [field, value] of Object.entries(key)) {
            whereParts.push(`"${field}"=?`);
            params.push(value);
          }

          const clauses = [
            ...sets.map((s) => `SET ${s}`),
            ...removes.map((r) => `REMOVE ${r}`),
          ].join(" ");

          return {
            Statement: `UPDATE "${table}" ${clauses} WHERE ${whereParts.join(" AND ")}`,
            Parameters: params,
          };
        });

        const output = await this.client.send(
          new Lib.BatchExecuteStatementCommand({ Statements: statements }),
        );

        const retry: [string, Obj, Obj][] = [];
        output.Responses?.forEach((response, i) => {
          const entry = chunk[i];
          if (!response.Error || !entry) return;

          if (RETRYABLE_STATEMENT_ERROR_CODES.has(response.Error.Code ?? "")) {
            retry.push(entry);
          } else {
            failures.push({
              table: entry[0],
              key: entry[1],
              code: response.Error.Code,
              message: response.Error.Message,
            });
          }
        });

        return retry;
      },
      { limit: 25, ...options },
    );

    if (failures.length) {
      throw new DinahError({ type: "BATCH_FAILED", failures });
    }

    if (leftover.length) {
      const unprocessed: DbBatchUpdate = {};
      for (const [table, key, update] of leftover) {
        if (!unprocessed[table]) {
          unprocessed[table] = { keys: [], update };
        }
        unprocessed[table].keys.push(key);
      }
      return { unprocessed };
    }

    return {};
  }

  async trxGet<R extends DbTrxGetRequest[]>(...requests: R): Promise<DbTrxGetResult<R>> {
    const trxItems: TransactGetCommandInput["TransactItems"] = requests.map((request) => {
      const exp = new ExpressionBuilder();
      return {
        Get: {
          Key: request.key,
          TableName: request.table,
          ProjectionExpression: exp.projection(request?.projection),
          ExpressionAttributeNames: exp.attributeNames,
        },
      };
    });

    const input = new Lib.TransactGetCommand({ TransactItems: trxItems });
    const output = await this.client.send(input);

    return (
      (output.Responses?.map((response, i) => {
        if (!response.Item) return;

        if (!requests[i]?.filter) return response.Item;

        return matchesPartial(requests[i].filter!, response.Item as any)
          ? response.Item
          : undefined;
      }) as DbTrxGetResult<R>) ?? []
    );
  }

  async trxGetOrThrow<R extends DbTrxGetRequest[]>(
    ...requests: R
  ): Promise<DbTrxGetOrThrowResult<R>> {
    const items = await this.trxGet(...requests);
    for (let i = 0; i < items.length; i++) {
      if (!items[i]) {
        throw new DinahError({
          type: "NOT_FOUND",
          key: (requests[i]?.key ?? {}) as Record<string, unknown>,
          resource: requests[i]?.resource,
        });
      }
    }

    return items as DbTrxGetOrThrowResult<R>;
  }

  async trxWrite(...requests: DbTrxWriteRequest[]): Promise<void> {
    const trxItems: TransactWriteCommandInput["TransactItems"] = requests.map((request) => {
      const exp = new ExpressionBuilder();

      if (request.type === "CONDITION" || request.type === "DELETE") {
        return {
          [request.type === "CONDITION" ? "ConditionCheck" : "Delete"]: {
            TableName: request.table,
            Key: request.key,
            ConditionExpression: exp.condition(request.condition),
            ExpressionAttributeNames: exp.attributeNames,
            ExpressionAttributeValues: exp.attributeValues,
          },
        };
      }

      if (request.type === "PUT") {
        return {
          Put: {
            TableName: request.table,
            Item: removeUndefined(request.item),
            ConditionExpression: exp.condition(request.condition),
            ExpressionAttributeNames: exp.attributeNames,
            ExpressionAttributeValues: exp.attributeValues,
          },
        };
      }

      return {
        Update: {
          Key: request.key,
          TableName: request.table,
          UpdateExpression: exp.update(this.normalizeUpdate(request.update as Obj)),
          ConditionExpression: exp.condition(request.condition),
          ExpressionAttributeNames: exp.attributeNames,
          ExpressionAttributeValues: exp.attributeValues,
        },
      };
    });

    const input = new Lib.TransactWriteCommand({ TransactItems: trxItems });
    try {
      await this.client.send(input);
    } catch (err) {
      if (err instanceof TransactionCanceledException) {
        throw new DinahError(
          {
            type: "TRANSACTION_CANCELED",
            reasons: (err.CancellationReasons ?? []).map((r) => ({
              type: r.Code ?? "Unknown",
              message: r.Message,
            })),
          },
          { cause: err },
        );
      }
      throw err;
    }
  }

  /* Dynamodb Streams */

  /*

	async enableStreamEvents(data?: DbEnableEventStreams): Promise<void> {
		const tables = data?.tables ?? (await this.listTables());

		const streamsClient = new DynamoDBStreams({
			endpoint: this.client.config.endpoint,
			credentials: this.client.config.credentials,
			region: this.client.config.region,
		});

		await Promise.all(
			tables.map(async (table) => {
				const tableDesc = await this.client.send(new DescribeTableCommand({ TableName: table }));

				const latestStreamArn = tableDesc.Table?.LatestStreamArn;

				if (!latestStreamArn) {
					if (data?.tables) {
						throw new Error(`Table "${table}" does not have streaming enabled.`);
					}
					return;
				}

				const eventStreamer = new EventStreamer(streamsClient, latestStreamArn);
				eventStreamer.startPolling();
			}),
		);
	}

	async disableStreamEvents(): Promise<void> {}

	subscribe(listener: DbStreamEventListener): void {
		this.streamEventListeners.push(listener);
	}

	unsubscribe(listener: DbStreamEventListener): void {
		this.streamEventListeners = this.streamEventListeners.filter((l) => l !== listener);
	}

	unsubscribeAll(): void {
		this.streamEventListeners = [];
	}
	*/
}

// respondentRepo.onChange((respondent) => , { filter: (r1, r2) => r1.status !== r2.status } )
/*
const time = new Date(record.dynamodb.ApproximateCreationDateTime).getTime();
if (time >= startTime) {
	for (const listener of this.streamEventListeners) {
		listener({
			table,
			time,
			id: record.eventID,
			type: record.eventName,
			key: record.dynamodb.Keys,
			oldItem: record.dynamodb.OldImage,
			newItem: record.dynamodb.NewImage,
		});
	}
}
*/
