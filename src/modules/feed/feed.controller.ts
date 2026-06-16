import type { Request, Response } from 'express';
import { FeedService } from './feed.service';
import { feedQuerySchema, feedUpdatesQuerySchema } from './feed.validation';

// GET /api/feed?cursor=<lastPostId>&limit=20
async function getFeed(req: Request, res: Response): Promise<void> {
  // Express 5's req.query is a read-only getter, so query params are
  // validated here rather than via the body-replacing validate middleware.
  // A ZodError thrown here becomes a 400 in the global error handler.
  const query = feedQuerySchema.parse(req.query);
  const page = await FeedService.getFeed(req.user!.id, query);
  res.json(page);
}

// GET /api/feed/updates?after=<newestPostId>&limit=10
// The client's live-update poll: returns posts newer than `after`. Uncached so
// other users' posts surface within one poll interval, not one cache TTL.
async function getUpdates(req: Request, res: Response): Promise<void> {
  const query = feedUpdatesQuerySchema.parse(req.query);
  const updates = await FeedService.getUpdates(req.user!.id, query);
  res.json(updates);
}

export const FeedController = { getFeed, getUpdates };
