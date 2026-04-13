import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import marketRouter from "./market.js";
import tradesRouter from "./trades.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(marketRouter);
router.use(tradesRouter);

export default router;
