import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateEmail,
  normalizeUsernameOrEmail,
  validatePassword,
  formatAuthError,
} from './auth-validation';

test('validateEmail checks standard email addresses', () => {
  assert.equal(validateEmail('').isValid, false);
  assert.equal(validateEmail('   ').isValid, false);
  assert.equal(validateEmail('invalid-email').isValid, false);
  assert.equal(validateEmail('missing@domain').isValid, false);
  assert.equal(validateEmail('user@domain.com').isValid, true);
  assert.equal(validateEmail('test.name+tag@sub.example.co.uk').isValid, true);
});

test('normalizeUsernameOrEmail accepts both plain usernames and full emails', () => {
  assert.equal(normalizeUsernameOrEmail('').isValid, false);
  assert.equal(normalizeUsernameOrEmail('ab').isValid, false); // too short

  const userRes = normalizeUsernameOrEmail('rahul_tech');
  assert.equal(userRes.isValid, true);
  assert.equal(userRes.normalizedEmail, 'rahul_tech@aether.local');

  const emailRes = normalizeUsernameOrEmail('Agent@Mohan.io');
  assert.equal(emailRes.isValid, true);
  assert.equal(emailRes.normalizedEmail, 'agent@mohan.io');
});

test('validatePassword validates length and calculates strength', () => {
  const empty = validatePassword('');
  assert.equal(empty.isValid, false);
  assert.equal(empty.score, 0);

  const short = validatePassword('123');
  assert.equal(short.isValid, false);
  assert.ok(short.errors.some((e) => e.includes('at least 12 characters')));

  const simple = validatePassword('abcdef');
  assert.equal(simple.isValid, false);
  assert.equal(simple.strength, 'weak');

  const medium = validatePassword('Abcdefghijkl');
  assert.equal(medium.isValid, true);
  assert.ok(medium.score >= 2);

  assert.equal(validatePassword('x'.repeat(129)).isValid, false);

  const strong = validatePassword('SuperSecret!Password123#');
  assert.equal(strong.isValid, true);
  assert.equal(strong.strength, 'strong');
  assert.equal(strong.errors.length, 0);
});

test('formatAuthError translates common Supabase auth errors', () => {
  assert.equal(
    formatAuthError({ message: 'Invalid login credentials' }),
    'Invalid username/email or password. Please verify your credentials.',
  );
  assert.equal(
    formatAuthError({ message: 'User already registered' }),
    'A user with this username/email is already registered in Supabase.',
  );
  assert.equal(formatAuthError(null), 'An unexpected error occurred. Please try again.');
});
