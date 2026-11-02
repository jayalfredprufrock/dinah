// Type-checking cost fixture (see ../type-perf.test.ts). Covers the patterns that
// previously cost ~1M type instantiations each, plus typical repo usage.
import { Type } from "typebox";
import { Db, Table } from "../../src";
import { createSeed, isSeed, Seed } from "../../src/seed";

const Animal = Type.Union([
  Type.Object({
    id: Type.String(),
    kind: Type.Literal("cat"),
    name: Type.String(),
    lives: Type.Integer(),
  }),
  Type.Object({
    id: Type.String(),
    kind: Type.Literal("dog"),
    name: Type.String(),
    tricks: Type.Array(Type.String()),
  }),
]);
const AnimalTable = new Table(Animal, {
  name: "animals",
  partitionKey: "id",
  gsis: { byKind: { partitionKey: "kind" } },
});

const Account = Type.Object({
  id: Type.String(),
  email: Type.String(),
  expiresAt: Type.Optional(Type.Number()),
  ttl: Type.Optional(Type.Number()),
});
const AccountTable = new Table(Account, { name: "accounts", partitionKey: "id" });

class AccountModel {
  constructor(readonly id: string) {}
}

declare const db: Db;

// repos with context-sensitive config callbacks
const animals = db.makeRepo(AnimalTable, {
  discriminator: "kind",
  transformOutput: (item) => ({ ...item, label: item.name }),
});
const accounts = db.makeRepo(AccountTable, {
  transformAttributes: { email: (v) => v.toLowerCase() },
  computedAttributes: {
    ttl: { from: "expiresAt", compute: (v: number | undefined) => v },
  },
  transformOutput: (item) => new AccountModel(item.id),
});

// seeds: array, thunk, annotated, and as a Seed[]
const accountSeed = createSeed(AccountTable, [{ id: "a", email: "x" }]);
const animalSeed: { items: unknown[] } = createSeed(AnimalTable, () => [
  { id: accountSeed.items[0]!.id, kind: "cat", name: "c", lives: 9 },
]);
export const seeds: Seed[] = [accountSeed];
export const isAnySeed = (v: unknown) => isSeed(v);

export const run = async () => {
  await animals.get({ id: "a" });
  await animals.scan({ filter: { kind: { $in: ["cat"] }, name: { $prefix: "c" } } });
  await animals.queryGsi("byKind", { kind: "dog" }, { filter: { tricks: { $includes: "sit" } } });
  await animals.update({ id: "a", kind: "cat" }, { lives: { $minus: 1 } });
  await accounts.put({ id: "a", email: "x" });
  await accounts.query({ id: "a" }, { projection: ["id", "email"] });
  const models = await accounts.scan();
  return [models.map((m) => m.id), animalSeed] as const;
};
