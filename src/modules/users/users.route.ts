import { Router } from 'express';
import requireAuth from '../../middleware/auth';
import validate from '../../middleware/validate';
import { uploadAvatar } from '../../middleware/upload';
import { updateProfileSchema } from './users.validation';
import { UsersController } from './users.controller';

const router = Router();

router.get('/', requireAuth, UsersController.listUsers);
router.patch('/me', requireAuth, validate(updateProfileSchema), UsersController.updateMe);

// Avatar upload/remove. Multer parses the multipart "avatar" field before the
// controller; the static "/me/avatar" paths are declared ahead of "/:id" so
// they aren't captured by the dynamic id route.
router.post('/me/avatar', requireAuth, uploadAvatar, UsersController.uploadAvatar);
router.delete('/me/avatar', requireAuth, UsersController.deleteAvatar);

router.get('/:id', requireAuth, UsersController.getUser);

export default router;
