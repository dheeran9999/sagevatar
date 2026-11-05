import { loadConfig } from './config.js';
import { prisma } from './lib/prisma.js';
import { createApp } from './app.js';
import { relocateLegacyLibraryFiles } from './lib/library-storage.js';

const config = loadConfig();
const moved = relocateLegacyLibraryFiles(config);
if (moved) console.log(`Moved ${moved} library file(s) from public to private storage.`);

const app = createApp(prisma, config);
const server = app.listen(config.PORT, () => {
  console.log(`SageVatar API listening on http://localhost:${config.PORT}`);
  if (!config.emailConfigured) {
    console.warn(
      config.isProduction
        ? 'SMTP is not configured — sign-up and password reset emails are disabled.'
        : 'SMTP is not configured — emails are NOT delivered; they are saved to storage/outbox and their links printed here.',
    );
  }
});

const shutdown = async () => {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
