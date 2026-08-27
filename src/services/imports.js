import { recordBringImport } from '../repositories/imports.js';

// SPECIFICATION.md section 8.5 (v2.0, D4): the day is a parameter rather than
// something this reads from the clock itself, so a test can drive a
// different day without mocking time — the route computes it (UTC date,
// YYYY-MM-DD).
export function recordImport(db, recipeId, deviceId, day) {
  return recordBringImport(db, recipeId, deviceId, day);
}
