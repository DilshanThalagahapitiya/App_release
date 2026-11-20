export type ErrorCode =
  | "VALIDATION_ERROR" | "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT"
  | "RATE_LIMITED" | "INVALID_CREDENTIALS" | "INVALID_STATE" | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA" | "LINK_UNAVAILABLE" | "LEASE_LOST" | "INTERNAL_ERROR" | "BAD_REQUEST";

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 422, UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409,
  RATE_LIMITED: 429, INVALID_CREDENTIALS: 401, INVALID_STATE: 409, PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA: 415, LINK_UNAVAILABLE: 410, LEASE_LOST: 409, INTERNAL_ERROR: 500, BAD_REQUEST: 400,
};

export class ApiError extends Error {
  status: number;
  constructor(public code: ErrorCode, message: string, public details?: unknown, status?: number) {
    super(message);
    this.status = status ?? STATUS[code];
  }
}
export const notFound = (what = "Resource") => new ApiError("NOT_FOUND", `${what} was not found.`);
export const forbidden = (msg = "You do not have permission to perform this action.") => new ApiError("FORBIDDEN", msg);
