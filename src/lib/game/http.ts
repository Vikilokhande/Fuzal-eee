import { ZodError } from "zod";
import { GameError } from "./service";

/** Maps domain / validation errors to friendly JSON responses. */
export function errorResponse(e: unknown): Response {
  if (e instanceof GameError) {
    return Response.json(
      { error: e.code, message: e.message },
      { status: e.httpStatus },
    );
  }
  if (e instanceof ZodError) {
    const first = e.issues[0];
    return Response.json(
      {
        error: "BAD_REQUEST",
        message: first?.message ?? "Invalid request.",
      },
      { status: 422 },
    );
  }
  console.error("[fuzal] unexpected error", e);
  return Response.json(
    { error: "INTERNAL", message: "Something went wrong. Please try again." },
    { status: 500 },
  );
}
