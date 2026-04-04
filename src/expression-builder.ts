import type { Obj } from "./types";

const attrTypes = ["S", "SS", "N", "NS", "B", "BS", "BOOL", "NULL", "L", "M"] as const;
const comparatorOps: Obj<string> = {
  $eq: "=",
  $ne: "<>",
  $gt: ">",
  $gte: ">=",
  $lt: "<",
  $lte: "<=",
};

// TODO should { $eq: undefined } and { $ne: undefined } be converted into attribute_not_exists and attribute_exists ?

export const isOperation = (val: unknown): val is Obj => {
  if (!val || typeof val !== "object" || Array.isArray(val)) return false;
  return Object.keys(val).every((op) => op.startsWith("$"));
};

export class ExpressionBuilder {
  protected readonly attrNames = new Map<string, string>();
  protected readonly attrValues = new Map<unknown, string>();

  get attributeNames(): Obj<string> | undefined {
    return this.attrNames.size
      ? Object.fromEntries(
          [...this.attrNames.entries()].map(([name, placeholder]) => [placeholder, name]),
        )
      : undefined;
  }

  get attributeValues(): Obj | undefined {
    return this.attrValues.size
      ? Object.fromEntries(
          [...this.attrValues.entries()].map(([value, placeholder]) => [placeholder, value]),
        )
      : undefined;
  }

  reset(): void {
    this.attrNames.clear();
    this.attrValues.clear();
  }

  getPathSub(path: string): string {
    const segments = path.split(".");
    const placeholders: string[] = [];

    for (const segment of segments) {
      let placeholder = this.attrNames.get(segment);
      if (!placeholder) {
        placeholder = `#${this.attrNames.size}`;
        this.attrNames.set(segment, placeholder);
      }

      placeholders.push(placeholder);
    }

    return placeholders.join(".");
  }

  getValueSub(value: unknown): string {
    let placeholder = this.attrValues.get(value);
    if (!placeholder) {
      placeholder = `:${this.attrValues.size}`;
      this.attrValues.set(value, placeholder);
    }

    return placeholder;
  }

  getValueOrPathSub(pathOrValue: unknown): string {
    if (isOperation(pathOrValue)) {
      if (pathOrValue.$path) return this.getPathSub(pathOrValue.$path);
      throw new Error("Expected $path or operand.");
    }

    return this.getValueSub(pathOrValue);
  }

  projection<T extends string[] | undefined>(paths: T): T extends undefined ? undefined : string {
    return paths?.map((path) => this.getPathSub(path)).join(", ") as never;
  }

  condition<T extends Obj | undefined>(expression: T): T extends undefined ? undefined : string {
    if (!expression) return undefined as never;

    const expressions: string[] = [];
    for (const [key, val] of Object.entries(expression)) {
      if (key === "$and") {
        if (!Array.isArray(val)) throw new Error("$and expects an array operand.");
        expressions.push(`(${val.map((v) => this.condition(v)).join(" AND ")})`);
      } else if (key === "$or" && Array.isArray(val)) {
        if (!Array.isArray(val)) throw new Error("$or expects an array operand.");
        expressions.push(`(${val.map((v) => this.condition(v)).join(" OR ")})`);
      } else if (key === "$not") {
        if (!val || typeof val !== "object") throw new Error("$not expects an object operand.");
        expressions.push(`NOT ${this.condition(val)}`);
      } else if (!key.startsWith("$")) {
        expressions.push(this.resolveCondition(key, val));
      } else {
        throw new Error(
          `Unexpected operator "${key}". Expected attribute path or compound operator.`,
        );
      }
    }

    return expressions.join(" AND ") as never;
  }

  update<T extends Obj | undefined>(expression: T): T extends undefined ? undefined : string {
    if (expression === undefined) return undefined as never;

    const setOperations: string[] = [];
    const removeOperations: string[] = [];
    const setAddOperations: string[] = [];
    const setDelOperations: string[] = [];

    for (const [path, valOrOperation] of Object.entries(expression)) {
      const placeholder = this.getPathSub(path);

      if (valOrOperation === undefined) {
        removeOperations.push(placeholder);
      } else if (isOperation(valOrOperation)) {
        if (valOrOperation.$remove === true) {
          removeOperations.push(placeholder);
        } else if (valOrOperation.$setAdd !== undefined || valOrOperation.$setDel !== undefined) {
          const operations = valOrOperation.$setAdd ? setAddOperations : setDelOperations;
          const operand = valOrOperation.$setAdd ?? valOrOperation.$setDel;
          operations.push(
            `${placeholder} ${this.getValueSub(operand instanceof Set ? operand : new Set([operand].flat()))}`,
          );
        } else {
          setOperations.push(`${placeholder} = ${this.resolveSetOperand(path, valOrOperation)}`);
        }
      } else {
        setOperations.push(`${placeholder} = ${this.getValueSub(valOrOperation)}`);
      }
    }

    let updateExpression = "";
    if (setOperations.length) {
      updateExpression += `SET ${setOperations.join(", ")} `;
    }

    if (removeOperations.length) {
      updateExpression += `REMOVE ${removeOperations.join(", ")} `;
    }

    if (setAddOperations.length) {
      updateExpression += `ADD ${setAddOperations.join(", ")} `;
    }

    if (setDelOperations.length) {
      updateExpression += `DELETE ${setDelOperations.join(", ")} `;
    }

    return updateExpression as never;
  }

  protected resolveCondition(path: string, exp: unknown): string {
    if (!exp || typeof exp !== "object" || !Object.keys(exp).at(0)?.startsWith("$")) {
      return this.resolveCondition(path, { $eq: exp });
    }

    const placeholder = this.getPathSub(path);
    const [operator, operand] = Object.entries(exp).at(0) ?? [""];

    if (comparatorOps[operator]) {
      if (isOperation(operand) && operand.$path) {
        return `${placeholder} ${comparatorOps[operator]} ${this.getPathSub(operand.$path)}`;
      }

      if (!["string", "boolean", "number"].includes(typeof operand)) {
        throw new Error(`${operator} expects a primitive/scalar operand.`);
      }
      return `${placeholder} ${comparatorOps[operator]} ${this.getValueSub(operand)}`;
    }

    switch (operator) {
      case "$in":
        if (!Array.isArray(operand)) {
          throw new Error("$in operator expects an array operand.");
        }
        return `${placeholder} IN (${operand.map((op) => this.getValueSub(op)).join(", ")})`;

      case "$nin":
        if (!Array.isArray(operand)) {
          throw new Error("$nin operator expects an array operand.");
        }
        return `${placeholder} NOT IN (${operand.map((op) => this.getValueSub(op)).join(", ")})`;

      case "$prefix":
        if (typeof operand !== "string") {
          throw new Error("$prefix operator expects a string operand.");
        }
        return `begins_with(${placeholder}, ${this.getValueSub(operand)})`;

      case "$includes":
        return `contains(${placeholder}, ${this.getValueSub(operand)})`;

      case "$between":
        if (!Array.isArray(operand) || operand.length !== 2) {
          throw new Error("$between operator expects an array operand of exactly two values.");
        }
        return `${placeholder} BETWEEN ${this.getValueSub(operand[0])} AND ${this.getValueSub(operand[1])}`;

      case "$exists":
        if (typeof operand !== "boolean") {
          throw new Error("$exists operator expects a boolean operand.");
        }
        return operand
          ? `attribute_exists(${placeholder})`
          : `attribute_not_exists(${placeholder})`;

      case "$type":
        if (!attrTypes.includes(operand as any)) {
          throw new Error(`$type operator expects operand to be one of ${attrTypes.join(",")}`);
        }
        return `attribute_type(${placeholder})`;

      case "$size": {
        const sizeExp = typeof operand === "number" ? { $eq: operand } : operand;
        if (
          !sizeExp ||
          typeof sizeExp !== "object" ||
          !Object.keys(sizeExp).at(0)?.startsWith("$")
        ) {
          throw new Error("$size operator expects a number operand or a comparator object.");
        }
        const [sizeOperator, sizeOperand] = Object.entries(sizeExp).at(0) ?? [""];

        if (!comparatorOps[sizeOperator]) {
          throw new Error("$size operator expects a number operand or a comparator object.");
        }

        if (!["string", "boolean", "number"].includes(typeof sizeOperand)) {
          throw new Error(`${operator} expects a primitive/scalar operand.`);
        }

        return `size(${placeholder}) ${comparatorOps[sizeOperator]} ${this.getValueSub(sizeOperand)}`;
      }

      default:
        throw new Error(`Invalid operator "${operator}"`);
    }
  }

  protected resolveSetOperand(path: string, operand: unknown): string {
    if (isOperation(operand)) {
      if (operand.$ifNotExists) {
        const params = Array.isArray(operand.$ifNotExists)
          ? operand.$ifNotExists
          : [path, operand.$ifNotExists];
        return `if_not_exists(${this.getPathSub(params[0])}, ${this.resolveSetOperand(path, params[1])})`;
      }

      if (operand.$set) {
        return this.resolveSetOperand(path, operand.$set);
      }

      if (operand.$plus !== undefined || operand.$minus !== undefined) {
        const mathOperator = operand.$plus ? "+" : "-";
        const mathOperand = operand.$plus ?? operand.$minus;
        const params = Array.isArray(mathOperand) ? mathOperand : [{ $path: path }, mathOperand];
        return `${params.map((param) => this.resolveSetOperand(path, param)).join(` ${mathOperator} `)}`;
      }

      if (operand.$append !== undefined || operand.$prepend !== undefined) {
        const listOperand = operand.$append ?? operand.$prepend;
        const resolvedListOperand = isOperation(listOperand) ? listOperand : [listOperand].flat();
        const params = operand.$append
          ? [{ $path: path }, resolvedListOperand]
          : [resolvedListOperand, { $path: path }];
        return `list_append(${params.map((param) => this.resolveSetOperand(path, param)).join(", ")})`;
      }
    }

    return this.getValueOrPathSub(operand);
  }
}
