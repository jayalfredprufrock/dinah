---
title: Validation
description: Runtime validation of items against typebox schemas.
sidebar:
  order: 8
  badge:
    text: Coming soon
    variant: caution
---

:::caution[Coming soon]
Runtime validation against the typebox schema is planned but not yet implemented. Today, Dinah uses the schema for **types only** — items are not validated before writes.

This page will be filled out once the feature lands.
:::

## What's planned

- Opt-in validation of items on `put` / `create` / `update` / batch / transaction writes against the table's typebox schema.
- Configurable behavior at the `Db` or `Repo` level.
- Clear, throwable errors that surface which field failed and why.

Until then, if you need write-time validation, run the typebox compiler over your items yourself before calling Dinah.
