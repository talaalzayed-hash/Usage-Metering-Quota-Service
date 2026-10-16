import type { Request, Response, NextFunction } from "express";
import * as userService from "../Services/userService.js";
import * as usageService from "../Services/usageService.js";
import {
  MAX_PAGE_SIZE,
  parseExternalId,
  parseId,
  parseMonth,
  parsePaging,
} from "../Utils/validation.js";

export async function createUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  const externalId = parseExternalId(req.body?.externalId);
  const planId = parseId(req.body?.planId);

  if (!externalId || !planId) {
    res.status(400).json({
      message: "externalId (1-200 characters) and a numeric planId are required",
    });
    return;
  }

  try {
    const user = await userService.createUser(res.locals.accountId, externalId, planId);
    res.status(201).json({ user });
  } catch (error) {
    if (error instanceof Error && error.message === "USER_PLAN_NOT_FOUND") {
      res.status(400).json({ message: "The specified user plan does not exist" });
      return;
    }
    if ((error as { code?: string }).code === "23505") {
      res.status(409).json({ message: "A user with this externalId already exists" });
      return;
    }
    next(error);
  }
}

export async function listUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
  const paging = parsePaging(req.query);
  if (!paging) {
    res.status(400).json({
      message: `limit must be 1-${MAX_PAGE_SIZE} and offset must be 0 or more`,
    });
    return;
  }

  try {
    const users = await userService.listUsers(res.locals.accountId, paging.limit, paging.offset);
    res.status(200).json({ users, ...paging });
  } catch (error) {
    next(error);
  }
}

export async function getUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  const externalId = parseExternalId(req.params.externalId);
  if (!externalId) {
    res.status(404).json({ message: "User not found" });
    return;
  }

  try {
    const user = await userService.getUserByExternalId(res.locals.accountId, externalId);
    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }
    res.status(200).json({ user });
  } catch (error) {
    next(error);
  }
}

export async function getUserLimits(req: Request, res: Response, next: NextFunction): Promise<void> {
  const externalId = parseExternalId(req.params.externalId);
  if (!externalId) {
    res.status(404).json({ message: "User not found" });
    return;
  }

  try {
    const limits = await userService.getUserLimits(res.locals.accountId, externalId);
    if (!limits) {
      res.status(404).json({ message: "User not found" });
      return;
    }
    res.status(200).json(limits);
  } catch (error) {
    next(error);
  }
}

export async function getUserUsage(req: Request, res: Response, next: NextFunction): Promise<void> {
  const externalId = parseExternalId(req.params.externalId);
  const month = parseMonth(req.query.month);
  if (!externalId) {
    res.status(404).json({ message: "User not found" });
    return;
  }
  if (month === undefined) {
    res.status(400).json({ message: "month must be YYYY-MM" });
    return;
  }

  try {
    const usage = await usageService.getUserUsage(res.locals.accountId, externalId, month);
    if (!usage) {
      res.status(404).json({ message: "User not found" });
      return;
    }
    res.status(200).json({ user: usage });
  } catch (error) {
    next(error);
  }
}

export async function changeUserPlan(req: Request, res: Response, next: NextFunction): Promise<void> {
  const externalId = parseExternalId(req.params.externalId);
  const planId = parseId(req.body?.planId);

  if (!externalId) {
    res.status(404).json({ message: "User not found" });
    return;
  }
  if (!planId) {
    res.status(400).json({ message: "A numeric planId is required" });
    return;
  }

  try {
    const user = await userService.changeUserPlan(res.locals.accountId, externalId, planId);
    res.status(200).json({ user });
  } catch (error) {
    if (error instanceof Error && error.message === "USER_NOT_FOUND") {
      res.status(404).json({ message: "User not found" });
      return;
    }
    if (error instanceof Error && error.message === "USER_PLAN_NOT_FOUND") {
      res.status(400).json({ message: "The specified user plan does not exist" });
      return;
    }
    next(error);
  }
}
