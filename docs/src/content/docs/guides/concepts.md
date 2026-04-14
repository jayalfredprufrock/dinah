---
title: Concepts
description: How Db, Table, and Repo fit together.
sidebar:
  order: 1
---

Dinah has three core classes. Each has a distinct role, and you'll interact with all three in a typical application.

## Db

`Db` is the low-level client. It owns the underlying `DynamoDBDocumentClient` and exposes untyped methods that accept a `table` name directly:

```typescript
const db = new Db({ region: "us-east-1" });

await db.put({ table: "users", item: { userId: "u1", name: "Alice" } });
const user = await db.get<{ userId: string; name: string }>({
  table: "users",
  key: { userId: "u1" },
});
```

You use `Db` directly when:

- You don't have (or don't want) a typebox schema for the table.
- You're writing utility code that works against multiple tables generically.
- You need `listTables`, cross-table `batchGet` / `batchWrite`, or cross-table `trxGet` / `trxWrite`.

See the [`Db` reference](/reference/db/) for all methods.

## Table

`Table` is a declarative description of a single DynamoDB table. It pairs a typebox schema with a `TableDef` describing the name, primary key, optional sort key, GSIs, TTL attribute, and billing mode:

```typescript
const UserTable = new Table(
  Type.Object({ userId: Type.String(), email: Type.String() }),
  {
    name: "users",
    partitionKey: "userId",
    gsis: { byEmail: { partitionKey: "email" } },
  },
);
```

A `Table` holds no connection and does not talk to DynamoDB on its own. It is pure data: the schema and the definition. You pass it to `db.createRepo(table)` to get a typed `Repo`, or to `db.createTable(table)` to provision the physical table.

`Table`'s type parameters enforce that every key reference is valid against the schema. If you write `partitionKey: "nope"` and `nope` is not a string or number field on the schema, the `Table` constructor call will not compile.

See the [`Table` reference](/reference/table/).

## Repo

`Repo` is a typed facade over `Db` for a specific `Table`. It knows the table name, primary key shape, GSI definitions, and full item type, and uses that knowledge to:

- Extract primary key attributes from values you pass in (`extractKey`).
- Infer return types for `get`, `query`, `scan`, and their GSI / paged variants.
- Narrow return types when you pass a `projection` option, or when a GSI has a `KEYS_ONLY` / `INCLUDE` projection.
- Validate GSI query arguments (partition key required, sort key optional) and `startKey` shapes.
- Provide transaction helpers that return typed request objects.

You usually get a `Repo` via `db.createRepo(table)`:

```typescript
const userRepo = db.createRepo(UserTable);
await userRepo.put({ userId: "u1", email: "alice@example.com", /* … */ });
```

See the [`Repo` reference](/reference/repo/) for every method.

### AbstractRepo

Under the hood, `Repo` is a concrete implementation of an `AbstractRepo<Table>` base class. You can subclass `AbstractRepo` directly when you want to:

- Add computed fields to returned items (`transformItem`).
- Set default values on every put (`defaultPutData`).
- Set default values on every update (`defaultUpdateData`, e.g. `updatedAt`).
- Expose custom, domain-specific methods that reuse the repo's typed primitives.

```typescript
import { AbstractRepo } from "dinah";

class UserRepo extends AbstractRepo<typeof UserTable> {
  readonly table = UserTable;

  override get defaultPutData() {
    return { createdAt: Date.now() };
  }

  override get defaultUpdateData() {
    return { updatedAt: Date.now() };
  }

  override transformItem(user: User): User & { displayName: string } {
    return { ...user, displayName: user.name || user.email };
  }

  async findByEmail(email: string) {
    return this.queryGsi("byEmail", { email });
  }
}

const userRepo = new UserRepo(db);
```

See [Subclassing Repos](/guides/subclassing-repos/) for the full pattern.

## The schema as the source of truth

Every typed operation in Dinah flows from the typebox schema you pass to `Table`. The return type of `repo.get({ userId: "u1" })` is derived by walking:

1. The `Table`'s schema → the item type.
2. The `TableDef`'s key configuration → what shape a valid key is.
3. Any `projection` you pass → which attributes come back.
4. The subclass's `transformItem` signature → any computed fields.

There is no runtime reflection — all of this happens at the type level. If you change your schema, every call site that no longer type-checks will light up immediately.
