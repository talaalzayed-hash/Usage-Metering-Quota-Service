import type { Request, Response, NextFunction } from "express";
import * as usageService from "../Services/usageService.js";
import { MAX_PAGE_SIZE, parseMonth, parsePaging } from "../Utils/validation.js";

export async function getAccountUsage(req: Request, res: Response, next: NextFunction): Promise<void> {
  const month = parseMonth(req.query.month);
  if (month === undefined) {
    res.status(400).json({ message: "month must be YYYY-MM" });
    return;
  }

  try {
    const account = await usageService.getAccountUsage(res.locals.accountId, month);
    res.status(200).json({ account });
  } catch (error) {
    next(error);
  }
}

// The account total next to a page of its users, so callers can see that the
// account's usage is the sum of its users' usage.
export async function listUserUsage(req: Request, res: Response, next: NextFunction): Promise<void> {
  const month = parseMonth(req.query.month);
  const paging = parsePaging(req.query);
  if (month === undefined || !paging) {
    res.status(400).json({
      message: `month must be YYYY-MM; limit must be 1-${MAX_PAGE_SIZE} and offset must be 0 or more`,
    });
    return;
  }

  try {
    const accountId = res.locals.accountId;
    const [account, users] = await Promise.all([
      usageService.getAccountUsage(accountId, month),
      usageService.listUserUsage(accountId, month, paging.limit, paging.offset),
    ]);
    res.status(200).json({ account, users, ...paging });
  } catch (error) {
    next(error);
  }
}
