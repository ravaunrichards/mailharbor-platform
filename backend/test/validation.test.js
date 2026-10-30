'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateRegistration,
  validateLogin,
  validateCompose,
  validateInbound,
  validateMessagePatch
} = require('../src/validation');

test('normalizes and accepts a valid account registration', () => {
  const result = validateRegistration({ email: ' Person@Example.com ', displayName: 'Person', password: 'a-strong-password-123' });
  assert.equal(result.ok, true);
  assert.equal(result.value.email, 'person@example.com');
});

test('rejects passwords shorter than 12 characters', () => {
  assert.equal(validateRegistration({ email: 'person@example.com', displayName: 'Person', password: 'short' }).ok, false);
});

test('rejects malformed login addresses', () => {
  assert.equal(validateLogin({ email: 'not-an-email', password: 'not-empty' }).ok, false);
});

test('accepts valid compose message and parses recipients', () => {
  const result = validateCompose({ to: 'one@example.com, two@example.com', subject: 'Hello', body: 'A real message body' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.to, ['one@example.com', 'two@example.com']);
});

test('rejects compose with no recipient or empty body', () => {
  assert.equal(validateCompose({ to: '', body: 'text' }).ok, false);
  assert.equal(validateCompose({ to: 'one@example.com', body: '  ' }).ok, false);
});

test('rejects too many and duplicate recipients', () => {
  assert.equal(validateCompose({ to: Array(51).fill('one@example.com'), body: 'text' }).ok, false);
  assert.equal(validateCompose({ to: ['one@example.com', 'one@example.com'], body: 'text' }).ok, false);
});

test('validates inbound provider events', () => {
  assert.equal(validateInbound({
    eventId: 'evt-1',
    messageId: '<message-1@example.net>',
    from: 'sender@example.net',
    to: ['member@example.com'],
    subject: 'Hello',
    text: 'Inbound content'
  }).ok, true);
});

test('message patch accepts only supported safe changes', () => {
  assert.deepEqual(validateMessagePatch({ isRead: true, folder: 'archive' }), {
    ok: true,
    value: { is_read: true, folder: 'archive' }
  });
  assert.equal(validateMessagePatch({ ownerId: 99 }).ok, false);
  assert.equal(validateMessagePatch({ folder: 'other-user' }).ok, false);
});

test('rejects non-object payloads', () => {
  assert.equal(validateRegistration(null).ok, false);
  assert.equal(validateCompose([]).ok, false);
});
