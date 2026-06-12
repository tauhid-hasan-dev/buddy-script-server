import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import config from './config';
import authRoutes from './modules/auth/auth.route';
import feedRoutes from './modules/feed/feed.route';
import usersRoutes from './modules/users/users.route';
import postsRoutes from './modules/posts/posts.route';
import commentsRoutes from './modules/comments/comments.route';
import { notFound, errorHandler } from './middleware/error';
import { UPLOAD_DIR } from './middleware/upload';

const app = express();

// Security headers (CSP, X-Content-Type-Options, etc.). CORP is relaxed so
// the frontend on another origin can render uploaded images.
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// Cookies only flow cross-origin with an explicit origin + credentials.
app.use(
  cors({
    origin: config.clientUrl,
    credentials: true,
  })
);

app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

// Uploaded post images; filenames are random UUIDs so they're immutable.
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d', immutable: true }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.use('/api/auth', authRoutes);
app.use('/api/feed', feedRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/posts', postsRoutes);
app.use('/api/comments', commentsRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
