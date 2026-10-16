import { Router } from "express";
import { apiKeyAuth } from "../Middleware/apiKeyAuth.js";
import { getRequest, listRequests } from "../Controllers/historyController.js";

const historyRouter = Router();

historyRouter.use("/requests", apiKeyAuth);

historyRouter.get("/requests", listRequests);
historyRouter.get("/requests/:requestId", getRequest);

export default historyRouter;
