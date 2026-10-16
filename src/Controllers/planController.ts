
import type { Request, Response, NextFunction } from "express";
import * as planService from "../Services/planService.js";
import {
  isNonNegativeInteger,
  isPositiveInteger,
  parseId,
} from "../Utils/validation.js";
import { pool } from "../Config/database.js";

// dailyAllowance is optional: null (or absent on create) means no daily rule.
function isValidDailyAllowance(value: unknown): value is number | null {
  return value === null || isNonNegativeInteger(value);
}

export async function getPredefinedPlans(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const plans = await planService.getPredefinedPlans();
    res.status(200).json({ plans });
  } catch (error) {
    next(error);
  }
}

export async function getPlans(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const plans = await planService.getPlans(res.locals.accountId);
    res.status(200).json({ plans });
  } catch (error) {
    next(error);
  }
}

export async function getPlanById(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const planId = parseId(req.params.id);
  if (!planId) {
    res.status(404).json({ message: "Plan not found" });
    return;
  }

  try {
    const plan = await planService.getPlanById(res.locals.accountId, planId);

    if (!plan) {
      res.status(404).json({ message: "Plan not found" });
      return;
    }

    res.status(200).json({ plan });
  } catch (error) {
    next(error);
  }
}

export async function createPlan(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const { scope, name, monthlyAllowance, maxPerRequest } = req.body ?? {};
  const dailyAllowance = req.body?.dailyAllowance ?? null;

  if (
    (scope !== "account" && scope !== "user") ||
    typeof name !== "string" ||
    !name.trim() ||
    !isNonNegativeInteger(monthlyAllowance) ||
    !isPositiveInteger(maxPerRequest) ||
    !isValidDailyAllowance(dailyAllowance)
  ) {
    res.status(400).json({
      message:
        "scope ('account' or 'user'), name, non-negative integer monthlyAllowance, " +
        "positive integer maxPerRequest are required; dailyAllowance is an optional " +
        "non-negative integer or null",
    });
    return;
  }

  try {
    const plan = await planService.createPlan(res.locals.accountId, {
      scope,
      name: name.trim(),
      monthlyAllowance,
      maxPerRequest,
      dailyAllowance,
    });

    res.status(201).json({ plan });
  } catch (error) {
    next(error);
  }
}


export async function updatePlan(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const planId = parseId(req.params.id);

  if (!planId) {
    res.status(404).json({ message: "Plan not found" });
    return;
  }

  const { name, monthlyAllowance, maxPerRequest, dailyAllowance } =
    req.body ?? {};

  const hasName = name !== undefined;
  const hasMonthlyAllowance = monthlyAllowance !== undefined;
  const hasMaxPerRequest = maxPerRequest !== undefined;
  const hasDailyAllowance = dailyAllowance !== undefined;

  if (
    !hasName &&
    !hasMonthlyAllowance &&
    !hasMaxPerRequest &&
    !hasDailyAllowance
  ) {
    res.status(400).json({
      message: "Provide at least one field to update",
    });
    return;
  }

  if (
    (hasName && (typeof name !== "string" || !name.trim())) ||
    (hasMonthlyAllowance && !isNonNegativeInteger(monthlyAllowance)) ||
    (hasMaxPerRequest && !isPositiveInteger(maxPerRequest)) ||
    (hasDailyAllowance &&
      !(dailyAllowance === null || isNonNegativeInteger(dailyAllowance)))
  ) {
    res.status(400).json({
      message: "Invalid plan update fields",
    });
    return;
  }

  try {
    const accountId = res.locals.accountId as string;

    const existingPlan = await planService.getPlanById(
      accountId,
      planId,
    );

    if (!existingPlan) {
      res.status(404).json({ message: "Plan not found" });
      return;
    }

    if (existingPlan.owner_account_id == null) {
      res.status(403).json({
        message: "Predefined plans cannot be modified",
      });
      return;
    }

    const plan = await planService.updatePlan(
      accountId,
      planId,
      {
        ...(hasName ? { name: name.trim() } : {}),
        ...(hasMonthlyAllowance ? { monthlyAllowance } : {}),
        ...(hasMaxPerRequest ? { maxPerRequest } : {}),
        ...(hasDailyAllowance ? { dailyAllowance } : {}),
      },
    );

    if (!plan) {
      res.status(404).json({ message: "Plan not found" });
      return;
    }

    res.status(200).json({ plan });
  } catch (error) {
    next(error);
  }
}
