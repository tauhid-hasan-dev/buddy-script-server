import { Router } from 'express';
import requireAuth from '../../middleware/auth';
import validate from '../../middleware/validate';
import { uploadPostImage } from '../../middleware/upload';
import { postCommentsRouter } from '../comments/comments.route';
import { createPostSchema } from './posts.validation';
import { PostsController } from './posts.controller';

const router = Router();

router.use(requireAuth);

// Multer runs before validation: it parses the multipart body so the text
// fields exist for Zod, and stores the optional "image" file.
router.post('/', uploadPostImage, validate(createPostSchema), PostsController.create);

router.get('/:id', PostsController.getPost);
router.delete('/:id', PostsController.remove);

router.post('/:id/like', PostsController.like);
router.delete('/:id/like', PostsController.unlike);
router.get('/:id/likes', PostsController.likers);

// Comments live in their own module; nested here for /posts/:postId/comments.
router.use('/:postId/comments', postCommentsRouter);

export default router;
