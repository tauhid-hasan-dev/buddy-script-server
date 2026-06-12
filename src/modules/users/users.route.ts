import { Router } from 'express';
import requireAuth from '../../middleware/auth';
import validate from '../../middleware/validate';
import { updateProfileSchema } from './users.validation';
import { UsersController } from './users.controller';

const router = Router();

router.get('/', requireAuth, UsersController.listUsers);
router.patch('/me', requireAuth, validate(updateProfileSchema), UsersController.updateMe);
router.get('/:id', requireAuth, UsersController.getUser);

export default router;
