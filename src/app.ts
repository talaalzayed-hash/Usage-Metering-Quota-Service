
import express from "express";
import accountRouter from "./Routers/accountRouter.js";
import planRouter from "./Routers/planRouter.js";
import userRouter from "./Routers/userRouter.js";
import consumeRouter from "./Routers/consumeRouter.js";
import usageRouter from "./Routers/usageRouter.js";
import historyRouter from "./Routers/historyRouter.js";
import { errorHandler, notFoundHandler } from "./Middleware/errorHandler.js";
const app = express();

// Parse incoming JSON request bodies
app.use(express.json());

// Register routers
app.use(accountRouter);
app.use(planRouter);
app.use(userRouter);
app.use(consumeRouter);
app.use(usageRouter);
app.use(historyRouter);

// Unknown routes and errors always answer with JSON
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
