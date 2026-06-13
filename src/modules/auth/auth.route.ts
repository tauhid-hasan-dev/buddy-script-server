import { Router } from 'express';
import validate from '../../middleware/validate';
import requireAuth from '../../middleware/auth';
import { authLimiter } from '../../middleware/rateLimit';
import { registerSchema, loginSchema } from './auth.validation';
import { AuthController } from './auth.controller';

const router = Router();

router.post('/register', authLimiter, validate(registerSchema), AuthController.register);
router.post('/login', authLimiter, validate(loginSchema), AuthController.login);
router.post('/logout', AuthController.logout);
router.get('/me', requireAuth, AuthController.me);

export default router;
