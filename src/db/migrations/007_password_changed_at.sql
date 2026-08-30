ALTER TABLE users ADD COLUMN password_changed_at TEXT;

UPDATE users SET password_changed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
