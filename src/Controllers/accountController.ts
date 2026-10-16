import type { Request, Response, NextFunction } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import * as accountService from "../Services/accountService.js";
import { parseId } from "../Utils/validation.js";

// Constant-time comparison. Hashing first gives both buffers the same length,
// which timingSafeEqual requires, and hides the real key length.
function isAdminKey(providedKey: string | undefined): boolean {
  const adminApiKey = process.env.ADMIN_API_KEY;
  if (!adminApiKey || !providedKey) {
    return false;
  }

  const expected = createHash("sha256").update(adminApiKey).digest();
  const provided = createHash("sha256").update(providedKey).digest();
  return timingSafeEqual(expected, provided);
}

export async function createAccount(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    // Protect account creation with an admin key.
    if (!isAdminKey(req.header("x-admin-key"))) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const { name } = req.body ?? {};
    const planId = parseId(req.body?.planId);
    if (typeof name !== "string" || !name.trim() || !planId) {
      res.status(400).json({
        message: "name and a numeric planId are required",
      });
      return;
    }

    const result = await accountService.createAccount({
      name: name.trim(),
      planId,
    });

    res.status(201).json({
      message: "Account created successfully",
      account: result.account,
      apiKey: result.apiKey,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "ACCOUNT_PLAN_NOT_FOUND") {
      res.status(400).json({
        message: "The specified account plan does not exist",
      });
      return;
    }

    next(error);
  }
  
}

export async function getAccount(
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const account = await accountService.getAccountById(res.locals.accountId);
    if (!account) {
      res.status(404).json({ message: "Account not found" });
      return;
    }
    res.status(200).json({ account });
  } catch (error) {
    next(error);
  }
}

export async function changeAccountPlan(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const planId = parseId(req.body?.planId);
  if (!planId) {
    res.status(400).json({ message: "A numeric planId is required" });
    return;
  }
  try {
    const account = await accountService.changeAccountPlan(res.locals.accountId, planId);
    res.status(200).json({ account });
  } catch (error) {
    if (error instanceof Error && error.message === "ACCOUNT_PLAN_NOT_FOUND") {
      res.status(400).json({
        message: "The specified account plan does not exist",
      });
      return;
    }

    next(error);
  }
}