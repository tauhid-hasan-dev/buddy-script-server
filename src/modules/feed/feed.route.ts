import { Router } from 'express';
import requireAuth from '../../middleware/auth';
import { FeedController } from './feed.controller';

const router = Router();

router.get('/', requireAuth, FeedController.getFeed);
router.get('/updates', requireAuth, FeedController.getUpdates);

export default router;
