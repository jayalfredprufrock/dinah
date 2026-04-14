---
title: Installation
description: Installing Dinah and its peer dependencies.
sidebar:
  order: 2
---

Install Dinah alongside the AWS SDK v3 DynamoDB packages:

```bash
npm install dinah @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb
```

## Peer dependencies

Dinah declares the following as peer dependencies. Some are optional and only required if you use specific features:

| Package | Required? | Used for |
| --- | --- | --- |
| `@aws-sdk/client-dynamodb` | Yes | Underlying DynamoDB client. |
| `@aws-sdk/lib-dynamodb` | Yes | `DynamoDBDocumentClient` and command classes. |
| `typebox` | Recommended | Defining schemas for `Table`. Required if you want type inference. |
| `sift` | Optional | Client-side filtering for `condition` on `get` and `batchGet`, and for `trxGet` condition checks. |

Install the optional ones as needed:

```bash
# for typed schemas (recommended)
npm install typebox

# for client-side condition filtering
npm install sift
```

## TypeScript

Dinah requires TypeScript 5.0 or newer. The type inference relies on features like `const` type parameters and `infer … extends …` constraints.

## Runtime

Dinah is an ES module. It ships both ESM and CJS builds and works in Node.js (18+) and any runtime that supports the AWS SDK v3 (Lambda, edge runtimes that ship the SDK, etc).
