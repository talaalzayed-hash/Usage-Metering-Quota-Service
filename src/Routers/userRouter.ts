import { Router } from "express";
import { apiKeyAuth } from "../Middleware/apiKeyAuth.js";
import {
  createUser,
  listUsers,
  getUser,
  getUserLimits,
  getUserUsage,
  changeUserPlan,
} from "../Controllers/userController.js";

const userRouter = Router();

userRouter.use("/users", apiKeyAuth);

userRouter.post("/users", createUser);
userRouter.get("/users", listUsers);
userRouter.get("/users/:externalId", getUser);
userRouter.get("/users/:externalId/limits", getUserLimits);
userRouter.get("/users/:externalId/usage", getUserUsage);
userRouter.put("/users/:externalId/plan", changeUserPlan);

export default userRouter;