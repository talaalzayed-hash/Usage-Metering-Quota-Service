
import { Router } from "express";
import { apiKeyAuth } from "../Middleware/apiKeyAuth.js";
import {
  getPlansController,
  getPlanByIdController,
  createPlanController,
  updatePlanController,
} from "../Controllers/planController.js";

const planRouter = Router();

planRouter.use("/plans", apiKeyAuth);

planRouter.get("/plans", getPlansController);
planRouter.post("/plans", createPlanController);
planRouter.get("/plans/:id", getPlanByIdController);
planRouter.patch("/plans/:id", updatePlanController);

export default planRouter;
