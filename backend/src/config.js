'use strict';

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

function normalizeRealtimeUrl(value, nodeEnv) {
  const raw = String(value || '').trim();
  if (!raw) return nodeEnv === 'production' ? '' : 'ws://localhost:3001';
  if (/^wss?:\/\//i.test(raw)) return raw.replace(/\/+$/, '');
  if (/^https?:\/\//i.test(raw)) return raw.replace(/^http/i, 'ws').replace(/\/+$/, '');
  return 'wss://' + raw.replace(/^\/+|\/+$/g, '');
}

function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const jwtSecret = env.JWT_SECRET || (nodeEnv === 'production' ? '' : 'local-only-change-this-secret-before-deploying');
  if (nodeEnv === 'production' && Buffer.byteLength(jwtSecret) < 32) {
    throw new Error('JWT_SECRET must contain at least 32 bytes in production.');
  }

  const smtpHost = (env.SMTP_HOST || '').trim();
  const smtpUser = (env.SMTP_USER || '').trim();
  const smtpPassword = env.SMTP_PASSWORD || '';
  const mailFrom = (env.MAIL_FROM || '').trim();
  const appBaseUrl = (env.APP_BASE_URL || env.RENDER_EXTERNAL_URL || 'http://localhost:3000').replace(/\\/+$/, '');
  const configuredOrigins = (env.CORS_ORIGINS || '').split(',').map((item) => item.trim()).filter(Boolean);
  const defaultOrigin = new URL(appBaseUrl).origin;
  const realtimeUrl = env.REALTIME_PUBLIC_URL || (env.RENDER_EXTERNAL_HOSTNAME ? 'wss://' + env.RENDER_EXTERNAL_HOSTNAME : '');
  const realtimeOrigins = (env.REALTIME_ALLOWED_ORIGINS || env.CORS_ORIGINS || defaultOrigin)
    .split(',').map((item) => item.trim()).filter(Boolean);

  return {
    nodeEnv,
    isProduction: nodeEnv === 'production',
    port: Number(env.PORT || 3000),
    databaseUrl: env.DATABASE_URL || '',
    databaseSsl: bool(env.DATABASE_SSL, false),
    jwtSecret,
    trustProxy: bool(env.TRUST_PROXY, nodeEnv === 'production'),
    appBaseUrl: (env.APP_BASE_URL || 'http://localhost:3000').replace(/\/+$/, ''),
    corsOrigins: configuredOrigins.length ? configuredOrigins : [defaultOrigin],
    realtimePublicUrl: normalizeRealtimeUrl(realtimeUrl, nodeEnv),
    realtimeAllowedOrigins: realtimeOrigins,
    inboundWebhookSecret: env.INBOUND_WEBHOOK_SECRET || '',
    smtp: {
      host: smtpHost,
      port: Number(env.SMTP_PORT || 587),
      secure: bool(env.SMTP_SECURE, Number(env.SMTP_PORT || 587) === 465),
      user: smtpUser,
      password: smtpPassword,
      from: mailFrom,
      configured: Boolean(smtpHost && smtpUser && smtpPassword && mailFrom)
    }
  };
}

module.exports = { loadConfig };