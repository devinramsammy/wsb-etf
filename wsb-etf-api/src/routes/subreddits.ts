import { Router, Response } from "express";
import { SUBREDDITS } from "../subreddits.js";

const router = Router();

router.get("/", (_req, res: Response) => {
  res.json({ data: SUBREDDITS });
});

export default router;
