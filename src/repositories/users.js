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
