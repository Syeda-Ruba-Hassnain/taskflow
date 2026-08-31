import { AppError } from "./app-error";

export class AIResponseError extends AppError {
  constructor(message = "The AI did not return a usable response.") {
    super(message, 502);
  }
}
