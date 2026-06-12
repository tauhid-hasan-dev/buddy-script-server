import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import config from '../../config';
import validate from '../../middleware/validate';
import requireAuth from '../../middleware/auth';
import { registerSchema, loginSchema } from './auth.validation';
import { AuthController } from './auth.controller';

const router = Router();

// Throttle credential endpoints to slow brute-force and signup spam.
// Disabled under test so the suite isn't throttled.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again later' },
  skip: () => config.nodeEnv === 'test',
});

router.post('/register', authLimiter, validate(registerSchema), AuthController.register);
router.post('/login', authLimiter, validate(loginSchema), AuthController.login);
router.post('/logout', AuthController.logout);
router.get('/me', requireAuth, AuthController.me);

export default router;
