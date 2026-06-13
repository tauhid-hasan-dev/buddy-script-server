import { Router } from 'express';
import requireAuth from '../../middleware/auth';
import validate from '../../middleware/validate';
import { uploadPostImage } from '../../middleware/upload';
import { postCommentsRouter } from '../comments/comments.route';
import { createPostSchema, reactSchema, updatePostSchema } from './posts.validation';
import { PostsController } from './posts.controller';

const router = Router();

router.use(requireAuth);

// Multer runs before validation: it parses the multipart body so the text
// fields exist for Zod, and stores the optional "image" file.
router.post('/', uploadPostImage, validate(createPostSchema), PostsController.create);

router.get('/:id', PostsController.getPost);
router.patch('/:id', validate(updatePostSchema), PostsController.update);
router.delete('/:id', PostsController.remove);

// /like is kept as the reaction endpoint for backward compatibility; the
// optional { type } body selects which reaction (LIKE when the body is empty).
router.post('/:id/like', validate(reactSchema), PostsController.react);
router.delete('/:id/like', PostsController.unreact);
router.get('/:id/likes', PostsController.likers);

// Comments live in their own module; nested here for /posts/:postId/comments.
router.use('/:postId/comments', postCommentsRouter);

export default router;
