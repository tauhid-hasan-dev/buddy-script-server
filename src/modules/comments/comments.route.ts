import { Router } from 'express';
import requireAuth from '../../middleware/auth';
import validate from '../../middleware/validate';
import { writeLimiter } from '../../middleware/rateLimit';
import { createCommentSchema } from './comments.validation';
import { CommentsController } from './comments.controller';

// Nested under /api/posts/:postId/comments — mergeParams exposes :postId.
// requireAuth is applied by the parent posts router.
export const postCommentsRouter = Router({ mergeParams: true });
postCommentsRouter.post('/', writeLimiter, validate(createCommentSchema), CommentsController.create);
postCommentsRouter.get('/', CommentsController.listForPost);

// Comment-centric routes at /api/comments/:id/...
const router = Router();
router.use(requireAuth);

router.get('/:id/replies', CommentsController.listReplies);
router.post('/:id/like', writeLimiter, CommentsController.like);
router.delete('/:id/like', CommentsController.unlike);
router.get('/:id/likes', CommentsController.likers);

export default router;
