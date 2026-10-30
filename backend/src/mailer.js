'use strict';

const nodemailer = require('nodemailer');

function createTransport(smtp) {
  if (!smtp || !smtp.configured) return null;
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    requireTLS: !smtp.secure,
    auth: { user: smtp.user, pass: smtp.password },
    tls: { rejectUnauthorized: true },
    pool: true,
    maxConnections: 3,
    maxMessages: 100
  });
}

module.exports = { createTransport };