import { Type } from "typebox";
import { describe, expectTypeOf, test } from "vite-plus/test";
import { AbstractRepo, Db, Table } from "../src";
import type { Condition, SortKeyOps } from "../src/types";
import type { RepoGsiStartKey, RepoQueryGsiQuery } from "../src/repo.types";

const Schema = Type.Object({
  pk: Type.String(),
  sk: Type.String(),
  gsiPk: Type.String(),
  gsiSk: Type.Number(),
  title: Type.String(),
  body: Type.String(),
  data: Type.String(),
});

type Item = {
  pk: string;
  sk: string;
  gsiPk: string;
  gsiSk: number;
  title: string;
  body: string;
  data: string;
};

const TestTable = new Table(Schema, {
  name: "test",
  partitionKey: "pk",
  sortKey: "sk",
  gsis: {
    allGsi: { partitionKey: "gsiPk", sortKey: "gsiSk" },
    keysOnlyGsi: { partitionKey: "gsiPk", sortKey: "gsiSk", projection: "KEYS_ONLY" },
    includeGsi: {
      partitionKey: "gsiPk",
      sortKey: "gsiSk",
      projection: ["title", "body"],
    },
    pkOnlyGsi: { partitionKey: "gsiPk" },
  },
});

declare const db: Db;
const repo = db.createRepo(TestTable);

describe("get / query / scan return types", () => {
  test("get returns full item by default", async () => {
    const result = await repo.get({ pk: "a", sk: "b" });
    expectTypeOf(result).toEqualTypeOf<Item | undefined>();
  });

  test("get with projection returns picked properties", async () => {
    const result = await repo.get({ pk: "a", sk: "b" }, { projection: ["pk", "title"] });
    expectTypeOf(result).toEqualTypeOf<Pick<Item, "pk" | "title"> | undefined>();
  });

  test("getOrThrow returns full item", async () => {
    const result = await repo.getOrThrow({ pk: "a", sk: "b" });
    expectTypeOf(result).toEqualTypeOf<Item>();
  });

  test("query returns full items", async () => {
    const result = await repo.query({ pk: "a" });
    expectTypeOf(result).toEqualTypeOf<Item[]>();
  });

  test("query accepts pk + optional sk", async () => {
    await repo.query({ pk: "a", sk: "b" });
  });

  test("query rejects missing partition key", () => {
    // @ts-expect-error — pk is required
    void repo.query({});
    // @ts-expect-error — pk is required, sk alone is not enough
    void repo.query({ sk: "b" });
  });

  test("query with projection returns picked items", async () => {
    const result = await repo.query({ pk: "a" }, { projection: ["pk", "title"] });
    expectTypeOf(result).toEqualTypeOf<Pick<Item, "pk" | "title">[]>();
  });

  test("scan returns full items", async () => {
    const result = await repo.scan();
    expectTypeOf(result).toEqualTypeOf<Item[]>();
  });
});

describe("queryGsi return types", () => {
  test("ALL projection (default) returns full items", async () => {
    const result = await repo.queryGsi("allGsi", { gsiPk: "a" });
    expectTypeOf(result).toEqualTypeOf<Item[]>();
  });

  test("KEYS_ONLY projection returns only key attributes", async () => {
    const result = await repo.queryGsi("keysOnlyGsi", { gsiPk: "a" });
    expectTypeOf(result).toEqualTypeOf<Pick<Item, "pk" | "sk" | "gsiPk" | "gsiSk">[]>();
  });

  test("explicit projection list returns listed attrs plus key attrs", async () => {
    const result = await repo.queryGsi("includeGsi", { gsiPk: "a" });
    expectTypeOf(result).toEqualTypeOf<
      Pick<Item, "title" | "body" | "pk" | "sk" | "gsiPk" | "gsiSk">[]
    >();
  });

  test("options.projection overrides but still includes key attrs", async () => {
    const result = await repo.queryGsi("allGsi", { gsiPk: "a" }, { projection: ["title"] });
    expectTypeOf(result).toEqualTypeOf<Pick<Item, "title" | "pk" | "sk" | "gsiPk" | "gsiSk">[]>();
  });
});

describe("queryGsi query argument types", () => {
  test("GSI with sort key requires partition key, allows optional sort key", () => {
    expectTypeOf<RepoQueryGsiQuery<typeof TestTable, "allGsi">>().toEqualTypeOf<
      { gsiPk: string } & { gsiSk?: number | SortKeyOps<number> }
    >();
  });

  test("GSI without sort key requires only partition key", () => {
    expectTypeOf<RepoQueryGsiQuery<typeof TestTable, "pkOnlyGsi">>().toEqualTypeOf<{
      gsiPk: string;
    }>();
  });

  test("call site: pk-only GSI accepts pk-only query", async () => {
    const result = await repo.queryGsi("pkOnlyGsi", { gsiPk: "a" });
    expectTypeOf(result).toEqualTypeOf<Item[]>();
  });

  test("rejects missing partition key", () => {
    // @ts-expect-error — gsiPk is required
    void repo.queryGsi("allGsi", {});
    // @ts-expect-error — gsiPk is required
    void repo.queryGsi("allGsi", { gsiSk: 1 });
  });

  test("rejects wrong value type for partition key", () => {
    // @ts-expect-error — gsiPk must be string
    void repo.queryGsi("allGsi", { gsiPk: 123 });
  });

  test("rejects wrong value type for sort key", () => {
    // @ts-expect-error — gsiSk must be number
    void repo.queryGsi("allGsi", { gsiPk: "a", gsiSk: "b" });
  });

  test("startKey includes table pk/sk + gsi pk/sk (GSI with sort key)", () => {
    expectTypeOf<RepoGsiStartKey<typeof TestTable, "allGsi">>().toEqualTypeOf<{
      pk: string;
      sk: string;
      gsiPk: string;
      gsiSk: number;
    }>();
  });

  test("startKey omits gsi sort key when GSI has none", () => {
    expectTypeOf<RepoGsiStartKey<typeof TestTable, "pkOnlyGsi">>().toEqualTypeOf<{
      pk: string;
      sk: string;
      gsiPk: string;
    }>();
  });

  test("queryGsi startKey rejects partial key", () => {
    // @ts-expect-error — missing gsiPk + gsiSk
    void repo.queryGsi("allGsi", { gsiPk: "a" }, { startKey: { pk: "a", sk: "b" } });
  });

  test("queryGsi startKey accepts full composite key", async () => {
    await repo.queryGsi(
      "allGsi",
      { gsiPk: "a" },
      { startKey: { pk: "a", sk: "b", gsiPk: "c", gsiSk: 1 } },
    );
  });

  test("scanGsi startKey has same shape", async () => {
    await repo.scanGsi("allGsi", {
      startKey: { pk: "a", sk: "b", gsiPk: "c", gsiSk: 1 },
    });
    // @ts-expect-error — missing gsiSk
    await repo.scanGsi("allGsi", { startKey: { pk: "a", sk: "b", gsiPk: "c" } });
  });

  test("literal union partition key", async () => {
    const result = await unionRepo.queryGsi("byKind", { kind: "foo" });
    expectTypeOf(result).toBeArray();
  });
});

const Cat = Type.Object({
  id: Type.String(),
  breed: Type.Union([Type.Literal("tabby"), Type.Literal("calico"), Type.Literal("manecoon")]),
  name: Type.String(),
  createdAt: Type.Integer(),
  updatedAt: Type.Integer(),
});
const catTable = new Table(Cat, {
  name: "cats",
  partitionKey: "id",
  sortKey: "breed",
  billingMode: "PAY_PER_REQUEST",
  stream: "NEW_AND_OLD_IMAGES",
  gsis: {
    byBreed: { partitionKey: "breed" },
  },
});
const catRepo = db.createRepo(catTable);

async function reproCat() {
  return catRepo.queryGsi("byBreed", { breed: "calico" });
}
void reproCat;

class CatRepo extends AbstractRepo<typeof catTable> {
  readonly table = catTable;
  async findByBreed() {
    return this.queryGsi("byBreed", { breed: "calico" });
  }
  async rejectsBadName() {
    // @ts-expect-error — "nope" is not a valid GSI name
    return this.queryGsi("nope", { breed: "calico" });
  }
}
void CatRepo;

const UnionSchema = Type.Union([
  Type.Object({
    pk: Type.String(),
    sk: Type.String(),
    kind: Type.Literal("foo"),
    fooData: Type.String(),
  }),
  Type.Object({
    pk: Type.String(),
    sk: Type.String(),
    kind: Type.Literal("bar"),
    barData: Type.Number(),
  }),
]);
const UnionTable = new Table(UnionSchema, {
  name: "union",
  partitionKey: "pk",
  sortKey: "sk",
  gsis: { byKind: { partitionKey: "kind", sortKey: "sk" } },
});
const unionRepo = db.createRepo(UnionTable);

describe("Table def validation", () => {
  test("partitionKey must be a valid schema field", () => {
    new Table(Schema, {
      name: "t",
      // @ts-expect-error — "nope" is not a field on Schema
      partitionKey: "nope",
    });
  });

  test("sortKey must be a valid schema field", () => {
    new Table(Schema, {
      name: "t",
      partitionKey: "pk",
      // @ts-expect-error — "nope" is not a field on Schema
      sortKey: "nope",
    });
  });

  test("gsi partitionKey must be a valid schema field", () => {
    new Table(Schema, {
      name: "t",
      partitionKey: "pk",
      sortKey: "sk",
      gsis: {
        // @ts-expect-error — "nope" is not a field on Schema
        bad: { partitionKey: "nope" },
      },
    });
  });

  test("gsi sortKey must be a valid schema field", () => {
    new Table(Schema, {
      name: "t",
      partitionKey: "pk",
      sortKey: "sk",
      gsis: {
        // @ts-expect-error — "nope" is not a field on Schema
        bad: { partitionKey: "gsiPk", sortKey: "nope" },
      },
    });
  });

  test("gsi projection list must contain valid schema fields", () => {
    new Table(Schema, {
      name: "t",
      partitionKey: "pk",
      sortKey: "sk",
      gsis: {
        // @ts-expect-error — "nope" is not a field on Schema
        bad: { partitionKey: "gsiPk", projection: ["title", "nope"] },
      },
    });
  });

  test("valid def compiles", () => {
    new Table(Schema, {
      name: "t",
      partitionKey: "pk",
      sortKey: "sk",
      gsis: {
        good: { partitionKey: "gsiPk", sortKey: "gsiSk", projection: ["title", "body"] },
      },
    });
  });
});

// Multi-key GSI table
const MultiKeySchema = Type.Object({
  id: Type.String(),
  tenantId: Type.String(),
  region: Type.String(),
  round: Type.String(),
  bracket: Type.String(),
  matchId: Type.String(),
  score: Type.Number(),
});

type MultiKeyItem = {
  id: string;
  tenantId: string;
  region: string;
  round: string;
  bracket: string;
  matchId: string;
  score: number;
};

const MultiKeyTable = new Table(MultiKeySchema, {
  name: "multikey",
  partitionKey: "id",
  gsis: {
    byTenantRegion: {
      partitionKey: ["tenantId", "region"],
      sortKey: ["round", "bracket", "matchId"],
    },
    multiPkOnly: {
      partitionKey: ["tenantId", "region"],
    },
    multiPkSingleSk: {
      partitionKey: ["tenantId", "region"],
      sortKey: "round",
    },
    singlePkMultiSk: {
      partitionKey: "tenantId",
      sortKey: ["round", "bracket"],
    },
    keysOnlyMulti: {
      partitionKey: ["tenantId", "region"],
      sortKey: ["round", "bracket"],
      projection: "KEYS_ONLY",
    },
  },
});

const mkRepo = db.createRepo(MultiKeyTable);

describe("multi-key GSI query argument types", () => {
  test("multi-key PK requires all partition key fields", () => {
    expectTypeOf<RepoQueryGsiQuery<typeof MultiKeyTable, "byTenantRegion">>().toMatchTypeOf<{
      tenantId: string;
      region: string;
    }>();
  });

  test("multi-key PK rejects missing partition key field", () => {
    // @ts-expect-error — both tenantId and region are required
    void mkRepo.queryGsi("byTenantRegion", { tenantId: "t1" });
    // @ts-expect-error — both tenantId and region are required
    void mkRepo.queryGsi("byTenantRegion", { region: "us-east" });
  });

  test("multi-key SK allows left-to-right combinations", async () => {
    // PK only — valid
    await mkRepo.queryGsi("byTenantRegion", { tenantId: "t1", region: "us" });
    // PK + first SK — valid
    await mkRepo.queryGsi("byTenantRegion", { tenantId: "t1", region: "us", round: "SEMI" });
    // PK + first two SKs — valid
    await mkRepo.queryGsi("byTenantRegion", {
      tenantId: "t1",
      region: "us",
      round: "SEMI",
      bracket: "UPPER",
    });
    // PK + all SKs — valid
    await mkRepo.queryGsi("byTenantRegion", {
      tenantId: "t1",
      region: "us",
      round: "SEMI",
      bracket: "UPPER",
      matchId: "m1",
    });
  });

  test("multi PK only GSI requires all PK fields", () => {
    expectTypeOf<RepoQueryGsiQuery<typeof MultiKeyTable, "multiPkOnly">>().toEqualTypeOf<{
      tenantId: string;
      region: string;
    }>();
  });

  test("multi PK + single SK GSI allows optional SK", () => {
    expectTypeOf<RepoQueryGsiQuery<typeof MultiKeyTable, "multiPkSingleSk">>().toEqualTypeOf<
      { tenantId: string; region: string } & { round?: string | SortKeyOps<string> }
    >();
  });

  test("single PK + multi SK GSI allows left-to-right SK", async () => {
    // PK only
    await mkRepo.queryGsi("singlePkMultiSk", { tenantId: "t1" });
    // PK + first SK
    await mkRepo.queryGsi("singlePkMultiSk", { tenantId: "t1", round: "SEMI" });
    // PK + both SKs
    await mkRepo.queryGsi("singlePkMultiSk", {
      tenantId: "t1",
      round: "SEMI",
      bracket: "UPPER",
    });
  });
});

describe("multi-key GSI startKey types", () => {
  test("startKey includes table PK + all GSI PK/SK fields", () => {
    expectTypeOf<RepoGsiStartKey<typeof MultiKeyTable, "byTenantRegion">>().toEqualTypeOf<{
      id: string;
      tenantId: string;
      region: string;
      round: string;
      bracket: string;
      matchId: string;
    }>();
  });

  test("startKey omits GSI SK when not present", () => {
    expectTypeOf<RepoGsiStartKey<typeof MultiKeyTable, "multiPkOnly">>().toEqualTypeOf<{
      id: string;
      tenantId: string;
      region: string;
    }>();
  });
});

describe("multi-key GSI projection return types", () => {
  test("KEYS_ONLY returns all key attributes from multi-key GSI", async () => {
    const result = await mkRepo.queryGsi("keysOnlyMulti", {
      tenantId: "t1",
      region: "us",
    });
    expectTypeOf(result).toEqualTypeOf<
      Pick<MultiKeyItem, "id" | "tenantId" | "region" | "round" | "bracket">[]
    >();
  });

  test("ALL projection returns full items", async () => {
    const result = await mkRepo.queryGsi("byTenantRegion", {
      tenantId: "t1",
      region: "us",
    });
    expectTypeOf(result).toEqualTypeOf<MultiKeyItem[]>();
  });
});

describe("multi-key GSI table def validation", () => {
  test("valid multi-key GSI def compiles", () => {
    new Table(MultiKeySchema, {
      name: "t",
      partitionKey: "id",
      gsis: {
        good: { partitionKey: ["tenantId", "region"], sortKey: ["round", "bracket"] },
      },
    });
  });

  test("multi-key GSI rejects invalid field names", () => {
    new Table(MultiKeySchema, {
      name: "t",
      partitionKey: "id",
      gsis: {
        // @ts-expect-error — "nope" is not a field on schema
        bad: { partitionKey: ["tenantId", "nope"] },
      },
    });
  });
});

describe("scanGsi return types", () => {
  test("ALL projection returns full items", async () => {
    const result = await repo.scanGsi("allGsi");
    expectTypeOf(result).toEqualTypeOf<Item[]>();
  });

  test("KEYS_ONLY projection returns only key attributes", async () => {
    const result = await repo.scanGsi("keysOnlyGsi");
    expectTypeOf(result).toEqualTypeOf<Pick<Item, "pk" | "sk" | "gsiPk" | "gsiSk">[]>();
  });
});

describe("write return types", () => {
  test("put returns full item", async () => {
    const result = await repo.put({
      pk: "a",
      sk: "b",
      gsiPk: "c",
      gsiSk: 1,
      title: "t",
      body: "b",
      data: "d",
    });
    expectTypeOf(result).toEqualTypeOf<Item>();
  });

  test("update returns full item", async () => {
    const result = await repo.update({ pk: "a", sk: "b" }, { title: "new" });
    expectTypeOf(result).toEqualTypeOf<Item>();
  });

  test("delete returns full item or undefined", async () => {
    const result = await repo.delete({ pk: "a", sk: "b" });
    expectTypeOf(result).toEqualTypeOf<Item | undefined>();
  });

  test("deleteOrThrow returns full item", async () => {
    const result = await repo.deleteOrThrow({ pk: "a", sk: "b" });
    expectTypeOf(result).toEqualTypeOf<Item>();
  });
});

type Transformed = Item & { computed: number };

class TransformRepo extends AbstractRepo<typeof TestTable> {
  readonly table = TestTable;
  override transformItem(item: Item): Transformed {
    return { ...item, computed: 42 };
  }
}

declare const tRepo: TransformRepo;

describe("transformItem return type narrowing", () => {
  test("get returns transformed item", async () => {
    const result = await tRepo.get({ pk: "a", sk: "b" });
    expectTypeOf(result).toEqualTypeOf<Transformed | undefined>();
  });

  test("query returns transformed items", async () => {
    const result = await tRepo.query({ pk: "a" });
    expectTypeOf(result).toEqualTypeOf<Transformed[]>();
  });

  test("queryGsi ALL returns transformed items", async () => {
    const result = await tRepo.queryGsi("allGsi", { gsiPk: "a" });
    expectTypeOf(result).toEqualTypeOf<Transformed[]>();
  });

  test("queryGsi KEYS_ONLY does NOT transform (returns raw pick)", async () => {
    const result = await tRepo.queryGsi("keysOnlyGsi", { gsiPk: "a" });
    expectTypeOf(result).toEqualTypeOf<Pick<Item, "pk" | "sk" | "gsiPk" | "gsiSk">[]>();
  });

  test("get with projection does NOT transform", async () => {
    const result = await tRepo.get({ pk: "a", sk: "b" }, { projection: ["pk", "title"] });
    expectTypeOf(result).toEqualTypeOf<Pick<Item, "pk" | "title"> | undefined>();
  });

  test("put returns transformed item", async () => {
    const result = await tRepo.put({
      pk: "a",
      sk: "b",
      gsiPk: "c",
      gsiSk: 1,
      title: "t",
      body: "b",
      data: "d",
    });
    expectTypeOf(result).toEqualTypeOf<Transformed>();
  });
});

// ── Sort key operator typing ─────────────────────────────────────────────────

describe("sort key operator typing — string sort key", () => {
  test("accepts direct value (backward compat)", async () => {
    await repo.query({ pk: "a", sk: "b" });
  });

  test("accepts $eq operator", async () => {
    await repo.query({ pk: "a", sk: { $eq: "b" } });
  });

  test("accepts $gt operator", async () => {
    await repo.query({ pk: "a", sk: { $gt: "b" } });
  });

  test("accepts $gte operator", async () => {
    await repo.query({ pk: "a", sk: { $gte: "b" } });
  });

  test("accepts $lt operator", async () => {
    await repo.query({ pk: "a", sk: { $lt: "b" } });
  });

  test("accepts $lte operator", async () => {
    await repo.query({ pk: "a", sk: { $lte: "b" } });
  });

  test("accepts $between on string sort key", async () => {
    await repo.query({ pk: "a", sk: { $between: ["a", "z"] } });
  });

  test("accepts $prefix on string sort key", async () => {
    await repo.query({ pk: "a", sk: { $prefix: "pre" } });
  });

  test("rejects $ne on sort key", () => {
    // @ts-expect-error — $ne is not valid in KeyConditionExpression
    void repo.query({ pk: "a", sk: { $ne: "b" } });
  });

  test("rejects $in on sort key", () => {
    // @ts-expect-error — $in is not valid in KeyConditionExpression
    void repo.query({ pk: "a", sk: { $in: ["a", "b"] } });
  });

  test("rejects $exists on sort key", () => {
    // @ts-expect-error — $exists is not valid in KeyConditionExpression
    void repo.query({ pk: "a", sk: { $exists: true } });
  });

  test("rejects operators on partition key", () => {
    // @ts-expect-error — partition key only accepts direct value
    void repo.query({ pk: { $gt: "a" }, sk: "b" });
  });

  test("rejects wrong value type in operator", () => {
    // @ts-expect-error — sk is string, $gt expects string not number
    void repo.query({ pk: "a", sk: { $gt: 123 } });
  });
});

describe("sort key operator typing — number sort key (GSI)", () => {
  test("accepts $gte on number sort key", async () => {
    await repo.queryGsi("allGsi", { gsiPk: "a", gsiSk: { $gte: 10 } });
  });

  test("accepts $between on number sort key", async () => {
    await repo.queryGsi("allGsi", { gsiPk: "a", gsiSk: { $between: [1, 100] } });
  });

  test("rejects $prefix on number sort key", () => {
    // @ts-expect-error — $prefix is only for strings
    void repo.queryGsi("allGsi", { gsiPk: "a", gsiSk: { $prefix: "1" } });
  });

  test("rejects $between with string tuple on number sort key", () => {
    // @ts-expect-error — $between on number needs [number, number]
    void repo.queryGsi("allGsi", { gsiPk: "a", gsiSk: { $between: ["a", "z"] } });
  });
});

describe("sort key operator typing — multi-key sort key", () => {
  test("accepts operators on provided fields", async () => {
    await mkRepo.queryGsi("byTenantRegion", {
      tenantId: "t1",
      region: "us",
      round: { $prefix: "SEMI" },
    });
  });

  test("accepts operators on multiple SK fields", async () => {
    await mkRepo.queryGsi("byTenantRegion", {
      tenantId: "t1",
      region: "us",
      round: { $gte: "A" },
      bracket: { $prefix: "UP" },
    });
  });

  test("rejects invalid operators on multi-key fields", () => {
    void mkRepo.queryGsi("byTenantRegion", {
      tenantId: "t1",
      region: "us",
      // @ts-expect-error — $ne not valid on sort key
      round: { $ne: "FINAL" },
    });
  });
});

describe("KeyCondition typing — Db.query", () => {
  type DbItem = { id: string; sk: string; status: string; age: number };

  test("accepts field-level key operators", async () => {
    await db.query<DbItem>({ table: "t", query: { id: "a", sk: { $gte: "b" } } });
  });

  test("accepts $between", async () => {
    await db.query<DbItem>({ table: "t", query: { id: "a", sk: { $between: ["a", "z"] } } });
  });

  test("rejects $and at top level", () => {
    // @ts-expect-error — compound operators not valid in KeyConditionExpression
    void db.query<DbItem>({ table: "t", query: { $and: [{ id: "a" }] } });
  });

  test("rejects $or at top level", () => {
    // @ts-expect-error — compound operators not valid in KeyConditionExpression
    void db.query<DbItem>({ table: "t", query: { $or: [{ id: "a" }] } });
  });

  test("rejects $not at top level", () => {
    // @ts-expect-error — compound operators not valid in KeyConditionExpression
    void db.query<DbItem>({ table: "t", query: { $not: { id: "a" } } });
  });

  test("rejects $ne on fields", () => {
    // @ts-expect-error — $ne not valid in KeyConditionExpression
    void db.query<DbItem>({ table: "t", query: { id: { $ne: "a" } } });
  });

  test("rejects $in on fields", () => {
    // @ts-expect-error — $in not valid in KeyConditionExpression
    void db.query<DbItem>({ table: "t", query: { id: { $in: ["a"] } } });
  });

  test("rejects $exists on fields", () => {
    // @ts-expect-error — $exists not valid in KeyConditionExpression
    void db.query<DbItem>({ table: "t", query: { id: { $exists: true } } });
  });

  test("filter still allows full condition operators", async () => {
    await db.query<DbItem>({
      table: "t",
      query: { id: "a" },
      filter: { status: { $ne: "deleted" }, $or: [{ age: { $gt: 18 } }] },
    });
  });
});

// ── Condition & filter typing ──────────────────────────────────────────────────

const CondSchema = Type.Object({
  userId: Type.String(),
  age: Type.Number(),
  active: Type.Boolean(),
  name: Type.String(),
  tags: Type.Array(Type.String()),
  score: Type.Optional(Type.Number()),
});

type CondItem = {
  userId: string;
  age: number;
  active: boolean;
  name: string;
  tags: string[];
  score?: number;
};

const CondTable = new Table(CondSchema, {
  name: "cond",
  partitionKey: "userId",
  gsis: { byName: { partitionKey: "name", sortKey: "age" } },
});
const condRepo = db.createRepo(CondTable);

describe("condition typing — valid expressions", () => {
  test("shorthand $eq (direct value)", () => {
    const c: Condition<CondItem> = { name: "alice" };
    void c;
  });

  test("explicit $eq", () => {
    const c: Condition<CondItem> = { name: { $eq: "alice" } };
    void c;
  });

  test("$ne on string", () => {
    const c: Condition<CondItem> = { name: { $ne: "bob" } };
    void c;
  });

  test("$gt/$lt/$gte/$lte on number", () => {
    const c: Condition<CondItem> = { age: { $gt: 18 } };
    void c;
    const c2: Condition<CondItem> = { age: { $lte: 65 } };
    void c2;
  });

  test("$between on number", () => {
    const c: Condition<CondItem> = { age: { $between: [18, 65] } };
    void c;
  });

  test("$between on string", () => {
    const c: Condition<CondItem> = { name: { $between: ["a", "z"] } };
    void c;
  });

  test("$prefix on string", () => {
    const c: Condition<CondItem> = { name: { $prefix: "al" } };
    void c;
  });

  test("$includes on string", () => {
    const c: Condition<CondItem> = { name: { $includes: "ice" } };
    void c;
  });

  test("$includes on array", () => {
    const c: Condition<CondItem> = { tags: { $includes: "typescript" } };
    void c;
  });

  test("$exists", () => {
    const c: Condition<CondItem> = { score: { $exists: true } };
    void c;
  });

  test("$type", () => {
    const c: Condition<CondItem> = { name: { $type: "S" } };
    void c;
  });

  test("$in / $nin", () => {
    const c: Condition<CondItem> = { name: { $in: ["alice", "bob"] } };
    void c;
    const c2: Condition<CondItem> = { age: { $nin: [1, 2, 3] } };
    void c2;
  });

  test("$size on array", () => {
    const c: Condition<CondItem> = { tags: { $size: 3 } };
    void c;
    const c2: Condition<CondItem> = { tags: { $size: { $gt: 2 } } };
    void c2;
  });

  test("$path reference", () => {
    const c: Condition<CondItem> = { age: { $gt: { $path: "score" } } };
    void c;
  });

  test("compound $and", () => {
    const c: Condition<CondItem> = {
      $and: [{ name: "alice" }, { age: { $gt: 18 } }],
    };
    void c;
  });

  test("compound $or", () => {
    const c: Condition<CondItem> = {
      $or: [{ active: true }, { age: { $lt: 13 } }],
    };
    void c;
  });

  test("compound $not", () => {
    const c: Condition<CondItem> = {
      $not: { name: "bob" },
    };
    void c;
  });

  test("nested compound", () => {
    const c: Condition<CondItem> = {
      $and: [{ $or: [{ name: "alice" }, { name: "bob" }] }, { $not: { active: false } }],
    };
    void c;
  });

  test("multiple fields in one condition", () => {
    const c: Condition<CondItem> = { name: "alice", age: { $gte: 21 }, active: true };
    void c;
  });
});

describe("condition typing — invalid expressions", () => {
  test("rejects nonexistent field", () => {
    // @ts-expect-error — "nonExistent" is not a field on CondItem
    const c: Condition<CondItem> = { nonExistent: "x" };
    void c;
  });

  test("rejects wrong value type for shorthand $eq", () => {
    // @ts-expect-error — age expects number, not string
    const c: Condition<CondItem> = { age: "not a number" };
    void c;
  });

  test("rejects wrong value type for $gt", () => {
    // @ts-expect-error — $gt on number field expects number
    const c: Condition<CondItem> = { age: { $gt: "x" } };
    void c;
  });

  test("rejects $prefix on number field", () => {
    // @ts-expect-error — $prefix is not valid for number fields
    const c: Condition<CondItem> = { age: { $prefix: "x" } };
    void c;
  });

  test("rejects $between with wrong tuple type", () => {
    // @ts-expect-error — $between on number needs [number, number]
    const c: Condition<CondItem> = { age: { $between: ["a", "z"] } };
    void c;
  });

  test("rejects $exists with non-boolean", () => {
    // @ts-expect-error — $exists expects boolean
    const c: Condition<CondItem> = { name: { $exists: "yes" } };
    void c;
  });

  test("rejects $in with wrong element type", () => {
    // @ts-expect-error — $in on string field needs string[]
    const c: Condition<CondItem> = { name: { $in: [1, 2] } };
    void c;
  });
});

describe("condition typing — usage in repo methods", () => {
  test("put accepts typed condition", async () => {
    await condRepo.put(
      { userId: "u1", age: 25, active: true, name: "Alice", tags: [] },
      { condition: { userId: { $exists: false } } },
    );
  });

  test("put rejects invalid condition field", async () => {
    await condRepo.put(
      { userId: "u1", age: 25, active: true, name: "Alice", tags: [] },
      // @ts-expect-error — "nope" is not a field on the schema
      { condition: { nope: "bad" } },
    );
  });

  test("update accepts typed condition", async () => {
    await condRepo.update({ userId: "u1" }, { age: 26 }, { condition: { active: true } });
  });

  test("delete accepts typed condition", async () => {
    await condRepo.delete({ userId: "u1" }, { condition: { active: { $eq: false } } });
  });

  test("query accepts typed filter", async () => {
    await condRepo.query({ userId: "u1" }, { filter: { age: { $gt: 21 } } });
  });

  test("query rejects invalid filter field", async () => {
    // @ts-expect-error — "nope" is not a field
    await condRepo.query({ userId: "u1" }, { filter: { nope: 1 } });
  });

  test("scan accepts typed filter", async () => {
    await condRepo.scan({ filter: { name: { $prefix: "A" } } });
  });

  test("queryGsi accepts typed filter", async () => {
    await condRepo.queryGsi("byName", { name: "Alice" }, { filter: { active: true } });
  });

  test("scanGsi accepts typed filter", async () => {
    await condRepo.scanGsi("byName", { filter: { age: { $gte: 18 } } });
  });

  test("exists accepts typed filter", async () => {
    await condRepo.exists({ filter: { active: true } });
  });
});
