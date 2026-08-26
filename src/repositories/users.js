export function findUserById(db, id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

export function findUserByUsername(db, username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

export function insertUser(db, { username, email, passwordHash, role }) {
  const columns = ['username', 'password_hash'];
  const values = [username, passwordHash];

  if (email !== undefined) {
    columns.push('email');
    values.push(email);
  }
  if (role !== undefined) {
    columns.push('role');
    values.push(role);
  }

  const placeholders = columns.map(() => '?').join(', ');
  const { lastInsertRowid } = db
    .prepare(`INSERT INTO users (${columns.join(', ')}) VALUES (${placeholders})`)
    .run(...values);

  return findUserById(db, lastInsertRowid);
}

export function updateUserPasswordHash(db, id, passwordHash) {
  const { changes } = db
    .prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .run(passwordHash, id);
  return changes;
}

export function updateUserRole(db, id, role) {
  const { changes } = db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  return changes;
}

export function updateUserLastLoginAt(db, id, isoTimestamp) {
  const { changes } = db
    .prepare('UPDATE users SET last_login_at = ? WHERE id = ?')
    .run(isoTimestamp, id);
  return changes;
}

export function countUsers(db) {
  return db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
}
