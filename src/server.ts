import config from './config';
import app from './app';
import prisma from './lib/prisma';

const server = app.listen(config.port, () => {
  console.log(`Server listening on http://localhost:${config.port}`);
});

// Graceful shutdown: stop accepting connections, then release the DB pool.
function shutdown(signal: string): void {
  console.log(`${signal} received, shutting down...`);
  server.close(() => {
    void prisma.$disconnect().finally(() => process.exit(0));
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
