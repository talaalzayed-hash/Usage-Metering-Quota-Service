import { Router } from "express";
import { apiKeyAuth } from "../Middleware/apiKeyAuth.js";
import {
  createAccount,
    getAccount,
  changeAccountPlan,
} from "../Controllers/accountController.js";

const accountRouter = Router();

// Admin: create an account and issue its API key (x-admin-key).
accountRouter.post("/admin/accounts", createAccount);

// The calling account itself (x-api-key).
accountRouter.get("/account", apiKeyAuth, getAccount);
accountRouter.put("/account/plan", apiKeyAuth, changeAccountPlan);

export default accountRouter;