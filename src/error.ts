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

export class DinahError extends Error {
  readonly details: DinahErrorDetails;

  constructor(details: DinahErrorDetails, options?: ErrorOptions) {
    super(dinahErrorMessage(details), options);
    this.name = "DinahError";
    this.details = details;
  }
}

export const isDinahError = (err: unknown): err is DinahError => err instanceof DinahError;
