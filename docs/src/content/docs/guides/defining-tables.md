---
title: Defining Tables
description: Describing schemas, keys, GSIs, and TTL with the Table class.
sidebar:
  order: 2
---

A `Table` is constructed from a typebox schema and a `TableDef` object. Everything in the `TableDef` is type-checked against the schema — you can only reference fields that actually exist, and primary/sort keys must be `string` or `number`.

```typescript
import { Type } from "typebox";
import { Table } from "dinah";

const PostTable = new Table(
  Type.Object({
    postId: Type.String(),
    authorId: Type.String(),
    publishedAt: Type.Number(),
    status: Type.Union([Type.Literal("draft"), Type.Literal("published")]),
    title: Type.String(),
    body: Type.String(),
    tags: Type.Array(Type.String()),
    expiresAt: Type.Optional(Type.Number()),
  }),
  {
    name: "posts",
    partitionKey: "postId",
    gsis: {
      byAuthor: {
        partitionKey: "authorId",
        sortKey: "publishedAt",
      },
      byStatus: {
        partitionKey: "status",
        sortKey: "publishedAt",
        projection: ["title", "authorId"],
      },
    },
    ttlAttribute: "expiresAt",
    billingMode: "PAY_PER_REQUEST",
  },
);
```

## `TableDef` options

| Option | Required | Description |
| --- | --- | --- |
| `name` | Yes | Physical table name. The `Repo` will prefix this with `db.config.tableNamePrefix` if one is configured. |
| `partitionKey` | Yes | Name of a `string` or `number` field on the schema. Validated at the type level. |
| `sortKey` | No | Name of a `string` or `number` field. |
| `gsis` | No | Map of GSI name → GSI definition. See [GSIs](#gsis) below. |
| `ttlAttribute` | No | Name of a `number` field on the schema. Enabled when you call `table.createTable(client)`. |
| `billingMode` | No | `"PAY_PER_REQUEST"` or `"PROVISIONED"`. Used by `createTable`. |

## GSIs

Each entry in `gsis` is a `Gsi` object:

| Field | Required | Description |
| --- | --- | --- |
| `partitionKey` | Yes | A field name or array of up to 4 field names. Each must be `string` or `number`. |
| `sortKey` | No | A field name or array of up to 4 field names. Each must be `string` or `number`. |
| `projection` | No | `"ALL"` (default), `"KEYS_ONLY"`, or an array of attribute names to include. |

### Multi-key GSIs

DynamoDB supports [multi-attribute keys](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GSI.html) on GSIs — up to 4 partition key attributes and 4 sort key attributes. This eliminates synthetic composite strings like `TENANT#123#REGION#US`.

```typescript
const MatchTable = new Table(
  Type.Object({
    matchId: Type.String(),
    tournamentId: Type.String(),
    region: Type.String(),
    round: Type.String(),
    bracket: Type.String(),
    score: Type.Number(),
  }),
  {
    name: "matches",
    partitionKey: "matchId",
    gsis: {
      byTournament: {
        partitionKey: ["tournamentId", "region"],
        sortKey: ["round", "bracket"],
      },
    },
  },
);
```

When querying a multi-key GSI, all partition key attributes are required. Sort key attributes are optional but must be specified left-to-right — you can't skip one in the middle:

```typescript
// All PK fields required
await repo.queryGsi("byTournament", { tournamentId: "WINTER2024", region: "NA-EAST" });

// First sort key
await repo.queryGsi("byTournament", {
  tournamentId: "WINTER2024",
  region: "NA-EAST",
  round: "SEMIFINALS",
});

// First + second sort key
await repo.queryGsi("byTournament", {
  tournamentId: "WINTER2024",
  region: "NA-EAST",
  round: "SEMIFINALS",
  bracket: "UPPER",
});
```

Dinah enforces the left-to-right constraint at the type level — passing `bracket` without `round` won't compile.

### Projection types

`projection` controls which attributes DynamoDB stores in the index and therefore which attributes come back from a `queryGsi` / `scanGsi` call. Dinah reflects this in the return type:

```typescript
const PostTable = new Table(schema, {
  name: "posts",
  partitionKey: "postId",
  gsis: {
    // Default: ALL — full item is returned.
    byAuthor: { partitionKey: "authorId", sortKey: "publishedAt" },

    // KEYS_ONLY — only the table's primary key + GSI keys are returned.
    byStatusKeysOnly: {
      partitionKey: "status",
      sortKey: "publishedAt",
      projection: "KEYS_ONLY",
    },

    // INCLUDE — table keys + GSI keys + explicitly listed attributes.
    byStatusSummary: {
      partitionKey: "status",
      projection: ["title", "authorId"],
    },
  },
});
```

Dinah narrows return types accordingly:

```typescript
// Post[]  — full items
const all = await repo.queryGsi("byAuthor", { authorId: "u1" });

// Pick<Post, 'postId' | 'authorId' | 'publishedAt' | 'status'>[]  — keys only
const keys = await repo.queryGsi("byStatusKeysOnly", { status: "published" });

// Pick<Post, 'title' | 'authorId' | 'postId' | 'status'>[]  — listed attrs + keys
const summary = await repo.queryGsi("byStatusSummary", { status: "published" });
```

### GSI query arguments

The `query` argument to `queryGsi` is typed to:

- **Require** the GSI partition key.
- **Optionally accept** the GSI sort key, with any comparison operator (`$eq`, `$gt`, `$between`, `$prefix`, …).
- **Reject** any other field as a top-level key condition.

Filtering on non-key attributes goes in `options.filter` instead.

### GSI startKey

When you pass `startKey` to resume pagination on a GSI, DynamoDB requires the full composite key: the table's primary key **and** the GSI's key. Dinah's types enforce this:

```typescript
await repo.queryGsi(
  "byAuthor",
  { authorId: "u1" },
  {
    startKey: {
      postId: "p42",     // table PK
      authorId: "u1",    // GSI PK
      publishedAt: 1700, // GSI SK
    },
  },
);
```

If the GSI has no sort key, its sort key is omitted from the `startKey` type. If the table has no sort key, the table sort key is omitted too.

## Creating the physical table

`Table` doesn't touch DynamoDB on construction. To provision the table and its GSIs, call `createTable` on the `Db` instance:

```typescript
await db.createTable(PostTable);
```

This issues a `CreateTable` command with the key schema, GSIs, and billing mode from the `TableDef`, and enables TTL if `ttlAttribute` is set. Use `db.deleteTable(tableName)` to tear it down.

`createTable` is primarily useful for local development and tests — in production you'll usually provision tables through CloudFormation, Terraform, CDK, or similar.

## Default values on write

`TableDef` is purely structural — it doesn't carry write-time hooks. To attach defaults like `createdAt` / `updatedAt` to every write, subclass `AbstractRepo` and override `defaultPutData` / `defaultUpdateData`. See [Subclassing Repos](/guides/subclassing-repos/).
