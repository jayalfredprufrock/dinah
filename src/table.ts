import {
  type AttributeDefinition,
  CreateTableCommand,
  DeleteTableCommand,
  type KeySchemaElement,
  UpdateTimeToLiveCommand,
} from "@aws-sdk/client-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { Static, TSchema } from "typebox";
//import { Table as CdkTable, type GlobalSecondaryIndexProps, type TableProps } from 'aws-cdk-lib/aws-dynamodb';
//import type { Construct } from 'constructs';
import type { TableDef, TableKey } from "./types";
import { extractTableDesc } from "./util";

export class Table<
  Schema extends TSchema = TSchema,
  Def extends TableDef<Static<Schema>> = TableDef<Static<Schema>>,
> {
  readonly schema: TSchema;
  readonly def: TableDef;

  constructor(schema: Schema, def: Def) {
    this.schema = schema;
    this.def = def;
  }

  async drop(client: DynamoDBDocumentClient): Promise<void> {
    await client.send(new DeleteTableCommand({ TableName: this.def.name }));
  }

  async createTable(client: DynamoDBDocumentClient): Promise<void> {
    const desc = extractTableDesc(this.schema, this.def);

    const attributes = new Map<string, AttributeDefinition>();
    const setAttribute = (tableKey: TableKey) => {
      attributes.set(tableKey.name, { AttributeName: tableKey.name, AttributeType: tableKey.type });
    };

    const keySchema: KeySchemaElement[] = [
      { AttributeName: desc.partitionKey.name, KeyType: "HASH" },
    ];
    setAttribute(desc.partitionKey);

    if (desc.sortKey) {
      keySchema.push({ AttributeName: desc.sortKey.name, KeyType: "RANGE" });
      setAttribute(desc.sortKey);
    }

    const gsis = desc.gsis?.map((gsi) => {
      const gsiKeySchema: KeySchemaElement[] = [
        { AttributeName: gsi.partitionKey.name, KeyType: "HASH" },
      ];
      setAttribute(gsi.partitionKey);
      if (gsi.sortKey) {
        gsiKeySchema.push({ AttributeName: gsi.sortKey.name, KeyType: "RANGE" });
        setAttribute(gsi.sortKey);
      }
      return {
        IndexName: gsi.indexName,
        KeySchema: gsiKeySchema,
        Projection: {
          ProjectionType: gsi.projectionType,
          NonKeyAttributes: gsi.nonKeyAttributes,
        },
      };
    });

    await client.send(
      new CreateTableCommand({
        TableName: desc.tableName,
        KeySchema: keySchema,
        AttributeDefinitions: [...attributes.values()],
        BillingMode: desc.billingMode,
        GlobalSecondaryIndexes: gsis,
        StreamSpecification: desc.stream
          ? {
              StreamEnabled: true,
              StreamViewType: desc.stream,
            }
          : undefined,
      }),
    );

    if (desc.ttlAttribute) {
      await client.send(
        new UpdateTimeToLiveCommand({
          TableName: desc.tableName,
          TimeToLiveSpecification: {
            Enabled: true,
            AttributeName: desc.ttlAttribute,
          },
        }),
      );
    }
  }

  /*
	createCdkTable(construct: Construct): CdkTable {
		const { ttlAttribute, gsis = [], ...tableProps } = extractTableDesc(this.schema, this.def);

		const table = new CdkTable(construct, `${tableProps.tableName}-table`, {
			...(tableProps as TableProps),
			timeToLiveAttribute: ttlAttribute,
		});

		for (const gsi of gsis) {
			table.addGlobalSecondaryIndex(gsi as GlobalSecondaryIndexProps);
		}

		return table;
	}
	*/
}
