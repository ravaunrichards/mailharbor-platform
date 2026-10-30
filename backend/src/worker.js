'use strict';

const { loadConfig } = require('./config');
const { pool } = require('./db');
const { createTransport } = require('./mailer');

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function claimJob(database) {
  const result = await database.query(
    `WITH candidate AS (
       SELECT id
       FROM mail_outbox
       WHERE (status = 'queued' AND next_attempt_at <= now())
          OR (status = 'processing' AND locked_at < now() - interval '5 minutes')
       ORDER BY created_at
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE mail_outbox AS job
     SET status = 'processing', attempts = job.attempts + 1, locked_at = now(), updated_at = now()
     FROM candidate
     WHERE job.id = candidate.id
     RETURNING job.*`
  );
  return result.rows[0] || null;
}

async function processJob(database, transport, job) {
  try {
    const recipients = job.recipients || {};
    const sent = await transport.sendMail({
      from: job.sender_email,
      replyTo: job.reply_to || undefined,
      to: recipients.to || [],
      cc: recipients.cc || [],
      bcc: recipients.bcc || [],
      subject: job.subject,
      text: job.body_text,
      headers: { 'X-MailHarbor-Outbox-ID': String(job.id) }
    });
    await database.query(
      `UPDATE mail_outbox
       SET status = 'sent', sent_at = now(), locked_at = NULL, last_error = NULL,
           provider_message_id = $2, updated_at = now()
       WHERE id = $1`,
      [job.id, sent.messageId || null]
    );
    if (job.message_id) {
      await database.query(
        `UPDATE mail_messages
         SET delivery_status = 'sent', sent_at = now(), last_error = NULL
         WHERE id = $1`,
        [job.message_id]
      );
    }
    process.stdout.write('Delivered MailHarbor outbox job ' + job.id + '\n');
  } catch (error) {
    const finalAttempt = Number(job.attempts) >= Number(job.max_attempts);
    const delayMs = Math.min(3600000, 1000 * (2 ** Math.min(Number(job.attempts), 10)));
    const safeError = String(error.message || 'SMTP delivery failed').slice(0, 1000);
    await database.query(
      `UPDATE mail_outbox
       SET status = $2, locked_at = NULL, last_error = $3,
           next_attempt_at = CASE WHEN $2 = 'queued' THEN now() + ($4 * interval '1 millisecond') ELSE next_attempt_at END,
           updated_at = now()
       WHERE id = $1`,
      [job.id, finalAttempt ? 'failed' : 'queued', safeError, delayMs]
    );
    if (job.message_id) {
      await database.query(
        'UPDATE mail_messages SET delivery_status = $2, last_error = $3 WHERE id = $1',
        [job.message_id, finalAttempt ? 'failed' : 'queued', safeError]
      );
    }
    process.stderr.write('MailHarbor delivery job ' + job.id + ' failed (' + (finalAttempt ? 'final' : 'retry scheduled') + '): ' + safeError + '\n');
  }
}

function startWorker(options = {}) {
  const config = options.config || loadConfig();
  const database = options.db || pool;
  let stopping = false;
  let transport = null;

  async function loop() {
    process.stdout.write('MailHarbor delivery loop started.\n');
    while (!stopping) {
      try {
        if (!config.smtp.configured) {
          await sleep(15000);
          continue;
        }
        if (!transport) {
          transport = createTransport(config.smtp);
          await transport.verify();
          process.stdout.write('MailHarbor SMTP connection verified.\n');
        }
        const job = await claimJob(database);
        if (!job) {
          await sleep(2000);
          continue;
        }
        await processJob(database, transport, job);
      } catch (error) {
        process.stderr.write('MailHarbor delivery loop error: ' + error.message + '\n');
        if (transport) {
          transport.close();
          transport = null;
        }
        await sleep(10000);
      }
    }
  }

  const done = loop();
  return {
    close: async () => {
      stopping = true;
      if (transport) {
        transport.close();
        transport = null;
      }
      await done;
    }
  };
}

async function run() {
  const worker = startWorker();
  const shutdown = async () => {
    await worker.close();
    await pool.end();
    process.exit(0);
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

if (require.main === module) {
  run().catch((error) => {
    process.stderr.write('MailHarbor worker stopped: ' + error.message + '\n');
    process.exitCode = 1;
  });
}

module.exports = { claimJob, processJob, startWorker };