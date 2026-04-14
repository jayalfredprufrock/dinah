---
title: Table
description: Reference for the Table class and TableDef options.
sidebar:
  order: 3
---

`Table` pairs a typebox schema with a `TableDef` describing keys, indexes, and physical properties. It is declarative: constructing a `Table` does not talk to DynamoDB.

```typescript
import { Type } from "typebox";
import { Table } from "dinah";

const UserTable = new Table(
  Type.Object({
    userId: Type.String(),
    email: Type.String(),
    role: Type.String(),
    createdAt: Type.Number(),
  }),
  {
    name: "users",
    partitionKey: "userId",
    gsis: {
      byEmail: { partitionKey: "email" },
      byRole: { partitionKey: "role", sortKey: "createdAt" },
    },
  },
);
```

## Constructor

```typescript
new Table<Schema extends TSchema, Def extends TableDef>(
  schema: Schema,
  def: Def,
)
```

- **`schema`** — a typebox schema describing the full shape of items in this table. Usually a `Type.Object({...})` or a `Type.Union([Type.Object(...), ...])` for heterogeneous tables.
- **`def`** — a `TableDef` describing the physical table. Its type is cross-validated against the schema: every key reference must be a valid field of the schema, and key fields must be `string` or `number`.

## Properties

- **`schema: Schema`** — the typebox schema.
- **`def: Def`** — the table definition as passed to the constructor.

## `TableDef` reference

```typescript
interface TableDef<T = any> {
  readonly name: string;
  readonly partitionKey: ValidPrimaryKeys<T>;
  readonly sortKey?: ValidPrimaryKeys<T>;
  readonly gsis?: Readonly<Record<string, Gsi<T>>>;
  readonly ttlAttribute?: ValidTtlKeys<T>;
  readonly billingMode?: "PAY_PER_REQUEST" | "PROVISIONED";
}
```

| Field | Type | Description |
| --- | --- | --- |
| `name` | `string` | Physical table name. Will be prefixed by `db.config.tableNamePrefix` at Repo runtime. |
| `partitionKey` | string (field name) | Required. Must be a `string` or `number` field on the schema. |
| `sortKey` | string (field name) | Optional. Must be a `string` or `number` field on the schema. |
| `gsis` | `Record<string, Gsi>` | Optional. GSI definitions keyed by index name. |
| `ttlAttribute` | string (field name) | Optional. Must be a `number` field (can be optional in the schema). `createTable` enables TTL on this attribute. |
| `billingMode` | `"PAY_PER_REQUEST"` \| `"PROVISIONED"` | Optional. Used by `createTable`. |

### `Gsi`

```typescript
interface Gsi<T> {
  readonly partitionKey: ValidGsiKeys<T> | readonly ValidGsiKeys<T>[];
  readonly sortKey?: ValidGsiKeys<T> | readonly ValidGsiKeys<T>[];
  readonly projection?: "ALL" | "KEYS_ONLY" | readonly AllKeys<T>[];
}
```

| Field | Type | Description |
| --- | --- | --- |
| `partitionKey` | `string \| string[]` | Required. A field name or array of up to 4 field names ([multi-key GSI](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GSI.html)). Each must be `string` or `number`. |
| `sortKey` | `string \| string[]` | Optional. A field name or array of up to 4 field names. Each must be `string` or `number`. |
| `projection` | `"ALL"` (default) \| `"KEYS_ONLY"` \| `string[]` | What DynamoDB stores in the index. The type of query/scan results is narrowed accordingly. |

## Type-level key validation

All key references on `TableDef` are validated at compile time:

```typescript
new Table(Schema, {
  name: "t",
  partitionKey: "nope",      // ts error: field doesn't exist on schema
  sortKey: "createdAt",      // ts error: createdAt is a boolean, not string/number
  gsis: {
    byStatus: {
      partitionKey: "status",
      projection: ["title", "nope"], // ts error: nope doesn't exist on schema
    },
  },
});
```

This catches typos and refactoring mistakes at the point of definition, not when you call the query at runtime.

## Union schemas

`Table` supports union schemas for heterogeneous tables (e.g. single-table-design layouts):

```typescript
const UnionTable = new Table(
  Type.Union([
    Type.Object({
      pk: Type.String(),
      sk: Type.String(),
      kind: Type.Literal("user"),
      email: Type.String(),
    }),
    Type.Object({
      pk: Type.String(),
      sk: Type.String(),
      kind: Type.Literal("post"),
      title: Type.String(),
    }),
  ]),
  {
    name: "entities",
    partitionKey: "pk",
    sortKey: "sk",
    gsis: {
      byKind: { partitionKey: "kind", sortKey: "sk" },
    },
  },
);
```

Fields required to be primary/sort keys must exist on every branch of the union. GSI keys only need to exist on at least one branch (they're `ValidGsiKeys`, which permits optional fields).
