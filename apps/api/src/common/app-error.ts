export const ERROR_CODES = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  CONSENT_REQUIRED: 'CONSENT_REQUIRED',
  NOT_FOUND: 'NOT_FOUND',
  PRECONDITION_FAILED: 'PRECONDITION_FAILED',
  FORBIDDEN_STATE: 'FORBIDDEN_STATE',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface ErrorDetail {
  field?: string;
  message: string;
}

/**
 * 单一原因时直接用它作为 message，前端 toast 可读；
 * 多原因时用兜底文案，具体原因逐条列在 details（前端按字段展示）。
 */
function resolveMessage(
  explicit: string | undefined,
  details: ErrorDetail[],
  fallback: string,
): string {
  if (explicit !== undefined) {
    return explicit;
  }
  return details.length === 1 ? details[0].message : fallback;
}

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly httpStatus: number,
    readonly details: ErrorDetail[] = [],
  ) {
    super(message);
    this.name = 'AppError';
  }

  static validation(details: ErrorDetail[], message?: string): AppError {
    return new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      resolveMessage(message, details, '请求参数校验失败'),
      400,
      details,
    );
  }

  static consentRequired(details: ErrorDetail[], message?: string): AppError {
    return new AppError(
      ERROR_CODES.CONSENT_REQUIRED,
      resolveMessage(message, details, '请先完成必要的授权同意'),
      400,
      details,
    );
  }

  static notFound(message: string): AppError {
    return new AppError(ERROR_CODES.NOT_FOUND, message, 404);
  }

  static precondition(details: ErrorDetail[], message?: string): AppError {
    return new AppError(
      ERROR_CODES.PRECONDITION_FAILED,
      resolveMessage(message, details, '前置条件未满足'),
      409,
      details,
    );
  }

  static forbiddenState(message: string): AppError {
    return new AppError(ERROR_CODES.FORBIDDEN_STATE, message, 409);
  }
}
