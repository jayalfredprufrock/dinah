import { Type } from "typebox";
import { describe, expect, test } from "vite-plus/test";
import { Table } from "../src";
import { extractTableDesc, resolveAttrType } from "../src/util";

// Discriminated union built from a base schema + `Type.Interface(...)` variants,
// the common TypeBox pattern. `recurringId` / `schedule` are sparse — present on
// only some variants.
const JobBase = Type.Object(
  {
    id: Type.String(),
    status: Type.Enum(["ARMED", "DISARMED", "COMPLETED"]),
    nextRunAt: Type.Integer(),
    ttl: Type.Optional(Type.Number()),
  },
  { additionalProperties: false },
);

const ScheduledJob = Type.Interface([JobBase], {
  type: Type.Literal("SCHEDULED"),
  runAt: Type.Optional(Type.Integer()),
});
const ManualJob = Type.Interface([JobBase], {
  type: Type.Literal("MANUAL"),
  recurringId: Type.String(),
});
const CronJob = Type.Interface([JobBase], {
  type: Type.Literal("CRON"),
  recurringId: Type.String(),
  schedule: Type.String(),
});

const Job = Type.Union([ScheduledJob, ManualJob, CronJob]);

describe("resolveAttrType with Type.Interface discriminated unions", () => {
  test("resolves base attributes shared by every variant", () => {
    expect(resolveAttrType(Job, "id")).toBe("S");
    expect(resolveAttrType(Job, "nextRunAt")).toBe("N");
    expect(resolveAttrType(Job, "ttl")).toBe("N");
  });

  test("resolves the discriminator and enum attributes", () => {
    expect(resolveAttrType(Job, "type")).toBe("S");
    expect(resolveAttrType(Job, "status")).toBe("S");
  });

  test("resolves a sparse attribute present on only some variants", () => {
    // `recurringId` is absent on ScheduledJob; it must still resolve from the
    // variants that declare it (sparse GSI key).
    expect(resolveAttrType(Job, "recurringId")).toBe("S");
    // present on only one variant
    expect(resolveAttrType(Job, "schedule")).toBe("S");
  });

  test("still throws when an attribute exists on no variant", () => {
    expect(() => resolveAttrType(Job, "nope")).toThrow(/not found/);
  });

  test("throws when a variant declares a conflicting type", () => {
    const A = Type.Interface([JobBase], { type: Type.Literal("A"), k: Type.String() });
    const B = Type.Interface([JobBase], { type: Type.Literal("B"), k: Type.Number() });
    expect(() => resolveAttrType(Type.Union([A, B]), "k")).toThrow(/not consistent/);
  });

  test("a single (non-union) schema still resolves and still throws on missing", () => {
    expect(resolveAttrType(ManualJob, "recurringId")).toBe("S");
    expect(() => resolveAttrType(ManualJob, "schedule")).toThrow(/not found/);
  });
});

describe("extractTableDesc with a sparse GSI key on a union schema", () => {
  test("emits the attribute definition for a sparse GSI key", () => {
    const table = new Table(Job, {
      name: "jobs",
      partitionKey: "id",
      gsis: { byRecurringId: { partitionKey: "recurringId", sortKey: "nextRunAt" } },
    });

    const desc = extractTableDesc(table);
    const attrs = Object.fromEntries(
      (desc.AttributeDefinitions ?? []).map((a) => [a.AttributeName, a.AttributeType]),
    );

    expect(attrs.id).toBe("S");
    expect(attrs.recurringId).toBe("S");
    expect(attrs.nextRunAt).toBe("N");
  });
});
