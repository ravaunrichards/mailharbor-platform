# MailHarbor

MailHarbor is a webmail application with a PostgreSQL-backed API, verified account registration, a persistent SMTP outbox, a separate delivery worker, and a signed inbound-mail webhook.

## Service layout

- **Web/API service:** serves the mailbox UI and authenticated REST API.
- **Delivery worker:** claims outbox jobs from PostgreSQL, sends through the configured SMTP provider, records provider message IDs, and retries transient failures.
- **Realtime service:** maintains authenticated WebSocket connections and broadcasts mailbox-change notifications from PostgreSQL without exposing message content.
- **PostgreSQL:** stores accounts, verification tokens, messages, inbound webhook deduplication, and the transactional outbox.
- **Inbound provider adapter:** accepts normalized inbound messages only when their raw request body has a valid HMAC signature.

The frontend no longer includes sample messages. A new account can only be created when outbound SMTP is configured, because MailHarbor must send and verify the account email. A message is shown as queued until the worker receives an actual successful SMTP response.

## Run locally

Requirements: Node.js 24 LTS, npm, and Docker Compose.

1. Copy \`.env.example\` to \`.env\`.
2. Set a strong \`JWT_SECRET\` (for example, \`openssl rand -hex 32\`).
3. Set the SMTP values from a real, verified mail-delivery provider. Leave them blank only when exercising health checks and the UI; registration and sending will remain disabled.
4. Start PostgreSQL, API, and worker:

\`\`\`sh
docker compose up --build
\`\`\`

Open \`http://localhost:3000\`. The API applies numbered SQL migrations at startup. To run unit tests without a database:

\`\`\`sh
npm install --prefix backend
npm --prefix backend test
\`\`\`

## Operational endpoints

- \`GET /health/live\` — process liveness.
- \`GET /health/ready\` — database readiness and configured mail capabilities.
- \`GET /api/status\` — public capability status. It does not reveal secrets.
- \`POST /api/auth/register\` — create an account and queue email verification.
- \`POST /api/auth/verify\` — consume a one-time verification token.
- \`POST /api/auth/login\` and \`GET /api/me\` — authenticated access.
- \`GET /api/messages\`, \`GET /api/messages/:id\` — mailbox access restricted to the signed-in owner.
- \`POST /api/messages\` — queue outbound plain-text email. Returns HTTP 202 with \`deliveryStatus: queued\`.
- \`PATCH /api/messages/:id\` and \`DELETE /api/messages/:id\` — message flags and soft-delete.
- \`POST /api/webhooks/inbound\` — signed inbound provider webhook.

## Real email setup

MailHarbor is the application and orchestration layer; it is not a self-hosted MX/SMTP server. Configure a delivery provider that supports authenticated SMTP for outbound email and an inbound routing/webhook product for receiving mail. Set the provider credentials in the API and worker environments. Point your domain's MX records at the inbound provider and publish the exact SPF, DKIM, and DMARC records supplied by that provider. Never copy guessed DNS records.

See [provider setup](docs/provider-setup.md), [deployment](docs/deployment.md), and [architecture](docs/architecture.md).

## Current scope and explicit limits

This repository implements account verification, mailbox persistence, plain-text outbound email, retries, signed inbound ingestion, mailbox search, stars, read state, archive, and trash. It does not yet implement IMAP/POP3 client connections, MIME parsing, attachment upload/scanning, HTML email rendering, contact sync, mobile push, or a self-operated mail-transfer server. Those capabilities must not be presented as active until implemented and tested.

## Production checklist

Before making the service public, configure a verified sending domain, SMTP credentials, inbound routing, HTTPS, database backups, provider rate limits, abuse monitoring, and operational alerts. The Render Blueprint declares a web/API service, a background delivery worker, and PostgreSQL. Review the selected resource plans and complete the provider secrets in Render before syncing or deploying it.
