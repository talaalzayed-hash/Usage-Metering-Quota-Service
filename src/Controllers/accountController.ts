import type { Request, Response, NextFunction } from "express";
import { createAccount } from "../Services/accountService.js";

export async function createAccountController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    // Protect account creation with an admin key.
    const adminApiKey = process.env.ADMIN_API_KEY;
    const providedKey = req.header("x-admin-key");

    if (!adminApiKey || providedKey !== adminApiKey) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const { name, planId } = req.body ?? {};
    if (
      typeof name !== "string" ||
      !name.trim() ||
      typeof planId !== "string" ||
      !planId.trim()
    ) {
      res.status(400).json({
        message: "name and planId are required",
      });
      console.log("Content-Type:", req.headers["content-type"]);
      console.log("Request body:", req.body);
      return;
    }

    const result = await createAccount({
      name: name.trim(),
      planId: planId.trim(),
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