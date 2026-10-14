import { Router } from "express";
import { createAccountController } from "../Controllers/accountController.js";

const accountRouter = Router();

accountRouter.post("/admin/accounts", createAccountController);

export default accountRouter;