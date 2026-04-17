import type { Table } from "./table";
import * as cdk from "aws-cdk-lib/aws-dynamodb";
import { resolveAttrType } from "./util";
import type { TSchema } from "typebox";

export const resolveAttrs = (
  schema: TSchema,
  attrNames: (string | undefined)[],
): cdk.Attribute[] | undefined => {
  const names = attrNames.filter((name) => name !== undefined);
  if (!names.length) return undefined;
  return names.map((name) => ({
    name,
    type:
      resolveAttrType(schema, name) === "S" ? cdk.AttributeType.STRING : cdk.AttributeType.NUMBER,
  }));
};

export const extractTableCdkConfig = (
  table: Table,
): Pick<
  cdk.TablePropsV2,
  "tableName" | "partitionKey" | "sortKey" | "timeToLiveAttribute" | "globalSecondaryIndexes"
> => {
  const { schema, def } = table;

  const globalSecondaryIndexes = def.gsis
    ? Object.entries(def.gsis).map(([indexName, gsi]) => ({
        indexName,
        partitionKeys: resolveAttrs(schema, [gsi.partitionKey].flat()),
        sortKeys: resolveAttrs(schema, [gsi.sortKey].flat()),
      }))
    : undefined;

  return {
    tableName: def.name,
    partitionKey: resolveAttrs(schema, [def.partitionKey])?.at(0)!,
    sortKey: resolveAttrs(schema, [def.sortKey])?.at(0),
    timeToLiveAttribute: def.ttlAttribute,
    //billing: def.billingMode as cdk.BillingMode,
    // stream: def.stream as cdk.StreamViewType,
    globalSecondaryIndexes,
  };
};
