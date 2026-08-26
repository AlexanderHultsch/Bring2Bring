import { loadConfig } from './src/config.js';
import { openDatabase } from './src/db/index.js';
import { runMigrations } from './src/db/migrate.js';
import { createApp } from './src/app.js';

function main() {
  const config = loadConfig();
  const db = openDatabase(config.dbPath);
  runMigrations(db);

  const app = createApp({ db, config });

  const server = app.listen(config.port, () => {
    console.log(`Dishlist listening on port ${config.port}`);
  });

  const shutdown = () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
