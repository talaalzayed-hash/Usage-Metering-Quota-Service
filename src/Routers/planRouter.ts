
import { Router } from "express";
import { apiKeyAuth } from "../Middleware/apiKeyAuth.js";
import {
  getPredefinedPlans,
  getPlans,
  getPlanById,
  createPlan,
  updatePlan,
} from "../Controllers/planController.js";

const planRouter = Router();

// Public: lets a new caller pick a predefined plan before it has an API key.
// Registered before the auth middleware so it does not require a key.
planRouter.get("/plans/predefined", getPredefinedPlans);

planRouter.use("/plans", apiKeyAuth);

planRouter.get("/plans", getPlans);
planRouter.post("/plans", createPlan);
planRouter.get("/plans/:id", getPlanById);
planRouter.patch("/plans/:id", updatePlan);

export default planRouter;
