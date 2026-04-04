import type { AttributeDefinition } from "@aws-sdk/client-dynamodb";
import { type TSchema } from "typebox";
import * as T from "typebox";
import type { Obj, ResolvedAttrType, TableDef, TableDesc, TableGsi, TableKey } from "./types";

export const resolveAttrType = (schema: TSchema, attrName: string): ResolvedAttrType => {
  if (T.IsString(schema) || T.IsLiteralString(schema)) {
    return T.IsOptional(schema) ? ["S", undefined] : ["S"];
  }

  if (T.IsNumber(schema) || T.IsLiteralNumber(schema)) {
    return T.IsOptional(schema) ? ["N", undefined] : ["N"];
  }

  if (T.IsObject(schema)) {
    const attrSchema = schema.properties[attrName];
    if (!attrSchema) return [undefined];
    return resolveAttrType(attrSchema, attrName);
  }

  if (T.IsIntersect(schema)) {
    return schema.allOf.flatMap((s) => resolveAttrType(s, attrName));
  }

  if (T.IsUnion(schema)) {
    return schema.anyOf.flatMap((s) => resolveAttrType(s, attrName));
  }

  return [];
};

export const getAttrType = (
  schema: TSchema,
  attrName: string,
  allowedTypes: ResolvedAttrType = ["S", "N", undefined],
): "S" | "N" => {
  const resolvedType = resolveAttrType(schema, attrName);
  if (resolvedType.includes("S") && resolvedType.includes("N")) {
    throw new Error(`Attribute ${attrName} cannot be both a number and a string.`);
  }
  if (!allowedTypes.includes(undefined) && resolvedType.includes(undefined)) {
    throw new Error(`Attribute ${attrName} cannot be optional.`);
  }
  return resolvedType.includes("S") ? "S" : "N";
};

export const extractAttribute = (
  schema: TSchema,
  attrName: string,
  allowedTypes?: ResolvedAttrType,
): AttributeDefinition => {
  return {
    AttributeName: attrName,
    AttributeType: getAttrType(schema, attrName, allowedTypes),
  };
};

export const extractTableKey = (
  schema: TSchema,
  attrName: string,
  allowedTypes?: ResolvedAttrType,
): TableKey => {
  return {
    name: attrName,
    type: getAttrType(schema, attrName, allowedTypes),
  };
};

export const extractTableDesc = (schema: TSchema, def: TableDef): TableDesc => {
  const gsis: TableGsi[] = Object.entries(def.gsis ?? {}).map(([indexName, gsi]) => {
    return {
      indexName,
      partitionKey: extractTableKey(schema, gsi.partitionKey),
      sortKey: gsi.sortKey ? extractTableKey(schema, gsi.sortKey) : undefined,
      projectionType: Array.isArray(gsi.projection) ? "INCLUDE" : (gsi.projection ?? "ALL"),
      nonKeyAttributes: Array.isArray(gsi.projection) ? gsi.projection : undefined,
    };
  });

  return {
    tableName: def.name,
    billingMode: def.billingMode ?? "PAY_PER_REQUEST",
    stream: def.stream,
    partitionKey: extractTableKey(schema, def.partitionKey, ["N", "S"]),
    sortKey: def.sortKey ? extractTableKey(schema, def.sortKey, ["N", "S"]) : undefined,
    gsis: gsis.length ? gsis : undefined,
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
