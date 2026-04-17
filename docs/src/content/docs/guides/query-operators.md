---
title: Query Operators
description: MongoDB-like operators for conditions, filters, and key queries.
sidebar:
  order: 3
---

Dinah accepts a MongoDB-like query syntax for three distinct purposes:

1. **Key conditions** — the `query` argument to `query` / `queryGsi` / `queryPaged` / `queryGsiPaged`.
2. **Filter expressions** — the `filter` option on queries, scans, and `exists`.
3. **Condition expressions** — the `condition` option on `put`, `update`, `delete`, `create`, and transaction requests.

All three use the same operator set. Internally, Dinah compiles them to DynamoDB expressions via its `ExpressionBuilder`.

## Equality shorthand

Passing a primitive value directly is shorthand for `$eq`:

```typescript
{
  status: "published";
}
// equivalent to:
{
  status: {
    $eq: "published";
  }
}
```

## Comparison operators

All of these take a primitive operand (string, number, boolean), or an `{ $path: "other.attribute" }` object to compare two attributes on the same item.

| Operator | Meaning               | DynamoDB |
| -------- | --------------------- | -------- |
| `$eq`    | equal                 | `=`      |
| `$ne`    | not equal             | `<>`     |
| `$gt`    | greater than          | `>`      |
| `$gte`   | greater than or equal | `>=`     |
| `$lt`    | less than             | `<`      |
| `$lte`   | less than or equal    | `<=`     |

```typescript
{
  publishedAt: {
    $gt: 1700000000000;
  }
}
{
  score: {
    $gte: {
      $path: "minScore";
    }
  }
}
```

## Set membership

| Operator | Operand | Meaning                                        |
| -------- | ------- | ---------------------------------------------- |
| `$in`    | array   | Attribute value is one of the array items.     |
| `$nin`   | array   | Attribute value is not any of the array items. |

```typescript
{
  status: {
    $in: ["draft", "published"];
  }
}
{
  userId: {
    $nin: bannedIds;
  }
}
```

> `$in` with an empty array is currently a known edge case — prefer a non-empty array.

## String & collection operators

| Operator    | Operand | Meaning                                                                          |
| ----------- | ------- | -------------------------------------------------------------------------------- |
| `$prefix`   | string  | `begins_with(attr, value)` — string starts with the operand.                     |
| `$includes` | any     | `contains(attr, value)` — string contains substring, or set/list contains value. |

```typescript
{
  postId: {
    $prefix: "post#";
  }
}
{
  tags: {
    $includes: "typescript";
  }
}
```

## Range

| Operator   | Operand       | Meaning                                           |
| ---------- | ------------- | ------------------------------------------------- |
| `$between` | `[low, high]` | Attribute is between `low` and `high`, inclusive. |

```typescript
{
  publishedAt: {
    $between: [1700000000000, 1800000000000];
  }
}
```

## Existence & type checks

| Operator  | Operand             | Meaning                                                  |
| --------- | ------------------- | -------------------------------------------------------- |
| `$exists` | boolean             | `attribute_exists(attr)` / `attribute_not_exists(attr)`. |
| `$type`   | attribute type code | `attribute_type(attr, type)`.                            |

Valid `$type` values: `"S"`, `"SS"`, `"N"`, `"NS"`, `"B"`, `"BS"`, `"BOOL"`, `"NULL"`, `"L"`, `"M"`.

```typescript
{
  archivedAt: {
    $exists: false;
  }
}
{
  metadata: {
    $type: "M";
  }
}
```

## Compound operators

`$and`, `$or`, and `$not` let you combine conditions. `$and` and `$or` take an array of sub-conditions; `$not` takes a single object.

```typescript
{
  $or: [
    { status: "published" },
    { status: "archived", publishedAt: { $gt: 0 } },
  ],
}

{
  $not: { status: "draft" },
}

{
  $and: [
    { authorId: "u1" },
    { publishedAt: { $gte: 1700000000000 } },
  ],
}
```

A plain object with multiple keys is implicitly `$and`-ed, so you rarely need the explicit form:

```typescript
// implicit $and
{ authorId: "u1", publishedAt: { $gte: 1700000000000 } }
```

## Comparing to another attribute

Any operand that takes a primitive can instead take an `{ $path: "otherAttr" }` object to reference another attribute on the same item. This works for comparisons and for arithmetic in update expressions.

```typescript
// condition: updatedAt must be greater than createdAt
{
  updatedAt: {
    $gt: {
      $path: "createdAt";
    }
  }
}
```

## Key conditions vs filter expressions

DynamoDB distinguishes **key conditions** (applied before the query runs, index-backed) from **filter expressions** (applied after, on the returned page, before it's returned to the client). Dinah does not merge these — they go in different places:

```typescript
await repo.queryGsi(
  "byAuthor",
  {
    // KEY CONDITION: partition key is required,
    // sort key optional with comparison operators
    authorId: "u1",
    publishedAt: { $gt: 1700000000000 },
  },
  {
    // FILTER EXPRESSION: runs on the server after the query,
    // can reference any attribute
    filter: { status: "published", tags: { $includes: "featured" } },
  },
);
```

Only partition key (required) and sort key (optional) may appear in a key-condition query. Any other field produces a DynamoDB error at runtime, so prefer putting it in `filter`.
