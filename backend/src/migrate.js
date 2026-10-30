'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('./db');

async function migrate(database = pool) {
  const directory = process.env.MIGRATIONS_DIR || path.resolve(__dirname, '../../database/migrations');
  await database.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())'
  );
  const files = fs.readdirSync(directory).filter((name) => /^\d+_[a-z0-9_-]+\.sql$/i.test(name)).sort();
  for (const filename of files) {
    const existing = await database.query('SELECT filename FROM schema_migrations WHERE filename = $1', [filename]);
    if (existing.rowCount) continue;
    const sql = fs.readFileSync(path.join(directory, filename), 'utf8');
    const client = await database.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(filename) VALUES ($1)', [filename]);
      await client.query('COMMIT');
      process.stdout.write('Applied migration ' + filename + '\n');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

if (require.main === module) {
  migrate().then(() => pool.end()).catch(async (error) => {
    process.stderr.write('Database migration failed: ' + error.message + '\n');
    await pool.end();
    process.exitCode = 1;
  });
}

module.exports = { migrate };