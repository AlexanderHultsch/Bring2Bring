import { z } from 'zod';
import { hashPassword, verifyPassword } from './auth.js';
import {
  updateUserPasswordHash,
  updateUserUnitPreferences,
  updateUserSecurityQuestion,
} from '../repositories/users.js';

function asString(value) {
  return typeof value === 'string' ? value : '';
}

const PasswordChangeSchema = z
  .object({
    currentPassword: z.string().min(1, { message: 'Current password is required.' }),
    newPassword: z.string().min(12, { message: 'New password must be at least 12 characters.' }),
    confirmPassword: z.string().min(1, { message: 'Please confirm the new password.' }),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'New password and confirmation do not match.',
    path: ['confirmPassword'],
  });

// SPECIFICATION.md section 6.3: current password verified via the existing
// verifyPassword (no second hashing implementation), new password at least 12
// characters, confirmation must match. Failure never reveals more than the
// user needs and never echoes a password back.
export async function changePassword(db, user, body) {
  const parsed = PasswordChangeSchema.safeParse({
    currentPassword: asString(body?.currentPassword),
    newPassword: asString(body?.newPassword),
    confirmPassword: asString(body?.confirmPassword),
  });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const { currentPassword, newPassword } = parsed.data;

  const isCurrentValid = await verifyPassword(user.password_hash, currentPassword);
  if (!isCurrentValid) {
    return { success: false, error: 'Current password is incorrect.' };
  }

  const passwordHash = await hashPassword(newPassword);
  updateUserPasswordHash(db, user.id, passwordHash);
  return { success: true };
}

const UnitPreferencesSchema = z.object({
  unitLanguage: z.enum(['de', 'en'], { message: 'Choose a unit language.' }),
  measurementSystem: z.enum(['metric', 'imperial'], { message: 'Choose a measurement system.' }),
});

// SPECIFICATION.md sections 7.5 / 7.6: display-only per-user settings, never
// touching stored quantities or units. The zod schema is the real gate — the
// users.unit_language / measurement_system CHECK constraints are a backstop
// that normal use should never actually trip.
export function updateUnitPreferences(db, user, body) {
  const parsed = UnitPreferencesSchema.safeParse({
    unitLanguage: body?.unitLanguage,
    measurementSystem: body?.measurementSystem,
  });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  updateUserUnitPreferences(db, user.id, parsed.data);
  return { success: true };
}

const SecurityQuestionSchema = z.object({
  currentPassword: z.string().min(1, { message: 'Current password is required.' }),
  securityQuestion: z.string().trim().min(1, { message: 'A security question is required.' }),
  securityAnswer: z.string().trim().min(1, { message: 'A security answer is required.' }),
});

// SPECIFICATION.md section 6.2: the signed-in user sets or replaces their
// own security question. This requires the current password, verified via
// the existing verifyPassword exactly as changePassword does above — without
// it, anyone who got hold of a live session could set a question they know
// and then use the public reset route to seize the password, turning the
// reset feature into a privilege-escalation path.
export async function setSecurityQuestion(db, user, body) {
  const parsed = SecurityQuestionSchema.safeParse({
    currentPassword: asString(body?.currentPassword),
    securityQuestion: asString(body?.securityQuestion),
    securityAnswer: asString(body?.securityAnswer),
  });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const { currentPassword, securityQuestion, securityAnswer } = parsed.data;

  const isCurrentValid = await verifyPassword(user.password_hash, currentPassword);
  if (!isCurrentValid) {
    return { success: false, error: 'Current password is incorrect.' };
  }

  const securityAnswerHash = await hashPassword(securityAnswer.toLowerCase());
  updateUserSecurityQuestion(db, user.id, { securityQuestion, securityAnswerHash });
  return { success: true };
}
