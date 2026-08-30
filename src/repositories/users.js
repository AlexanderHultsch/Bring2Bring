export function findUserById(db, id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

// Deliberately narrow, not findUserById: the only caller is the public share
// route (src/routes/share.js), open to the internet, which has no business
// with a row that carries password_hash.
export function findUnitPreferencesByUserId(db, id) {
  return db.prepare('SELECT unit_language, measurement_system FROM users WHERE id = ?').get(id);
}

export function findUserByUsername(db, username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

// Deliberately narrow, not findUserByUsername: the only caller is the public,
// unauthenticated password-reset route, which has no business holding a row
// that carries password_hash.
export function findResetChallengeByUsername(db, username) {
  return db
    .prepare('SELECT id, security_question, security_answer_hash FROM users WHERE username = ?')
    .get(username);
}

export function insertUser(
  db,
  { username, email, passwordHash, role, securityQuestion, securityAnswerHash }
) {
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
  if (securityQuestion !== undefined) {
    columns.push('security_question');
    values.push(securityQuestion);
  }
  if (securityAnswerHash !== undefined) {
    columns.push('security_answer_hash');
    values.push(securityAnswerHash);
  }

  const placeholders = columns.map(() => '?').join(', ');
  const { lastInsertRowid } = db
    .prepare(`INSERT INTO users (${columns.join(', ')}) VALUES (${placeholders})`)
    .run(...values);

  return findUserById(db, lastInsertRowid);
}

// passwordChangedAt is required, not merely positional: every caller (login's
// changePassword, the security-question reset, and scripts/seed-admin.js)
// must stamp it in the same write as the hash, because a session is only
// evicted by this stamp changing to something it wasn't before — a caller
// that silently omitted it used to write NULL, which on a second such write
// compares NULL to NULL and evicts nobody. Throwing here turns that into an
// immediate failure instead of a quiet hole in the one protection this
// column exists for.
export function updateUserPasswordHash(db, id, passwordHash, passwordChangedAt) {
  if (typeof passwordChangedAt !== 'string' || passwordChangedAt === '') {
    throw new TypeError('updateUserPasswordHash requires passwordChangedAt');
  }
  const { changes } = db
    .prepare('UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?')
    .run(passwordHash, passwordChangedAt, id);
  return changes;
}

export function updateUserRole(db, id, role) {
  const { changes } = db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  return changes;
}

export function updateUserUnitPreferences(db, id, { unitLanguage, measurementSystem }) {
  const { changes } = db
    .prepare('UPDATE users SET unit_language = ?, measurement_system = ? WHERE id = ?')
    .run(unitLanguage, measurementSystem, id);
  return changes;
}

export function updateUserSecurityQuestion(db, id, { securityQuestion, securityAnswerHash }) {
  const { changes } = db
    .prepare('UPDATE users SET security_question = ?, security_answer_hash = ? WHERE id = ?')
    .run(securityQuestion, securityAnswerHash, id);
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
