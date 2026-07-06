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

| Package                            | Required?   | Used for                                                           |
| ---------------------------------- | ----------- | ------------------------------------------------------------------ |
| `@aws-sdk/client-dynamodb`         | Yes         | Underlying DynamoDB client.                                        |
| `@aws-sdk/lib-dynamodb`            | Yes         | `DynamoDBDocumentClient` and command classes.                      |
| `typebox`                          | Recommended | Defining schemas for `Table`. Required if you want type inference. |
| `@aws-sdk/client-dynamodb-streams` | Optional    | Only for the `dinah/streams` stream-event helpers.                 |
| `aws-cdk-lib`                      | Optional    | Only for the `dinah/cdk` construct helpers.                        |

Install the optional ones as needed:

```bash
# for typed schemas (recommended)
npm install typebox
```

Client-side `filter` matching on reads is built in — no extra dependency required.

## TypeScript

Dinah requires TypeScript 5.4 or newer. The type inference relies on features like `const` type parameters, `infer … extends …` constraints, and the `NoInfer<T>` utility.

## Runtime

Dinah is an ES module. It ships both ESM and CJS builds and works in Node.js (18+) and any runtime that supports the AWS SDK v3 (Lambda, edge runtimes that ship the SDK, etc).
