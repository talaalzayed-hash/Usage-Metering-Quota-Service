import type { Request, Response, NextFunction } from "express";
import * as historyService from "../Services/historyService.js";
import {
  MAX_PAGE_SIZE,
  parseExternalId,
  parseMonth,
  parsePaging,
  parseRequestId,
} from "../Utils/validation.js";

// ?outcome= as the accepted flag: null when absent, undefined when invalid.
function parseOutcome(value: unknown): boolean | null | undefined {
  if (value === undefined) return null;
  if (value === "accepted") return true;
  if (value === "rejected") return false;
  return undefined;
}

// GET /requests?userId=&month=YYYY-MM&outcome=accepted|rejected&limit=&offset=
// Every filter is optional; without month the whole history is listed.
export async function listRequests(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = req.query.userId;
  const externalId = userId === undefined ? null : parseExternalId(userId);
  const month = parseMonth(req.query.month);
  const accepted = parseOutcome(req.query.outcome);
  const paging = parsePaging(req.query);

  if (externalId === null && userId !== undefined) {
    res.status(400).json({ message: "userId must be 1-200 characters" });
    return;
  }
  if (month === undefined) {
    res.status(400).json({ message: "month must be YYYY-MM" });
    return;
  }
  if (accepted === undefined) {
    res.status(400).json({ message: "outcome must be 'accepted' or 'rejected'" });
    return;
  }
  if (!paging) {
    res.status(400).json({
      message: `limit must be 1-${MAX_PAGE_SIZE} and offset must be 0 or more`,
    });
    return;
  }

  try {
    const page = await historyService.listRequests(
      res.locals.accountId,
      { externalId, monthStart: month, accepted },
      paging.limit,
      paging.offset,
    );
    res.status(200).json({ ...page, ...paging });
  } catch (error) {
    next(error);
  }
}

export async function getRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
  const requestId = parseRequestId(req.params.requestId);
  if (!requestId) {
    res.status(404).json({ message: "Request not found" });
    return;
  }

  try {
    const request = await historyService.getRequest(res.locals.accountId, requestId);
    if (!request) {
      res.status(404).json({ message: "Request not found" });
      return;
    }
    res.status(200).json({ request });
  } catch (error) {
    next(error);
  }
}
