'use strict';

const API_BASE = window.MAILHARBOR_API_BASE || '';
const $ = (id) => document.getElementById(id);
let token = sessionStorage.getItem('mailharbor-token') || '';
let currentUser = null;
let currentFolder = 'inbox';
let messageList = [];
let selected = new Set();
let mailStatus = { outboundEmailConfigured: false, inboundEmailConfigured: false };
let authMode = 'login';
let searchTimer = null;
let realtimeSocket = null;
let realtimeReconnectTimer = null;
let realtimeRetryDelay = 1000;
let realtimeStopped = true;
let realtimeRefreshTimer = null;

const folderNames = {
  inbox: 'Inbox',
  starred: 'Starred',
  sent: 'Sent',
  spam: 'Spam',
  trash: 'Trash',
  archive: 'Archive'
};

function setFeedback(element, message, isError = false) {
  element.textContent = message || '';
  element.classList.toggle('error', Boolean(isError));
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  if (token && options.auth !== false) headers.set('Authorization', 'Bearer ' + token);
  const response = await fetch(API_BASE + '/api' + path, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    credentials: 'same-origin'
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'Request failed (' + response.status + ').');
    error.status = response.status;
    throw error;
  }
  return data;
}

function setAuthMode(mode) {
  authMode = mode;
  const registering = mode === 'register';
  $('auth-title').textContent = registering ? 'Create your account' : 'Welcome back';
  $('auth-copy').textContent = registering ? 'Set up your MailHarbor account.' : 'Sign in to open your mailbox.';
  $('auth-submit').textContent = registering ? 'Create account' : 'Sign in';
  $('mode-copy').textContent = registering ? 'Already have an account?' : 'New to MailHarbor?';
  $('mode-toggle').textContent = registering ? 'Sign in' : 'Create an account';
  $('name-field').classList.toggle('is-hidden', !registering);
  $('display-name').required = registering;
  $('auth-password').autocomplete = registering ? 'new-password' : 'current-password';
  $('auth-feedback').textContent = '';
}

function updateCapabilityText() {
  if (mailStatus.outboundEmailConfigured) {
    $('auth-capability').textContent = 'Email delivery is configured. New accounts require email verification.';
  } else {
    $('auth-capability').textContent = 'Email registration and sending are disabled until a real SMTP provider is configured.';
  }
  $('compose').disabled = !mailStatus.outboundEmailConfigured;
  $('send').disabled = !mailStatus.outboundEmailConfigured;
  $('service-banner').classList.toggle('is-hidden', mailStatus.outboundEmailConfigured && mailStatus.inboundEmailConfigured);
  if (!mailStatus.outboundEmailConfigured) {
    $('service-banner').textContent = 'Outbound mail is not configured. No messages can be sent yet. Add verified SMTP credentials to enable sending and account verification.';
  } else if (!mailStatus.inboundEmailConfigured) {
    $('service-banner').textContent = 'Outbound mail is configured. Inbound mail is waiting for a signed provider webhook and verified MX routing.';
  }
}

function showAuth() {
  stopRealtime();
  $('auth-shell').classList.remove('is-hidden');
  $('mail-app').classList.add('is-hidden');
}

function showMailbox() {
  $('auth-shell').classList.add('is-hidden');
  $('mail-app').classList.remove('is-hidden');
  $('signed-email').textContent = currentUser.email;
  if (mailStatus.realtimeUrl) {
    realtimeStopped = false;
    connectRealtime();
  }
}

function scheduleRealtimeReconnect() {
  if (realtimeStopped || !token || !mailStatus.realtimeUrl || realtimeReconnectTimer) return;
  const delay = realtimeRetryDelay;
  realtimeRetryDelay = Math.min(30000, realtimeRetryDelay * 2);
  realtimeReconnectTimer = setTimeout(() => {
    realtimeReconnectTimer = null;
    connectRealtime();
  }, delay);
}

async function connectRealtime() {
  if (realtimeStopped || !token || !mailStatus.realtimeUrl || realtimeSocket) return;
  try {
    const auth = await request('/realtime/ticket', { method: 'POST', body: {} });
    if (realtimeStopped || !token) return;
    const socket = new WebSocket(mailStatus.realtimeUrl);
    realtimeSocket = socket;
    socket.addEventListener('open', () => {
      if (realtimeSocket === socket) socket.send(JSON.stringify({ type: 'authenticate', ticket: auth.ticket }));
    });
    socket.addEventListener('message', (event) => {
      let message;
      try { message = JSON.parse(event.data); } catch (_error) { return; }
      if (message.type === 'ready') {
        realtimeRetryDelay = 1000;
      } else if (message.type === 'mail.message.changed' && !realtimeStopped) {
        clearTimeout(realtimeRefreshTimer);
        realtimeRefreshTimer = setTimeout(() => loadMessages().catch(() => {}), 120);
      }
    });
    socket.addEventListener('close', () => {
      if (realtimeSocket === socket) realtimeSocket = null;
      scheduleRealtimeReconnect();
    });
    socket.addEventListener('error', () => socket.close());
  } catch (_error) {
    scheduleRealtimeReconnect();
  }
}

function stopRealtime() {
  realtimeStopped = true;
  clearTimeout(realtimeReconnectTimer);
  clearTimeout(realtimeRefreshTimer);
  realtimeReconnectTimer = null;
  realtimeRefreshTimer = null;
  if (realtimeSocket) {
    const socket = realtimeSocket;
    realtimeSocket = null;
    try { socket.close(1000, 'Signed out'); } catch (_error) {}
  }
}

async function loadMessages() {
  const query = new URLSearchParams({ folder: currentFolder });
  const search = $('search').value.trim();
  if (search) query.set('search', search);
  const result = await request('/messages?' + query.toString());
  messageList = result.messages || [];
  selected.clear();
  renderMessages();
}

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function renderMessages() {
  $('heading').textContent = folderNames[currentFolder] || 'Inbox';
  $('subheading').textContent = currentFolder === 'inbox' ? 'Your mail, all in one place.' : 'Messages in ' + folderNames[currentFolder].toLowerCase() + '.';
  $('folders').querySelectorAll('[data-folder]').forEach((button) => {
    button.classList.toggle('active', button.dataset.folder === currentFolder);
  });
  $('count').textContent = messageList.length + (messageList.length === 1 ? ' message' : ' messages');

  if (!messageList.length) {
    $('messages').innerHTML = '<div class="empty"><span class="empty-mark">✉</span><strong>This folder is empty</strong><p>Messages received by your configured mail provider will appear here.</p></div>';
    return;
  }

  $('messages').innerHTML = messageList.map((message) => {
    const id = Number(message.id);
    const checked = selected.has(id) ? ' checked' : '';
    const unread = message.is_read ? '' : ' unread';
    const starred = message.is_starred ? ' on' : '';
    const sender = currentFolder === 'sent'
      ? 'To: ' + ((message.recipients && message.recipients.to) || []).join(', ')
      : message.sender_email;
    const status = message.delivery_status === 'queued' ? '<span class="delivery queued">Queued</span>'
      : message.delivery_status === 'failed' ? '<span class="delivery failed">Failed</span>'
      : message.delivery_status === 'sent' ? '<span class="delivery sent">Sent</span>' : '';
    return '<article class="message' + unread + '" data-id="' + id + '">' +
      '<input class="select-message" type="checkbox" aria-label="Select message"' + checked + '>' +
      '<button class="star' + starred + '" data-star="' + id + '" type="button" aria-label="Toggle star">' + (message.is_starred ? '★' : '☆') + '</button>' +
      '<div class="sender">' + escapeHtml(sender) + '</div>' +
      '<div class="summary"><strong>' + escapeHtml(message.subject || '(no subject)') + '</strong><span>' + escapeHtml(message.body_text || '') + '</span>' + status + '</div>' +
      '<time class="time">' + escapeHtml(formatDate(message.created_at)) + '</time>' +
      '</article>';
  }).join('');
}

async function openMessage(id) {
  try {
    const result = await request('/messages/' + encodeURIComponent(id));
    const message = result.message;
    $('detail-subject').textContent = message.subject || '(no subject)';
    $('detail-date').textContent = formatDate(message.created_at);
    $('detail-from').textContent = message.sender_email || '';
    const recipients = message.recipients || {};
    $('detail-to').textContent = [...(recipients.to || []), ...(recipients.cc || [])].join(', ');
    $('detail-status').textContent = message.delivery_status || '';
    $('detail-body').textContent = message.body_text || '';
    $('detail-error').textContent = message.last_error || '';
    $('detail-error').classList.toggle('is-hidden', !message.last_error);
    $('message-view').showModal();
    if (!message.is_read) {
      await request('/messages/' + id, { method: 'PATCH', body: { isRead: true } });
      await loadMessages();
    }
  } catch (error) {
    setFeedback($('compose-feedback'), error.message, true);
  }
}

async function mutateSelected(action) {
  const ids = [...selected];
  if (!ids.length) return;
  try {
    await Promise.all(ids.map((id) => {
      if (action === 'delete') return request('/messages/' + id, { method: 'DELETE' });
      const patch = action === 'read' ? { isRead: true } : { folder: 'archive' };
      return request('/messages/' + id, { method: 'PATCH', body: patch });
    }));
    await loadMessages();
  } catch (error) {
    window.alert(error.message);
  }
}

async function signIn() {
  const result = await request('/auth/login', {
    method: 'POST',
    auth: false,
    body: { email: $('auth-email').value.trim(), password: $('auth-password').value }
  });
  token = result.accessToken;
  sessionStorage.setItem('mailharbor-token', token);
  currentUser = result.user;
  showMailbox();
  await loadMessages();
}

async function registerAccount() {
  const result = await request('/auth/register', {
    method: 'POST',
    auth: false,
    body: {
      email: $('auth-email').value.trim(),
      displayName: $('display-name').value.trim(),
      password: $('auth-password').value
    }
  });
  setFeedback($('auth-feedback'), result.message || 'Account created. Check your email to verify it.');
}

async function init() {
  try {
    mailStatus = await request('/status', { auth: false });
    updateCapabilityText();
  } catch (_error) {
    $('auth-capability').textContent = 'MailHarbor services are not reachable. Check the API deployment.';
    return;
  }

  const verifyToken = new URLSearchParams(window.location.search).get('verify');
  if (verifyToken) {
    try {
      const result = await request('/auth/verify', { method: 'POST', auth: false, body: { token: verifyToken } });
      setFeedback($('auth-feedback'), result.message);
    } catch (error) {
      setFeedback($('auth-feedback'), error.message, true);
    }
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  if (token) {
    try {
      const result = await request('/me');
      currentUser = result.user;
      showMailbox();
      await loadMessages();
      return;
    } catch (_error) {
      token = '';
      sessionStorage.removeItem('mailharbor-token');
    }
  }
  showAuth();
}

$('mode-toggle').addEventListener('click', () => setAuthMode(authMode === 'login' ? 'register' : 'login'));

$('auth-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('auth-submit');
  button.disabled = true;
  setFeedback($('auth-feedback'), authMode === 'register' ? 'Creating account…' : 'Signing in…');
  try {
    if (authMode === 'register') await registerAccount();
    else await signIn();
  } catch (error) {
    setFeedback($('auth-feedback'), error.message, true);
  } finally {
    button.disabled = false;
  }
});

$('folders').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-folder]');
  if (!button) return;
  currentFolder = button.dataset.folder;
  $('sidebar').classList.remove('open');
  try { await loadMessages(); } catch (error) { window.alert(error.message); }
});

$('messages').addEventListener('click', async (event) => {
  const star = event.target.closest('[data-star]');
  if (star) {
    const id = Number(star.dataset.star);
    const message = messageList.find((item) => Number(item.id) === id);
    if (!message) return;
    try {
      await request('/messages/' + id, { method: 'PATCH', body: { isStarred: !message.is_starred } });
      await loadMessages();
    } catch (error) { window.alert(error.message); }
    return;
  }
  const article = event.target.closest('.message');
  if (!article) return;
  if (event.target.classList.contains('select-message')) {
    const id = Number(article.dataset.id);
    if (event.target.checked) selected.add(id);
    else selected.delete(id);
    return;
  }
  await openMessage(article.dataset.id);
});

$('search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadMessages().catch((error) => window.alert(error.message)), 250);
});
$('refresh').addEventListener('click', () => loadMessages().catch((error) => window.alert(error.message)));
$('markread').addEventListener('click', () => mutateSelected('read'));
$('archive').addEventListener('click', () => mutateSelected('archive'));
$('delete').addEventListener('click', () => mutateSelected('delete'));
$('compose').addEventListener('click', () => {
  setFeedback($('compose-feedback'), '');
  $('composer').showModal();
});
$('close-compose').addEventListener('click', () => $('composer').close());
$('close-detail').addEventListener('click', () => $('message-view').close());

$('compose-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!mailStatus.outboundEmailConfigured) {
    setFeedback($('compose-feedback'), 'SMTP is not configured. No message was sent.', true);
    return;
  }
  $('send').disabled = true;
  setFeedback($('compose-feedback'), 'Queueing message…');
  try {
    const result = await request('/messages', {
      method: 'POST',
      body: {
        to: $('to').value,
        cc: $('cc').value,
        bcc: $('bcc').value,
        subject: $('subject').value,
        body: $('body').value
      }
    });
    $('composer').close();
    $('compose-form').reset();
    currentFolder = 'sent';
    await loadMessages();
    window.alert('Message queued. It will show as sent only after the mail provider accepts it. Message ID: ' + result.message.id);
  } catch (error) {
    setFeedback($('compose-feedback'), error.message, true);
  } finally {
    $('send').disabled = !mailStatus.outboundEmailConfigured;
  }
});

$('signout').addEventListener('click', () => {
  stopRealtime();
  token = '';
  currentUser = null;
  sessionStorage.removeItem('mailharbor-token');
  messageList = [];
  selected.clear();
  $('search').value = '';
  showAuth();
});

$('menu').addEventListener('click', () => $('sidebar').classList.toggle('open'));

setAuthMode('login');
init();
