'use strict';

const { Pool } = require('pg');
const { loadConfig } = require('./config');

const config = loadConfig();
if (!config.databaseUrl) {
  throw new Error('DATABASE_URL is required. Configure a PostgreSQL database before starting MailHarbor.');
}

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: true } : undefined,
  max: Number(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  application_name: 'mailharbor'
});

pool.on('error', (error) => {
  process.stderr.write('MailHarbor PostgreSQL pool error: ' + error.message + '\n');
});

module.exports = { pool };