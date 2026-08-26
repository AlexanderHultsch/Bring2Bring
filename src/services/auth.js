import argon2 from 'argon2';
import { findUserByUsername } from '../repositories/users.js';

export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

let dummyHashPromise;

function getDummyHash() {
  if (!dummyHashPromise) {
    dummyHashPromise = argon2.hash('dishlist-timing-defence-dummy-password', ARGON2_OPTIONS);
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
