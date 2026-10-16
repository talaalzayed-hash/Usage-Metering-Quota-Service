import { Router } from "express";
import { apiKeyAuth } from "../Middleware/apiKeyAuth.js";
import { getAccountUsage, listUserUsage } from "../Controllers/usageController.js";

const usageRouter = Router();

usageRouter.use("/usage", apiKeyAuth);

usageRouter.get("/usage", getAccountUsage);
usageRouter.get("/usage/users", listUserUsage);

export default usageRouter;
