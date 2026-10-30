'use strict';

const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://mailharbor:test@127.0.0.1:5432/mailharbor_test';
process.env.JWT_SECRET = 'mailharbor-test-secret-with-at-least-32-bytes';

const { createApp } = require('../src/server');
const { issueAccessToken } = require('../src/security');

const secret = process.env.JWT_SECRET;
const config = {
  nodeEnv: 'test',
  isProduction: false,
  port: 0,
  databaseUrl: process.env.DATABASE_URL,
  databaseSsl: false,
  jwtSecret: secret,
  trustProxy: false,
  appBaseUrl: 'http://127.0.0.1',
  corsOrigins: ['http://127.0.0.1'],
  realtimePublicUrl: 'ws://127.0.0.1:3001',
  realtimeAllowedOrigins: ['http://127.0.0.1'],
  inboundWebhookSecret: '',
  smtp: {
    host: '', port: 587, secure: false, user: '', password: '', from: '', configured: false
  }
};

const queries = [];
const fakeDb = {
  async query(sql, values = []) {
    queries.push({ sql, values });
    if (sql === 'SELECT 1') return { rows: [{ '?column?': 1 }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  },
  async connect() {
    throw new Error('Unexpected database transaction in this API test.');
  }
};

const app = createApp({ config, db: fakeDb });
let server;
let origin;
const token = issueAccessToken({ id: 7, email: 'member@example.com', display_name: 'Member' }, secret);

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  origin = 'http://127.0.0.1:' + server.address().port;
});

after(async () => {
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  if (options.auth) headers.set('authorization', 'Bearer ' + token);
  const response = await fetch(origin + path, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  return { response, data: await response.json().catch(() => null) };
}

test('serves the MailHarbor mailbox frontend', async () => {
  const response = await fetch(origin + '/');
  assert.equal(response.status, 200);
  assert.match(await response.text(), /MailHarbor/);
});

test('reports API liveness without exposing secrets', async () => {
  const { response, data } = await api('/health/live');
  assert.equal(response.status, 200);
  assert.deepEqual(data, { status: 'ok', service: 'mailharbor-api' });
  assert.equal(JSON.stringify(data).includes(secret), false);
});

test('readiness checks PostgreSQL and reports inactive mail providers honestly', async () => {
  const { response, data } = await api('/health/ready');
  assert.equal(response.status, 200);
  assert.equal(data.database, 'connected');
  assert.equal(data.outboundEmailConfigured, false);
  assert.equal(data.inboundEmailConfigured, false);
});

test('public status does not claim mail sending is enabled', async () => {
  const { response, data } = await api('/api/status');
  assert.equal(response.status, 200);
  assert.equal(data.outboundEmailConfigured, false);
  assert.equal(data.registrationAvailable, false);
});

test('issues a short-lived one-use realtime ticket to an authenticated mailbox owner', async () => {
  queries.length = 0;
  const { response, data } = await api('/api/realtime/ticket', { method: 'POST', auth: true, body: {} });
  assert.equal(response.status, 201);
  assert.match(data.ticket, /^[a-f0-9]{64}$/);
  assert.equal(data.expiresInSeconds, 60);
  const ticketInsert = queries.find((entry) => entry.sql.includes('INSERT INTO mail_realtime_tickets'));
  assert.ok(ticketInsert);
  assert.equal(ticketInsert.values[0], 7);
  assert.equal(ticketInsert.values[1].length, 64);
  assert.notEqual(ticketInsert.values[1], data.ticket);
});

test('protects mailbox routes from unauthenticated callers', async () => {
  const { response, data } = await api('/api/messages');
  assert.equal(response.status, 401);
  assert.equal(data.error, 'Sign in to continue.');
});

test('scopes an authenticated mailbox query to its account id', async () => {
  queries.length = 0;
  const { response, data } = await api('/api/messages?folder=inbox', { auth: true });
  assert.equal(response.status, 200);
  assert.deepEqual(data.messages, []);
  const mailboxQuery = queries.find((entry) => entry.sql.includes('FROM mail_messages'));
  assert.ok(mailboxQuery);
  assert.equal(mailboxQuery.values[0], 7);
  assert.equal(mailboxQuery.values[1], 'inbox');
});

test('refuses account registration until real SMTP verification mail is configured', async () => {
  const { response, data } = await api('/api/auth/register', {
    method: 'POST',
    body: { email: 'new@example.com', displayName: 'New Member', password: 'a-strong-password-123' }
  });
  assert.equal(response.status, 503);
  assert.match(data.error, /SMTP/);
});

test('refuses outbound send when SMTP is not configured', async () => {
  const { response, data } = await api('/api/messages', {
    method: 'POST',
    auth: true,
    body: { to: 'recipient@example.com', subject: 'Hello', body: 'This is not sent.' }
  });
  assert.equal(response.status, 503);
  assert.match(data.error, /No message was saved or sent/);
});

test('refuses unsigned inbound delivery when provider signing is not configured', async () => {
  const { response, data } = await api('/api/webhooks/inbound', {
    method: 'POST',
    body: { eventId: 'event-1' }
  });
  assert.equal(response.status, 503);
  assert.match(data.error, /not configured/);
});
