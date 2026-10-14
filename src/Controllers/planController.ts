
import type { Request, Response, NextFunction } from "express";
import * as planService from "../Services/planService.js";

function isPositiveInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0
  );
}

export async function getPlansController(
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

export async function getPlanByIdController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const plan = await planService.getPlanById(
      res.locals.accountId,
      String(req.params.id),
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

export async function createPlanController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const { scope, name, monthlyAllowance, maxPerRequest } =
    req.body ?? {};

  if (
    (scope !== "account" && scope !== "user") ||
    typeof name !== "string" ||
    !name.trim() ||
    !isPositiveInteger(monthlyAllowance) ||
    !isPositiveInteger(maxPerRequest)
  ) {
    res.status(400).json({
      message:
        "scope, name, positive integer monthlyAllowance, and positive integer maxPerRequest are required",
    });
    return;
  }

  if (maxPerRequest > monthlyAllowance) {
    res.status(400).json({
      message: "maxPerRequest cannot exceed monthlyAllowance",
    });
    return;
  }

  try {
    const plan = await planService.createPlan(
      res.locals.accountId,
      {
        scope,
        name: name.trim(),
        monthlyAllowance,
        maxPerRequest,
      },
    );

    res.status(201).json({ plan });
  } catch (error) {
    next(error);
  }
}

export async function updatePlanController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const { name, monthlyAllowance, maxPerRequest } =
    req.body ?? {};

  const hasName = name !== undefined;
  const hasMonthlyAllowance = monthlyAllowance !== undefined;
  const hasMaxPerRequest = maxPerRequest !== undefined;

  if (!hasName && !hasMonthlyAllowance && !hasMaxPerRequest) {
    res.status(400).json({
      message: "Provide at least one field to update",
    });
    return;
  }

  if (
    (hasName &&
      (typeof name !== "string" || !name.trim())) ||
    (hasMonthlyAllowance &&
      !isPositiveInteger(monthlyAllowance)) ||
    (hasMaxPerRequest &&
      !isPositiveInteger(maxPerRequest))
  ) {
    res.status(400).json({
      message: "Invalid plan update fields",
    });
    return;
  }

  try {
    const existingPlan = await planService.getPlanById(
      res.locals.accountId,
      String(req.params.id),
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

    const finalAllowance =
      monthlyAllowance ?? Number(existingPlan.monthly_allowance);

    const finalMaxPerRequest =
      maxPerRequest ?? Number(existingPlan.max_per_request);

    if (finalMaxPerRequest > finalAllowance) {
      res.status(400).json({
        message: "maxPerRequest cannot exceed monthlyAllowance",
      });
      return;
    }

    const plan = await planService.updatePlan(
      res.locals.accountId,
      String(req.params.id),
      {
        ...(hasName ? { name: name.trim() } : {}),
        ...(hasMonthlyAllowance ? { monthlyAllowance } : {}),
        ...(hasMaxPerRequest ? { maxPerRequest } : {}),
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
