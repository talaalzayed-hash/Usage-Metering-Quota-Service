
import type { Request, Response, NextFunction } from "express";
import { createHash } from "node:crypto";
import { pool } from "../Config/database.js";

export async function apiKeyAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const apiKey = req.header("x-api-key");

  if (!apiKey) {
    res.status(401).json({ message: "Missing API key" });
    return;
  }

  try {
    const apiKeyHash = createHash("sha256")
      .update(apiKey)
      .digest("hex");

    const result = await pool.query(
      `SELECT id
       FROM accounts
       WHERE api_key_hash = $1`,
      [apiKeyHash],
    );

    if (result.rowCount === 0) {
      res.status(401).json({ message: "Invalid API key" });
      return;
    }

    res.locals.accountId = result.rows[0].id;
    next();
  } catch (error) {
    next(error);
  }
}
