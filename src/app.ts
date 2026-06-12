import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import config from './config';
import authRoutes from './modules/auth/auth.route';
import feedRoutes from './modules/feed/feed.route';
import usersRoutes from './modules/users/users.route';
import { notFound, errorHandler } from './middleware/error';

const app = express();

// Security headers (CSP, X-Content-Type-Options, etc.)
app.use(helmet());

// Cookies only flow cross-origin with an explicit origin + credentials.
app.use(
  cors({
    origin: config.clientUrl,
    credentials: true,
  })
);

app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.use('/api/auth', authRoutes);
app.use('/api/feed', feedRoutes);
app.use('/api/users', usersRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
