import {
  type BatchGetItemInput,
  type BatchWriteItemInput,
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDB,
  DynamoDBClient,
  type DynamoDBClientConfig,
  ListTablesCommand,
  type WriteRequest,
} from "@aws-sdk/client-dynamodb";
//import { DynamoDBStreams } from '@aws-sdk/client-dynamodb-streams';
import type { TransactGetCommandInput, TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";
import * as Lib from "@aws-sdk/lib-dynamodb";
import sift from "sift";
import { ExpressionBuilder } from "./expression-builder";
import { Repo } from "./repo";
import type { Table } from "./table";
import type {
  DbBatchGet,
  DbBatchGetResponse,
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
  Obj,
} from "./types";
import { extractTableDesc, removeUndefined } from "./util";

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

export class Db {
  readonly client: Lib.DynamoDBDocumentClient;
  readonly config: DbConfig | undefined;

  //protected streamEventListeners: DbStreamEventListener[] = [];

  constructor(
    clientOrConfig: DynamoDBClient | DynamoDB | DynamoDBClientConfig,
    dbConfig?: DbConfig,
  ) {
    if (clientOrConfig instanceof DynamoDBClient || clientOrConfig instanceof DynamoDB) {
      this.client = Lib.DynamoDBDocumentClient.from(new DynamoDBClient(clientOrConfig));
    } else {
      const { endpoint, ...clientConfig } = clientOrConfig;
      // client doesn't interpret an empty string endpoint as falsy so normalize things
      // here so consumers don't have to worry about that quirk
      this.client = Lib.DynamoDBDocumentClient.from(
        new DynamoDBClient({
          endpoint: endpoint || undefined,
          ...clientConfig,
        }),
      );
    }

    this.config = dbConfig;
  }

  createRepo<T extends Table>(table: T): Repo<T> {
    return new Repo(this, table);
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

  async get<R = Obj>(data: DbGet): Promise<R | undefined> {
    const exp = new ExpressionBuilder();

    const input = new Lib.GetCommand({
      TableName: data.table,
      Key: data.key,
      ConsistentRead: data.consistent,
      ProjectionExpression: exp.projection(data.projection),
      ExpressionAttributeNames: exp.attributeNames,
    });

    const output = await this.client.send(input);

    if (output.Item && data.condition) {
      if (!sift(data.condition)(output.Item)) {
        return undefined;
      }
    }

    return output.Item as R;
  }

  async getOrThrow<R = Obj>(data: DbGet): Promise<R> {
    const item = await this.get(data);
    if (!item) {
      throw new Error(`Item not found in "${data.table}" table.`);
    }
    return item as R;
  }

  async put<R = Obj>(data: DbPut): Promise<R> {
    const exp = new ExpressionBuilder();

    const item = removeUndefined(data.item);

    const input = new Lib.PutCommand({
      TableName: data.table,
      Item: item,
      ReturnValues: data.returnOld ? "ALL_OLD" : "NONE",
      ReturnValuesOnConditionCheckFailure: "ALL_OLD",
      ConditionExpression: exp.condition(data.condition),
      ExpressionAttributeNames: exp.attributeNames,
      ExpressionAttributeValues: exp.attributeValues,
    });

    const output = await this.client.send(input);

    return (data.returnOld ? output.Attributes : item) as R;
  }

  async update<R = Obj>(data: DbUpdate): Promise<R> {
    const exp = new ExpressionBuilder();

    const condition = {
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
      UpdateExpression: exp.update(data.update),
      ConditionExpression: exp.condition(condition),
      ExpressionAttributeNames: exp.attributeNames,
      ExpressionAttributeValues: exp.attributeValues,
    });

    const output = await this.client.send(input);

    return output.Attributes as R;
  }

  async delete<R = Obj>(data: DbDelete): Promise<R | undefined> {
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

    const output = await this.client.send(input);

    return output.Attributes as R | undefined;
  }

  async deleteOrThrow<R = Obj>(data: DbDelete): Promise<R> {
    const item = await this.delete<R>(data);
    if (!item) {
      throw new Error(`Item not found in "${data.table}" table.`);
    }
    return item;
  }

  async *queryPaged<R = Obj>(data: DbQuery): AsyncGenerator<R[]> {
    const exp = new ExpressionBuilder();

    let lastEvaluatedKey = data.startKey;
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
        yield output.Items as R[];
      }
      lastEvaluatedKey = output.LastEvaluatedKey;
    } while (lastEvaluatedKey);
  }

  async query<R = Obj>(data: DbQuery): Promise<R[]> {
    const items: Obj[] = [];

    for await (const page of this.queryPaged(data)) {
      items.push(...page);
    }

    return items as R[];
  }

  async *scanPaged<R = Obj>(data: DbScan): AsyncGenerator<R[]> {
    const exp = new ExpressionBuilder();

    const totalSegments = data.parallel ?? 1;
    const segments = [...Array(totalSegments).keys()];

    // undefined: initial value when a start key isn't specified
    // null: scanning a particular segment is finished
    const lastEvaluatedKeys: (Obj | undefined | null)[] = segments.map(() => data.startKey);
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
        yield items as R[];
      }
    } while (lastEvaluatedKeys.some((key) => key !== null));
  }

  async scan<R = Obj>(data: DbScan): Promise<R[]> {
    const items: R[] = [];

    for await (const page of this.scanPaged(data)) {
      items.push(...(page as R[]));
    }

    return items;
  }

  async exists(data: DbExists): Promise<boolean> {
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

  // TODO: test wildly different item sizes to make
  // sure retry algorithm works properly
  async batchGet(data: DbBatchGet): Promise<DbBatchGetResponse> {
    const result: DbBatchGetResponse = { items: {} };

    const tableData = Object.fromEntries(
      Object.entries(data).map(([table, request]) => {
        const exp = new ExpressionBuilder();
        const sifter = request?.condition ? sift(request?.condition) : undefined;

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
            sifter,
          },
        ];
      }),
    );

    const flattenedBatches = Object.entries(data).flatMap(([table, request]) => {
      return request.keys.map((key, i) => {
        const itemIndexKey =
          tableData[table]?.keyNames.map((keyName) => key[keyName]).join("|") ?? "";
        tableData[table]?.itemIndexMap.set(itemIndexKey, i);
        return [table, key] as const;
      });
    });

    let batchSize = 100;
    let retryCount = 0;

    while (flattenedBatches.length && retryCount < 5) {
      const batch = flattenedBatches.splice(0, batchSize || 1);

      const request: BatchGetItemInput["RequestItems"] = {};
      for (const [table, key] of batch) {
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

        for (const item of items) {
          // items that fail the condition are treated the same as non-existent keys,
          // i.e. they are not present in items/unprocessed arrays
          if (tableData[table]?.sifter && !tableData[table].sifter(item)) {
            continue;
          }

          result.items[table].push(item);
        }
      }

      // handle unprocessed requests
      let unprocessedKeyCount = 0;
      for (const [table, request] of Object.entries(output.UnprocessedKeys ?? {})) {
        const unprocessed = (request.Keys ?? []).map((key) => [table, key] as const);
        flattenedBatches.push(...unprocessed);
        unprocessedKeyCount += unprocessed.length;
      }

      //move immediately to next batch if all requests were processed
      if (!unprocessedKeyCount) {
        retryCount = 0;
        continue;
      }

      // reduce batch size so we don't continue to overfetch,
      // but do it gradually by only splitting the difference
      batchSize -= Math.floor(unprocessedKeyCount / 2);

      retryCount++;
    }

    // anything left in flattened batches needs to be returned in unprocessed
    if (flattenedBatches.length) {
      result.unprocessed = {};
      for (const [table, key] of flattenedBatches) {
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
        const item1IndexKey = keyNames.map((keyName) => item1[keyName]).join("|");
        const item2IndexKey = keyNames.map((keyName) => item2[keyName]).join("|");

        return (itemIndexMap.get(item1IndexKey) ?? 0) - (itemIndexMap.get(item2IndexKey) ?? 0);
      });
    }

    return result;
  }

  async batchGetOrThrow(data: DbBatchGet): Promise<DbBatchGetResponse["items"]> {
    const { items, unprocessed } = await this.batchGet(data);

    for (const table of Object.keys(data)) {
      if (unprocessed?.[table]) {
        throw new Error(`One or more batch get requests were not processed in "${table}" table.`);
      }

      if (items[table]?.length !== data[table]?.keys?.length) {
        throw new Error(`One or more items were not found in "${table}" table.`);
      }
    }

    return items;
  }

  // TODO: test wildly different item sizes to make
  // sure retry algorithm works properly
  async batchWrite(data: DbBatchWrite): Promise<DbBatchWriteResponse> {
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

    let batchSize = 25;
    let retryCount = 0;

    while (flattenedBatches.length && retryCount < 5) {
      const batch = flattenedBatches.splice(0, batchSize || 1);

      const request: BatchWriteItemInput["RequestItems"] = {};
      for (const [table, req] of batch) {
        if (!request[table]) {
          request[table] = [];
        }
        request[table].push(req);
      }

      const input = new Lib.BatchWriteCommand({ RequestItems: request });
      const output = await this.client.send(input);

      // handle unprocessed requests
      let unprocessedKeyCount = 0;
      for (const [table, requests] of Object.entries(output.UnprocessedItems ?? {})) {
        for (const request of requests) {
          flattenedBatches.push([table, request]);
          unprocessedKeyCount++;
        }
      }

      //move immediately to next batch if all requests were processed
      if (!unprocessedKeyCount) {
        retryCount = 0;
        continue;
      }

      // reduce batch size so we don't continue to overwrite,
      // but do it gradually by only splitting the difference
      batchSize -= Math.floor(unprocessedKeyCount / 2);

      retryCount++;
    }

    // anything left in flattened batches needs to be returned in unprocessed
    if (flattenedBatches.length) {
      result.unprocessed = {};
      for (const [table, request] of flattenedBatches) {
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
        if (requests[i]?.condition && !sift(requests[i].condition)(response.Item)) {
          return undefined;
        }

        return response.Item;
      }) as DbTrxGetResult<R>) ?? []
    );
  }

  async trxGetOrThrow<R extends DbTrxGetRequest[]>(
    ...requests: R
  ): Promise<DbTrxGetOrThrowResult<R>> {
    const items = await this.trxGet(...requests);
    for (let i = 0; i < items.length; i++) {
      if (!items[i]) {
        throw new Error(`One or more items were not found in "${requests[i]?.table}" table.`);
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
          UpdateExpression: exp.update(request.update),
          ConditionExpression: exp.condition(request.condition),
          ExpressionAttributeNames: exp.attributeNames,
          ExpressionAttributeValues: exp.attributeValues,
        },
      };
    });

    const input = new Lib.TransactWriteCommand({ TransactItems: trxItems });
    await this.client.send(input);
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
