import type {
  AttributeDefinition,
  CreateTableCommandInput,
  ProjectionType,
} from "@aws-sdk/client-dynamodb";
import * as T from "typebox";
import type { DiscriminatedUnionSchema, Obj } from "./types";
import type { Table } from "./table";

const collectAttrTypes = (schema: T.TSchema | T.TEnumValue, attrName: string): ("S" | "N")[] => {
  if (T.IsString(schema) || T.IsLiteralString(schema) || typeof schema === "string") {
    return ["S"];
  }

  if (
    T.IsNumber(schema) ||
    T.IsLiteralNumber(schema) ||
    T.IsInteger(schema) ||
    typeof schema === "number"
  ) {
    return ["N"];
  }

  if (T.IsObject(schema)) {
    const attrSchema = schema.properties[attrName];
    return attrSchema ? collectAttrTypes(attrSchema, attrName) : [];
  }

  if (T.IsUnion(schema)) {
    return schema.anyOf.flatMap((s) => collectAttrTypes(s, attrName));
  }

  if (T.IsIntersect(schema)) {
    return schema.allOf.flatMap((s) => collectAttrTypes(s, attrName));
  }

  if (T.IsEnum(schema)) {
    return schema.enum.flatMap((s) => collectAttrTypes(s, attrName));
  }

  return [];
};

/**
 * `T.Union(variants)` annotated with its discriminator. `T.Union`'s options don't reach its
 * return type, so this keeps the literal name in the type for repos to narrow on.
 */
export const DiscriminatedUnion = <
  const V extends T.TSchema[],
  D extends keyof T.Static<T.TUnion<V>> & string,
>(
  propertyName: D,
  variants: [...V],
  options?: T.TSchemaOptions,
): DiscriminatedUnionSchema<D, V> =>
  T.Union(variants, { ...options, discriminator: { propertyName } }) as DiscriminatedUnionSchema<
    D,
    V
  >;

/** The discriminator a schema is annotated with, or `undefined`. */
export const discriminatorOf = (schema: unknown): string | undefined => {
  if (!T.IsUnion(schema)) return undefined;
  const name = (schema as { discriminator?: { propertyName?: unknown } }).discriminator
    ?.propertyName;
  return typeof name === "string" ? name : undefined;
};

export const resolveAttrType = (schema: T.TSchema | T.TEnumValue, attrName: string): "S" | "N" => {
  const [firstType, ...otherTypes] = collectAttrTypes(schema, attrName);

  if (!firstType) {
    throw new Error(`Attribute "${attrName}" not found.`);
  }

  if (otherTypes.some((t) => t !== firstType)) {
    throw new Error(`Attribute "${attrName}" type not consistent.`);
  }

  return firstType;
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

export const matchesPartial = <T extends object>(partial: Partial<T>, item: T): boolean =>
  (Object.entries(partial) as [keyof T, unknown][]).every(([k, v]) => item[k] === v);

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

/**
 * Structural equality matching DynamoDB's `=` semantics for the values the
 * document client produces: map key order is irrelevant, list order matters,
 * sets compare unordered, binary compares bytewise. An absent key and an
 * `undefined` value are treated as equal, since neither is stored.
 */
export const deepEqual = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;

  if (a instanceof Set || b instanceof Set) {
    if (!(a instanceof Set && b instanceof Set) || a.size !== b.size) return false;
    for (const v of a) {
      if (!b.has(v) && ![...b].some((w) => deepEqual(v, w))) return false;
    }
    return true;
  }

  if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) {
    if (!(ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) || a.byteLength !== b.byteLength) {
      return false;
    }
    const x = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const y = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    return x.every((byte, i) => byte === y[i]);
  }

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!(Array.isArray(a) && Array.isArray(b)) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }

  const ao = a as Obj;
  const bo = b as Obj;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const k of keys) {
    if (!deepEqual(ao[k], bo[k])) return false;
  }
  return true;
};
