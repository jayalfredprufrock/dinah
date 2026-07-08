export type DinahErrorDetails =
  | { type: "NOT_FOUND"; key: Record<string, unknown>; resource?: string }
  | { type: "ALREADY_EXISTS"; key: Record<string, unknown>; resource?: string }
  | { type: "CONDITIONAL_CHECK_FAILED"; key?: Record<string, unknown>; resource?: string }
  | { type: "VALIDATION"; message: string }
  | { type: "TRANSACTION_CANCELED"; reasons: Array<{ type: string; message?: string }> }
  | { type: "DATA_INTEGRITY"; message: string };

function dinahErrorMessage(details: DinahErrorDetails): string {
  switch (details.type) {
    case "NOT_FOUND":
      return `${details.resource ?? "Item"} not found.`;
    case "ALREADY_EXISTS":
      return `${details.resource ?? "Item"} already exists.`;
    case "CONDITIONAL_CHECK_FAILED":
      return `${details.resource ?? "Item"} condition check failed.`;
    case "VALIDATION":
      return `Validation error: ${details.message}`;
    case "DATA_INTEGRITY":
      return `Data integrity error: ${details.message}`;
    case "TRANSACTION_CANCELED":
      return `Transaction canceled: ${details.reasons.map((r) => r.type).join(", ")}`;
  }
}

// A registered-symbol brand for identifying DinahErrors across module-copy
// boundaries (dual CJS/ESM builds, multiple installed versions, bundled code).
// Errors routinely cross those boundaries — thrown deep inside the library and
// caught elsewhere — where `instanceof` can silently fail. See `isDinahError`.
const DINAH_ERROR_BRAND: unique symbol = Symbol.for("dinah.error");

export class DinahError extends Error {
  // Symbol-keyed, so it never shows up in `Object.keys` / `JSON.stringify`.
  readonly [DINAH_ERROR_BRAND] = true;
  readonly details: DinahErrorDetails;

  constructor(details: DinahErrorDetails, options?: ErrorOptions) {
    super(dinahErrorMessage(details), options);
    this.name = "DinahError";
    this.details = details;
  }
}

/**
 * Type guard for {@link DinahError}. Uses `instanceof` for the common
 * same-module case, and falls back to a registered-symbol brand so errors
 * thrown by a different copy of the library are still recognized.
 */
export const isDinahError = (err: unknown): err is DinahError =>
  err instanceof DinahError ||
  (typeof err === "object" &&
    err !== null &&
    (err as { [DINAH_ERROR_BRAND]?: unknown })[DINAH_ERROR_BRAND] === true);
