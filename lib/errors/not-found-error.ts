import { AppError } from "./app-error";

export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super(message, 404);
  }
}
