import type { Static, TSchema } from "typebox";
import type { TableDef } from "./types";

type SchemaStatic<Schema extends TSchema> = unknown extends Static<Schema> ? any : Static<Schema>;

export class Table<
  Schema extends TSchema = TSchema,
  const Def extends TableDef<SchemaStatic<Schema>> = TableDef<SchemaStatic<Schema>>,
> {
  readonly schema: Schema;
  readonly def: Def;

  constructor(schema: Schema, def: Def) {
    this.schema = schema;
    this.def = def;
  }
}
