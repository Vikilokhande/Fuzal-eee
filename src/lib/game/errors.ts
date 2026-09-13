export class GameError extends Error {
  constructor(
    public code:
      | "NOT_FOUND"
      | "FULL"
      | "ALREADY_STARTED"
      | "FORBIDDEN"
      | "BAD_REQUEST"
      | "CONFLICT"
      | "INVALID_STATE"
      | "OLD_GAME"
      | "TIME_EXPIRED"
      | "SESSION_EXPIRED"
      | "INTERNAL_ERROR",
    message: string,
    public httpStatus = 400,
  ) {
    super(message);
    this.name = "GameError";
  }
}
