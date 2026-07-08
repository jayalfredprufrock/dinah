import type { Static, TSchema } from "typebox";
import type { TableDef } from "./types";

type SchemaStatic<Schema extends TSchema> = unknown extends Static<Schema> ? any : Static<Schema>;

// A registered-symbol brand for identifying tables across module-copy
// boundaries (dual CJS/ESM builds, multiple installed versions, bundled code),
// so `isTable` recognizes tables loaded dynamically — e.g. a CLI globbing and
// importing table-definition files to provision or migrate. See `isTable`.
const TABLE_BRAND: unique symbol = Symbol.for("dinah.table");

export class Table<
  Schema extends TSchema = TSchema,
  const Def extends TableDef<SchemaStatic<Schema>> = TableDef<SchemaStatic<Schema>>,
> {
  // Symbol-keyed, so it never shows up in `Object.keys` / `JSON.stringify`.
  readonly [TABLE_BRAND] = true;
  readonly schema: Schema;
  readonly def: Def;

  constructor(schema: Schema, def: Def) {
    this.schema = schema;
    this.def = def;
  }
}

/**
 * Type guard identifying a {@link Table}. Prefer this over `instanceof Table`
 * when tables may cross module boundaries — e.g. a CLI that globs and
 * dynamically imports table-definition files — since it recognizes tables from
 * any copy of the library.
 */
export const isTable = (value: unknown): value is Table =>
  typeof value === "object" &&
  value !== null &&
  (value as { [TABLE_BRAND]?: unknown })[TABLE_BRAND] === true;
