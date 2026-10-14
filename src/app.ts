
import express from "express";
import accountRouter from "./Routers/accountRouter.js";
import planRouter from "./Routers/planRouter.js";
const app = express();

// Parse incoming JSON request bodies
app.use(express.json());

// Register routers
app.use(accountRouter);
app.use(planRouter);


export default app;

