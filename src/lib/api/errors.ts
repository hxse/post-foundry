export type ApiErrorCode =
  | "missing_credentials"
  | "unauthorized"
  | "forbidden"
  | "rate_limited"
  | "network_error"
  | "provider_schema_drift"
  | "x_schema_drift"
  | "provider_error"
  | "x_api_error"
  | "invalid_request"
  | "real_post_not_allowed"
  | "missing_post_text";

export type ApiProvider = "twitterapi.io" | "x_official" | "telegram" | "codex" | "local";

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly provider: ApiProvider;
  readonly stage: string;
  readonly status?: number;
  readonly retryHint?: string;
  readonly details?: unknown;

  constructor(params: {
    code: ApiErrorCode;
    provider: ApiProvider;
    stage: string;
    message: string;
    status?: number;
    retryHint?: string;
    details?: unknown;
  }) {
    super(params.message);
    this.name = "ApiError";
    this.code = params.code;
    this.provider = params.provider;
    this.stage = params.stage;
    this.status = params.status;
    this.retryHint = params.retryHint;
    this.details = params.details;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function mapHttpStatus(params: {
  provider: Exclude<ApiProvider, "local">;
  stage: string;
  status: number;
  details?: unknown;
}): ApiError {
  const { provider, stage, status, details } = params;

  if (status === 401) {
    return new ApiError({
      code: "unauthorized",
      provider,
      stage,
      status,
      message: `${provider} unauthorized at ${stage}`,
      details
    });
  }

  if (status === 403) {
    return new ApiError({
      code: "forbidden",
      provider,
      stage,
      status,
      message: `${provider} forbidden at ${stage}`,
      details
    });
  }

  if (status === 429) {
    return new ApiError({
      code: "rate_limited",
      provider,
      stage,
      status,
      retryHint: "provider response headers if available",
      message: `${provider} rate limited at ${stage}`,
      details
    });
  }

  return new ApiError({
    code: provider === "x_official" ? "x_api_error" : "provider_error",
    provider,
    stage,
    status,
    message: `${provider} API error at ${stage}`,
    details
  });
}
