import config from './config';
import app from './app';
import prisma from './lib/prisma';
import { redisClient } from './lib/redis';

const server = app.listen(config.port, () => {
  console.log(`Server listening on http://localhost:${config.port}`);
});

// Graceful shutdown: stop accepting connections, then release the DB pool and
// the optional Redis connection.
function shutdown(signal: string): void {
  console.log(`${signal} received, shutting down...`);
  server.close(() => {
    void Promise.allSettled([
      prisma.$disconnect(),
      redisClient?.quit(),
    ]).finally(() => process.exit(0));
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
