import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

const validEnv = () => ({
  SESSION_SECRET: 'a'.repeat(16),
  ADMIN_USER: 'admin',
  ADMIN_PASSWORD: 'super-secret-password',
  PUBLIC_BASE_URL: 'https://dishlist.example.com',
});

test('a fully valid minimal env returns the expected object with all defaults applied', () => {
  const config = loadConfig(validEnv());
  assert.deepEqual(config, {
    port: 3000,
    dbPath: './data/dishlist.db',
    uploadDir: './data/uploads',
    sessionSecret: 'a'.repeat(16),
    adminUser: 'admin',
    adminPassword: 'super-secret-password',
    publicBaseUrl: 'https://dishlist.example.com',
    trustProxy: 1,
    nodeEnv: 'production',
    numberLocale: 'de-DE',
    isProduction: true,
  });
});

for (const key of ['SESSION_SECRET', 'ADMIN_USER', 'ADMIN_PASSWORD', 'PUBLIC_BASE_URL']) {
  test(`missing ${key} throws and names the variable`, () => {
    const env = validEnv();
    delete env[key];
    assert.throws(() => loadConfig(env), (err) => {
      assert.match(err.message, new RegExp(key));
      return true;
    });
  });
}

test('SESSION_SECRET shorter than 16 chars throws', () => {
  const env = validEnv();
  env.SESSION_SECRET = 'short';
  assert.throws(() => loadConfig(env), /SESSION_SECRET/);
});

test('PUBLIC_BASE_URL without a scheme throws', () => {
  const env = validEnv();
  env.PUBLIC_BASE_URL = 'dishlist.example.com';
  assert.throws(() => loadConfig(env), /PUBLIC_BASE_URL/);
});

test('PUBLIC_BASE_URL with a trailing slash is stored without it', () => {
  const env = validEnv();
  env.PUBLIC_BASE_URL = 'https://dishlist.example.com/';
  const config = loadConfig(env);
  assert.equal(config.publicBaseUrl, 'https://dishlist.example.com');
});

test('PORT="abc" throws', () => {
  const env = validEnv();
  env.PORT = 'abc';
  assert.throws(() => loadConfig(env), /PORT/);
});

test('PORT absent defaults to 3000', () => {
  const config = loadConfig(validEnv());
  assert.equal(config.port, 3000);
});

test('PORT="8080" is coerced to the number 8080', () => {
  const env = validEnv();
  env.PORT = '8080';
  const config = loadConfig(env);
  assert.equal(config.port, 8080);
  assert.equal(typeof config.port, 'number');
});

test('TRUST_PROXY="0" is coerced to 0, not defaulted back to 1', () => {
  const env = validEnv();
  env.TRUST_PROXY = '0';
  const config = loadConfig(env);
  assert.equal(config.trustProxy, 0);
});

test('the error message for a missing SESSION_SECRET does not leak the value of other supplied variables', () => {
  const env = validEnv();
  delete env.SESSION_SECRET;
  env.ADMIN_PASSWORD = 'totally-unique-secret-value-xyz';
  assert.throws(() => loadConfig(env), (err) => {
    assert.ok(!err.message.includes('totally-unique-secret-value-xyz'));
    return true;
  });
});
