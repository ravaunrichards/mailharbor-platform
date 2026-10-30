'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const { Client } = require('pg');
const { WebSocketServer } = require('ws');
const { loadConfig } = require('./config');
const { pool } = require('./db');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}

function createRealtimeService(options = {}) {
  const config = options.config || loadConfig();
  const db = options.db || pool;
  const clientsByOwner = new Map();
  let stopping = false;
  let listenerConnected = false;
  let listenerClient = null;
  let stopListener = null;

  const ownsServer = !options.server;
  const server = options.server || http.createServer(async (req, res) => {
    const pathname = new URL(req.url || '/', 'http://localhost').pathname;
    if (req.method === 'GET' && pathname === '/health/live') {
      return json(res, 200, { status: 'ok', service: 'mailharbor-realtime' });
    }
    if (req.method === 'GET' && pathname === '/health/ready') {
      try {
        await db.query('SELECT 1');
        const ready = listenerConnected;
        return json(res, ready ? 200 : 503, {
          status: ready ? 'ready' : 'degraded',
          service: 'mailharbor-realtime',
          database: 'connected',
          postgresNotifications: listenerConnected,
          connectedClients: [...clientsByOwner.values()].reduce((total, sockets) => total + sockets.size, 0)
        });
      } catch (_error) {
        return json(res, 503, { status: 'not-ready', service: 'mailharbor-realtime', database: 'disconnected' });
      }
    }
    return json(res, 404, { error: 'Route not found.' });
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 2048, perMessageDeflate: false });

  server.on('upgrade', (req, socket, head) => {
    let pathname;
    try {
      pathname = new URL(req.url || '/', 'http://localhost').pathname;
    } catch (_error) {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    if (pathname !== '/ws') {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const origin = req.headers.origin;
    if (origin && !config.realtimeAllowedOrigins.includes(origin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  function removeClient(ownerId, ws) {
    if (!ownerId) return;
    const sockets = clientsByOwner.get(ownerId);
    if (!sockets) return;
    sockets.delete(ws);
    if (sockets.size === 0) clientsByOwner.delete(ownerId);
  }

  wss.on('connection', (ws) => {
    let ownerId = null;
    const authTimer = setTimeout(() => {
      if (!ownerId) ws.close(4401, 'Authentication required');
    }, 5000);

    ws.on('message', async (raw, isBinary) => {
      if (ownerId) return;
      if (isBinary) {
        ws.close(4400, 'Invalid authentication message');
        return;
      }
      let input;
      try {
        input = JSON.parse(raw.toString('utf8'));
      } catch (_error) {
        ws.close(4400, 'Invalid authentication message');
        return;
      }
      const ticket = typeof input?.ticket === 'string' ? input.ticket.trim() : '';
      if (input?.type !== 'authenticate' || !/^[a-f0-9]{64}$/i.test(ticket)) {
        ws.close(4401, 'A valid one-time ticket is required');
        return;
      }
      try {
        const result = await db.query(
          'UPDATE mail_realtime_tickets SET consumed_at = now() ' +
          'WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now() ' +
          'RETURNING owner_id',
          [sha256(ticket)]
        );
        if (!result.rowCount) {
          ws.close(4401, 'Realtime ticket is invalid or expired');
          return;
        }
        ownerId = String(result.rows[0].owner_id);
        clearTimeout(authTimer);
        if (!clientsByOwner.has(ownerId)) clientsByOwner.set(ownerId, new Set());
        clientsByOwner.get(ownerId).add(ws);
        ws.send(JSON.stringify({ type: 'ready', service: 'mailharbor-realtime', connectedAt: new Date().toISOString() }));
      } catch (error) {
        process.stderr.write('MailHarbor realtime ticket validation failed: ' + error.message + '\n');
        ws.close(1011, 'Authentication service unavailable');
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimer);
      removeClient(ownerId, ws);
    });
    ws.on('error', () => {});
  });

  function broadcast(rawPayload) {
    let payload;
    try {
      payload = JSON.parse(rawPayload);
    } catch (_error) {
      return;
    }
    if (!payload || !payload.ownerId || !payload.messageId) return;
    const sockets = clientsByOwner.get(String(payload.ownerId));
    if (!sockets) return;
    const event = JSON.stringify({
      type: 'mail.message.changed',
      messageId: String(payload.messageId),
      operation: String(payload.operation || 'changed'),
      occurredAt: new Date().toISOString()
    });
    for (const ws of sockets) {
      if (ws.readyState === 1) {
        try { ws.send(event); } catch (_error) {}
      }
    }
  }

  async function listenToDatabase() {
    while (!stopping) {
      const client = new Client({
        connectionString: config.databaseUrl,
        ssl: config.databaseSsl ? { rejectUnauthorized: true } : undefined,
        application_name: 'mailharbor-realtime-listener'
      });
      let wake;
      const finished = new Promise((resolve) => { wake = resolve; });
      try {
        client.on('notification', (message) => {
          if (message.channel === 'mailharbor_mail_events' && message.payload) broadcast(message.payload);
        });
        client.on('error', (error) => {
          if (!stopping) process.stderr.write('MailHarbor realtime listener error: ' + error.message + '\n');
          wake();
        });
        await client.connect();
        await client.query('LISTEN mailharbor_mail_events');
        listenerClient = client;
        listenerConnected = true;
        stopListener = wake;
        process.stdout.write('MailHarbor PostgreSQL notification listener connected.\n');
        await finished;
      } catch (error) {
        if (!stopping) process.stderr.write('MailHarbor realtime database listener unavailable: ' + error.message + '\n');
      } finally {
        listenerConnected = false;
        listenerClient = null;
        stopListener = null;
        try { await client.end(); } catch (_error) {}
      }
      if (!stopping) await sleep(3000);
    }
  }

  async function close() {
    stopping = true;
    if (stopListener) stopListener();
    if (listenerClient) {
      try { await listenerClient.end(); } catch (_error) {}
    }
    for (const ws of wss.clients) {
      try { ws.terminate(); } catch (_error) {}
    }
    await new Promise((resolve) => wss.close(() => resolve()));
    if (ownsServer && server.listening) await new Promise((resolve) => server.close(() => resolve()));
    if (!options.db) await db.end();
  }

  function listen(port = config.port) {
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, () => {
        server.removeListener('error', reject);
        resolve(server.address());
      });
    });
  }

  return { server, wss, listen, listenToDatabase, close, get isReady() { return listenerConnected; } };
}

async function start() {
  const service = createRealtimeService();
  const config = loadConfig();
  const address = await service.listen(config.port);
  process.stdout.write('MailHarbor realtime service listening on port ' + address.port + '\n');
  void service.listenToDatabase();
  const shutdown = async () => {
    await service.close();
    process.exit(0);
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

if (require.main === module) {
  start().catch((error) => {
    process.stderr.write('MailHarbor realtime startup failed: ' + error.message + '\n');
    process.exitCode = 1;
  });
}

module.exports = { createRealtimeService, sha256 };
