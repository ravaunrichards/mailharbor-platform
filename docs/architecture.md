# MailHarbor service architecture

## Request path

1. The browser loads the frontend from the same origin as the API.
2. Account registration hashes the password with bcrypt and inserts a one-time verification token plus an email outbox job in one PostgreSQL transaction.
3. The delivery worker claims queued jobs with \`FOR UPDATE SKIP LOCKED\`, sends them via authenticated SMTP, and marks a job delivered only after the SMTP provider accepts it.
4. Login is permitted only after the email verification token is consumed. The API issues a short-lived, signed access token.
5. Every mailbox read or mutation is scoped to the authenticated account ID in the SQL statement.
6. Inbound mail is accepted only from a provider webhook whose raw request body has a matching HMAC-SHA256 signature. A unique provider event ID and message ID protect against duplicate delivery.

## Services

| Service | Responsibility | Required dependencies |
|---|---|---|
| mailharbor-api | UI, account/auth API, mailbox API, health checks, webhook ingress, realtime-ticket issuer | PostgreSQL |
| mailharbor-realtime | Authenticated WebSocket sessions and mailbox-change fan-out from PostgreSQL notifications | PostgreSQL, one-time API-issued connection tickets |
| mailharbor-delivery-worker | SMTP delivery, retry scheduling, outbox recovery | PostgreSQL, SMTP provider |
| PostgreSQL | Accounts, verification tokens, messages, outbox and webhook idempotency | Persistent storage |
| Mail provider | Outbound SMTP and inbound routing | Verified domain, provider credentials and DNS |

The transactional outbox avoids losing a send request between saving a message and scheduling its delivery. The API does not claim that a queued message is sent. Worker retries use exponential backoff with a five-attempt default; final failures remain visible on the message record.

## Realtime mailbox events

The API issues a random 256-bit ticket stored only as a SHA-256 hash and valid for 60 seconds. The browser presents it as its first WebSocket message. The realtime service atomically consumes the ticket, binding the socket to one account; replayed, expired, or invalid tickets are rejected. PostgreSQL triggers publish only the account ID, message ID, and operation through `NOTIFY`; message bodies, addresses, subjects, and tokens are never broadcast. If the realtime process disconnects, clients reconnect and reload their mailbox through the authenticated API.

## Security boundaries

- Password hashes are bcrypt hashes; plaintext passwords are never stored.
- Verification tokens are random, stored as SHA-256 hashes, and expire after 30 minutes.
- API requests use signed 12-hour bearer tokens.
- Mailbox queries always include the authenticated owner ID.
- SQL values are parameterized. Dynamic update columns come only from a fixed allowlist.
- Inbound webhook signatures are verified with constant-time comparison.
- SMTP secrets and signing secrets are environment variables, never repository files.
- Request payloads, recipients, subject lines, and message bodies have explicit size limits.

## Delivery semantics

SMTP acceptance means the configured provider accepted the message for delivery; it does not guarantee inbox placement or recipient delivery. Provider events, bounces, complaints, suppression lists, and delivery analytics require a provider-specific event adapter and are not implied by the SMTP response.
