import type { Request, Response, NextFunction } from "express";
import * as consumeService from "../Services/consumeService.js";
import { isPositiveInteger, parseExternalId, parseRequestId } from "../Utils/validation.js";

// Accepted and rejected are both 200: a rejection is a valid decision, not an
// error. Errors are bad input (400), unknown user (404) and a reused
// requestId with a different user or amount (409).
export async function consume(req: Request, res: Response, next: NextFunction): Promise<void> {
  const externalId = parseExternalId(req.body?.userId);
  const units = req.body?.units;
  const requestId = parseRequestId(req.body?.requestId);

  if (!externalId || !isPositiveInteger(units) || !requestId) {
    res.status(400).json({
      message:
        "userId (1-200 characters), a positive whole number of units and " +
        "requestId (1-200 characters) are required",
    });
    return;
  }

  try {
    const result = await consumeService.consume(res.locals.accountId, {
      externalId,
      units,
      requestId,
    });
    res.status(200).json(result);
  } catch (error) {
    if (error instanceof Error && error.message === "USER_NOT_FOUND") {
      res.status(404).json({ message: "User not found" });
      return;
    }
    if (error instanceof Error && error.message === "IDEMPOTENCY_CONFLICT") {
      res.status(409).json({
        message: "requestId was already used with a different userId or units",
      });
      return;
    }
    next(error);
  }
}
