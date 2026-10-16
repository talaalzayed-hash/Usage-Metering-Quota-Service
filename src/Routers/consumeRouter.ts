import { Router } from "express";
import { apiKeyAuth } from "../Middleware/apiKeyAuth.js";
import { consume } from "../Controllers/consumeController.js";

const consumeRouter = Router();

consumeRouter.post("/consume", apiKeyAuth, consume);

export default consumeRouter;
