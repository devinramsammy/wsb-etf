import { Request } from "express";
import {
  DEFAULT_SUBREDDIT,
  isValidSubreddit,
  SubredditId,
} from "../subreddits.js";

export function parseSubredditQuery(
  req: Request<object, object, object, { subreddit?: string }>,
): SubredditId | { error: string } {
  const raw = req.query.subreddit;
  if (raw === undefined) {
    return DEFAULT_SUBREDDIT;
  }
  const normalized = raw.trim().toLowerCase().replace(/^r\//, "");
  if (!isValidSubreddit(normalized)) {
    return { error: `Unknown subreddit '${raw}'.` };
  }
  return normalized;
}
