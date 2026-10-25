// The error envelope of the v1 contract: {error:{code, message, detail?, retryable}} with HTTP 4xx/5xx.
export type ErrorCode =
  | "unauthorized"
  | "forbidden_by_policy"
  | "model_not_installed"
  | "model_loading"
  | "capability_unavailable"
  | "insufficient_memory"
  | "insufficient_disk"
  | "integrity_failed"
  | "unsupported_media"
  | "input_too_long"
  | "busy"
  | "cancelled"
  | "internal"
  // additive (v1 allows added codes): request shape errors and unknown resources
  | "bad_request"
  | "not_found";

const STATUS: Record<ErrorCode, number> = {
  unauthorized: 401,
  forbidden_by_policy: 403,
  model_not_installed: 409,
  model_loading: 503,
  capability_unavailable: 409,
  insufficient_memory: 507,
  insufficient_disk: 507,
  integrity_failed: 422,
  unsupported_media: 415,
  input_too_long: 413,
  busy: 429,
  cancelled: 499,
  internal: 500,
  bad_request: 400,
  not_found: 404,
};

const RETRYABLE = new Set<ErrorCode>(["busy", "model_loading"]);

export class ApiError extends Error {
  readonly status: number;
  constructor(readonly code: ErrorCode, message: string, readonly detail?: unknown, status?: number) {
    super(message);
    this.status = status ?? STATUS[code];
  }
  get retryable(): boolean { return RETRYABLE.has(this.code); }
  toJSON(): { error: { code: ErrorCode; message: string; detail?: unknown; retryable: boolean } } {
    const error: { code: ErrorCode; message: string; detail?: unknown; retryable: boolean } = { code: this.code, message: this.message, retryable: this.retryable };
    if (this.detail !== undefined) error.detail = this.detail;
    return { error };
  }
}

export function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  if (e && typeof e === "object" && (e as { name?: string }).name === "AbortError") return new ApiError("cancelled", "The request was cancelled");
  return new ApiError("internal", e instanceof Error ? e.message : String(e));
}

export const isAbort = (e: unknown): boolean =>
  (e instanceof ApiError && e.code === "cancelled") || (!!e && typeof e === "object" && (e as { name?: string }).name === "AbortError");
