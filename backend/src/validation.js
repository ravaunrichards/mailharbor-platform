'use strict';

const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isEmail(value) {
  return typeof value === 'string' && value.length <= 254 && EMAIL_PATTERN.test(value);
}

function validateRegistration(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'Request body must be an object.' };
  const email = normalizeEmail(input.email);
  const displayName = String(input.displayName || '').trim();
  const password = typeof input.password === 'string' ? input.password : '';
  if (!isEmail(email)) return { ok: false, error: 'Enter a valid email address.' };
  if (!displayName || displayName.length > 120) return { ok: false, error: 'Display name must contain 1–120 characters.' };
  if (password.length < 12 || password.length > 128) return { ok: false, error: 'Password must contain 12–128 characters.' };
  return { ok: true, value: { email, displayName, password } };
}

function validateLogin(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'Request body must be an object.' };
  const email = normalizeEmail(input.email);
  const password = typeof input.password === 'string' ? input.password : '';
  if (!isEmail(email) || !password || password.length > 128) return { ok: false, error: 'Enter a valid email address and password.' };
  return { ok: true, value: { email, password } };
}

function parseRecipients(value) {
  const values = Array.isArray(value) ? value : (typeof value === 'string' ? value.split(/[,\n;]/) : []);
  return values.map(normalizeEmail).filter(Boolean);
}

function validateCompose(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'Request body must be an object.' };
  const to = parseRecipients(input.to);
  const cc = parseRecipients(input.cc);
  const bcc = parseRecipients(input.bcc);
  const all = [...to, ...cc, ...bcc];
  const subject = String(input.subject || '').trim();
  const body = typeof input.body === 'string' ? input.body : '';
  if (all.length === 0) return { ok: false, error: 'Add at least one recipient.' };
  if (all.length > 50) return { ok: false, error: 'A message can have at most 50 recipients.' };
  if (all.some((email) => !isEmail(email))) return { ok: false, error: 'One or more recipient email addresses are invalid.' };
  if (new Set(all).size !== all.length) return { ok: false, error: 'Remove duplicate recipient addresses.' };
  if (subject.length > 998) return { ok: false, error: 'Subject is too long.' };
  if (!body.trim() || body.length > 100000) return { ok: false, error: 'Message body must contain 1–100,000 characters.' };
  return { ok: true, value: { to, cc, bcc, subject, body } };
}

function validateInbound(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'Invalid inbound message payload.' };
  const from = normalizeEmail(input.from);
  const to = parseRecipients(input.to);
  const subject = String(input.subject || '').trim();
  const text = typeof input.text === 'string' ? input.text : '';
  const messageId = String(input.messageId || '').trim();
  const eventId = String(input.eventId || messageId).trim();
  if (!isEmail(from) || !to.length || to.length > 50 || to.some((item) => !isEmail(item))) return { ok: false, error: 'Inbound sender or recipient address is invalid.' };
  if (!messageId || messageId.length > 500 || !eventId || eventId.length > 500) return { ok: false, error: 'Inbound eventId and messageId are required.' };
  if (subject.length > 998 || text.length > 100000) return { ok: false, error: 'Inbound message exceeds supported size limits.' };
  return { ok: true, value: { from, to: [...new Set(to)], subject, text, messageId, eventId } };
}

function validateMessagePatch(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'Request body must be an object.' };
  const value = {};
  if (Object.prototype.hasOwnProperty.call(input, 'isRead')) {
    if (typeof input.isRead !== 'boolean') return { ok: false, error: 'isRead must be a boolean.' };
    value.is_read = input.isRead;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'isStarred')) {
    if (typeof input.isStarred !== 'boolean') return { ok: false, error: 'isStarred must be a boolean.' };
    value.is_starred = input.isStarred;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'folder')) {
    const folder = String(input.folder).toLowerCase();
    if (!['inbox', 'sent', 'drafts', 'spam', 'trash', 'archive'].includes(folder)) return { ok: false, error: 'Unsupported folder.' };
    value.folder = folder;
  }
  if (!Object.keys(value).length) return { ok: false, error: 'No supported message changes were supplied.' };
  return { ok: true, value };
}

module.exports = { normalizeEmail, isEmail, validateRegistration, validateLogin, validateCompose, validateInbound, validateMessagePatch };