import argon2 from 'argon2';
import { z } from 'zod';
import {
  findUserByUsername,
  findResetChallengeByUsername,
  insertUser,
  updateUserPasswordHash,
} from '../repositories/users.js';

export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

let dummyHashPromise;

function getDummyHash() {
  if (!dummyHashPromise) {
    dummyHashPromise = argon2.hash('bring2bring-timing-defence-dummy-password', ARGON2_OPTIONS);
  }
  return dummyHashPromise;
}

export async function hashPassword(plainPassword) {
  return argon2.hash(plainPassword, ARGON2_OPTIONS);
}

export async function verifyPassword(hash, plainPassword) {
  try {
    return await argon2.verify(hash, plainPassword);
  } catch {
    return false;
  }
}

export async function authenticate(db, username, plainPassword) {
  const user = findUserByUsername(db, username);

  if (!user) {
    await verifyPassword(await getDummyHash(), plainPassword);
    return null;
  }

  const isValid = await verifyPassword(user.password_hash, plainPassword);
  if (!isValid) {
    return null;
  }

  return user;
}

function asString(value) {
  return typeof value === 'string' ? value : '';
}

const RegisterSchema = z.object({
  username: z
    .string()
    .min(3, { message: 'Username must be 3–32 characters.' })
    .max(32, { message: 'Username must be 3–32 characters.' })
    .regex(/^[a-zA-Z0-9_-]+$/, {
      message: 'Username may only contain letters, numbers, underscores and hyphens.',
    }),
  password: z.string().min(12, { message: 'Password must be at least 12 characters.' }),
  securityQuestion: z.string().trim().min(1, { message: 'A security question is required.' }),
  securityAnswer: z.string().trim().min(1, { message: 'A security answer is required.' }),
});

// SPECIFICATION.md section 6.2: open, self-service registration — no invite,
// no email. Username charset matches the account concept of the owner's
// other app, TipsyTrails. The security answer is hashed with the same
// function as the password, after trim + lowercase, and is never stored or
// compared in the clear. role is left for insertUser's default — a
// registered account is an ordinary user, never an admin.
export async function registerUser(db, body) {
  const parsed = RegisterSchema.safeParse({
    username: asString(body?.username),
    password: asString(body?.password),
    securityQuestion: asString(body?.securityQuestion),
    securityAnswer: asString(body?.securityAnswer),
  });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const { username, password, securityQuestion, securityAnswer } = parsed.data;

  if (findUserByUsername(db, username)) {
    return { success: false, error: 'That username is already taken.' };
  }

  const passwordHash = await hashPassword(password);
  const securityAnswerHash = await hashPassword(securityAnswer.toLowerCase());

  const user = insertUser(db, { username, passwordHash, securityQuestion, securityAnswerHash });

  return { success: true, user };
}

// SPECIFICATION.md section 6.2: the security question is the password
// reset, so this returns one shape for "no such user" and "user has no
// question set" — an account with no question set must behave exactly like
// an account that does not exist, not error differently.
export function readResetChallenge(db, username) {
  const row = findResetChallengeByUsername(db, asString(username));
  if (!row || !row.security_question) {
    return null;
  }
  return row.security_question;
}

const ResetPasswordSchema = z.object({
  username: z.string().min(1, { message: 'Username is required.' }),
  securityAnswer: z.string().trim().min(1, { message: 'An answer is required.' }),
  newPassword: z.string().min(12, { message: 'New password must be at least 12 characters.' }),
});

const RESET_FAILURE = 'That username and answer do not match.';

// SPECIFICATION.md section 6.2/6.3: a missing user, a user with no question
// set, and a wrong answer all return this same message — nothing here tells
// the caller which case occurred. verifyPassword against the dummy hash
// mirrors authenticate()'s timing defence above for the no-such-user case.
export async function resetPasswordWithAnswer(db, body) {
  const parsed = ResetPasswordSchema.safeParse({
    username: asString(body?.username),
    securityAnswer: asString(body?.securityAnswer),
    newPassword: asString(body?.newPassword),
  });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const { username, securityAnswer, newPassword } = parsed.data;

  const row = findResetChallengeByUsername(db, username);
  if (!row || !row.security_answer_hash) {
    await verifyPassword(await getDummyHash(), securityAnswer);
    return { success: false, error: RESET_FAILURE };
  }

  const isValid = await verifyPassword(row.security_answer_hash, securityAnswer.toLowerCase());
  if (!isValid) {
    return { success: false, error: RESET_FAILURE };
  }

  const passwordHash = await hashPassword(newPassword);
  updateUserPasswordHash(db, row.id, passwordHash, new Date().toISOString());
  return { success: true };
}
