import type {
  AttributeDefinition,
  CreateTableCommandInput,
  ProjectionType,
} from "@aws-sdk/client-dynamodb";
import { type TSchema } from "typebox";
import * as T from "typebox/type";
import type { Obj } from "./types";
import type { Table } from "./table";

export const resolveAttrType = (schema: TSchema, attrName: string): "S" | "N" => {
  if (T.IsString(schema) || T.IsLiteralString(schema)) {
    return "S";
  }

  if (T.IsNumber(schema) || T.IsLiteralNumber(schema) || T.IsInteger(schema)) {
    return "N";
  }

  if (T.IsObject(schema)) {
    const attrSchema = schema.properties[attrName];
    if (!attrSchema) {
      throw new Error(`Attribute "${attrName}" not found.`);
    }
    return resolveAttrType(attrSchema, attrName);
  }

  if (T.IsIntersect(schema) || T.IsUnion(schema)) {
    const schemas = T.IsUnion(schema) ? schema.anyOf : schema.allOf;
    const [firstType, ...otherTypes] = schemas.flatMap((s) => resolveAttrType(s, attrName));
    if (!firstType || otherTypes.some((t) => t !== firstType)) {
      throw new Error(`Attribute "${attrName}" type not consistent.`);
    }

    return firstType;
  }

  throw new Error(`Unable to resolve type for attribute "${attrName}"`);
};

export const extractTableDesc = (table: Table): CreateTableCommandInput => {
  const attributes = new Map<string, AttributeDefinition>();

  const setAttributes = (
    attrNames: (string | undefined)[],
    keyType: "HASH" | "RANGE",
  ): { AttributeName: string; KeyType: "HASH" | "RANGE" }[] => {
    return attrNames.flatMap((attrName) => {
      if (!attrName) return [];
      attributes.set(attrName, {
        AttributeName: attrName,
        AttributeType: resolveAttrType(table.schema, attrName),
      });
      return { AttributeName: attrName, KeyType: keyType };
    });
  };

  let gsis: CreateTableCommandInput["GlobalSecondaryIndexes"];
  if (table.def.gsis) {
    gsis = Object.entries(table.def.gsis ?? {}).map(([indexName, gsi]) => {
      return {
        IndexName: indexName,
        KeySchema: [
          ...setAttributes([gsi.partitionKey].flat(), "HASH"),
          ...setAttributes([gsi.sortKey].flat(), "RANGE"),
        ],
        Projection: {
          ProjectionType: (Array.isArray(gsi.projection)
            ? "INCLUDE"
            : (gsi.projection ?? "ALL")) as ProjectionType,
          NonKeyAttributes: Array.isArray(gsi.projection) ? gsi.projection : undefined,
        },
      };
    });
  }

  // attribute definitions need to go AFTER key schemas since
  // are built while resolving the rest of the configuration
  return {
    TableName: table.def.name,
    KeySchema: [
      ...setAttributes([table.def.partitionKey], "HASH"),
      ...setAttributes([table.def.sortKey], "RANGE"),
    ],
    GlobalSecondaryIndexes: gsis,
    AttributeDefinitions: [...attributes.values()],
    BillingMode: table.def.billingMode,
    StreamSpecification: table.def.stream
      ? { StreamEnabled: true, StreamViewType: table.def.stream }
      : undefined,
  };
};

export const chunk = <T = unknown>(arr: T[], chunkSize: number): T[][] => {
  if (chunkSize <= 0) return [];

  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += chunkSize) {
    chunks.push(arr.slice(i, i + chunkSize));
  }

  return chunks;
};

// this currently creates sparse arrays if an undefined
// value is found inside an array...not sure if thats valid?
export const removeUndefined = (obj: Obj) => {
  const stack = [obj];
  while (stack.length) {
    const currentObj = stack.pop();
    if (currentObj !== undefined) {
      Object.entries(currentObj).forEach(([k, v]) => {
        if (v && v instanceof Object) stack.push(v);
        else if (v === undefined) delete currentObj[k];
      });
    }
  }
  return obj;
};
