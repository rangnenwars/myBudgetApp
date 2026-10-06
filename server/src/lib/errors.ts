export class AppError extends Error {
  status: number;
  /** Machine-readable reason the client can branch on (e.g. FEATURE_NOT_ADDED); sent as `code` beside `error`. */
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (message: string) => new AppError(400, message);
export const unauthorized = (message = 'Unauthorized') => new AppError(401, message);
export const forbidden = (message = 'Forbidden') => new AppError(403, message);
export const notFound = (message = 'Not found') => new AppError(404, message);
export const conflict = (message: string) => new AppError(409, message);
