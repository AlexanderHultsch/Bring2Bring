import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db/index.js';
import { runMigrations } from '../src/db/migrate.js';
import { findUserByUsername, insertUser, updateUserPasswordHash, updateUserRole } from '../src/repositories/users.js';
import { hashPassword } from '../src/services/auth.js';

async function main() {
  const config = loadConfig();
  const db = openDatabase(config.dbPath);
  runMigrations(db);

  const passwordHash = await hashPassword(config.adminPassword);
  const existing = findUserByUsername(db, config.adminUser);

  if (existing) {
    updateUserPasswordHash(db, existing.id, passwordHash);
    updateUserRole(db, existing.id, 'admin');
    console.log(`Admin user "${config.adminUser}" updated.`);
  } else {
    insertUser(db, { username: config.adminUser, passwordHash, role: 'admin' });
    console.log(`Admin user "${config.adminUser}" created.`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
