export class AppError extends Error {
  readonly statusCode: number;
  // Extra JSON fields a route should merge alongside `error` in the
  // response body (e.g. `{ accountCreated: true }`). Optional — most
  // AppErrors carry no additional response data.
  readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    statusCode: number,
    details?: Record<string, unknown>
  ) {
    super(message);

    this.statusCode = statusCode;
    this.details = details;
    this.name = new.target.name;

    Object.setPrototypeOf(this, new.target.prototype);
  }
}
