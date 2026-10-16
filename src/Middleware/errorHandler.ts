import type { Request, Response, NextFunction } from "express";

// Postgres error codes we can explain to the caller instead of a 500.
const PG_ERRORS: Record<string, { status: number; message: string }> = {
  "22P02": { status: 400, message: "Invalid input value" },
  "22003": { status: 400, message: "Numeric value out of range" },
  "23505": { status: 409, message: "Resource already exists" },
  "23503": { status: 400, message: "Referenced resource does not exist" },
  "23514": { status: 400, message: "Value violates a constraint" },
};

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ message: "Route not found" });
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const err = error as { type?: string; code?: string; status?: number };

  // Malformed JSON body from express.json().
  if (err.type === "entity.parse.failed") {
    res.status(400).json({ message: "Request body is not valid JSON" });
    return;
  }

  if (typeof err.code === "string") {
    const known = PG_ERRORS[err.code];
    if (known) {
      res.status(known.status).json({ message: known.message });
      return;
    }
  }

  console.error("Unhandled error:", error);
  res.status(500).json({ message: "Internal server error" });
}
