---
title: Quick Start
description: Define a schema, create a Repo, and start reading and writing.
sidebar:
  order: 3
---

This page walks through the minimum you need to get a fully-typed Repo talking to DynamoDB.

## 1. Create a Db instance

`Db` wraps the AWS SDK v3 document client. Pass it a `DynamoDBClientConfig`, an existing `DynamoDBClient`, or a `DynamoDB` instance:

```typescript
import { Db } from "dinah";

const db = new Db({ region: "us-east-1" });
```

Point it at a local DynamoDB instance during development:

```typescript
const db = new Db({
  region: "us-east-1",
  endpoint: "http://localhost:8000",
  credentials: { accessKeyId: "fake", secretAccessKey: "fake" },
});
```

## 2. Define a Table

Use typebox to describe the table's shape, then pass it to `Table` with your key configuration:

```typescript
import { Type } from "typebox";
import { Table } from "dinah";

const UserTable = new Table(
  Type.Object({
    userId: Type.String(),
    email: Type.String(),
    name: Type.String(),
    role: Type.String(),
    createdAt: Type.Number(),
    updatedAt: Type.Optional(Type.Number()),
  }),
  {
    name: "users",
    partitionKey: "userId",
    billingMode: "PAY_PER_REQUEST",
    gsis: {
      byEmail: { partitionKey: "email" },
      byRole: { partitionKey: "role", sortKey: "createdAt" },
    },
  },
);
```

The `partitionKey`, optional `sortKey`, and each GSI's keys are validated against the schema at compile time. Typos or references to fields that don't exist on the schema produce a type error on the `Table` constructor call.

## 3. Create a Repo

```typescript
const userRepo = db.createRepo(UserTable);
```

The returned `Repo` is typed against your schema. Every method below infers its argument and return types from `UserTable`.

## 4. Read and write

```typescript
// Put a new item. Fails if an item with this userId already exists.
const alice = await userRepo.create({
  userId: "u1",
  email: "alice@example.com",
  name: "Alice",
  role: "admin",
  createdAt: Date.now(),
});

// Fetch by primary key.
const found = await userRepo.get({ userId: "u1" });
// found is typed as User | undefined

// Fetch or throw.
const mustExist = await userRepo.getOrThrow({ userId: "u1" });
// mustExist is typed as User

// Update a subset of fields.
const updated = await userRepo.update(
  { userId: "u1" },
  { name: "Alice Smith", updatedAt: Date.now() },
);

// Delete.
await userRepo.delete({ userId: "u1" });
```

## 5. Query a GSI

```typescript
const admins = await userRepo.queryGsi("byRole", {
  role: "admin",
  createdAt: { $gt: 1700000000000 },
});
```

- The first argument autocompletes to `"byEmail" | "byRole"`.
- The `query` argument requires `role` (the GSI partition key) and optionally accepts `createdAt` (the GSI sort key) with any comparison operator.
- The return type is `User[]` because `byRole` has the default `ALL` projection.

## 6. Paginate

Every `query` / `scan` / `queryGsi` / `scanGsi` has a `*Paged` variant that returns an async generator. Each yielded value is one page of items:

```typescript
for await (const page of userRepo.queryGsiPaged("byRole", { role: "admin" })) {
  console.log(`Got ${page.length} admins in this page`);
}
```

## Next

- [Concepts](/guides/concepts/) explains the relationship between `Db`, `Table`, and `Repo`.
- [Defining Tables](/guides/defining-tables/) covers keys, GSIs, and TTL.
- [Query Operators](/guides/query-operators/) documents every MongoDB-like operator Dinah understands.
- The [`Db`](/reference/db/) and [`Repo`](/reference/repo/) references list every method with signature and arguments.
