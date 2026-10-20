# MailHarbor

MailHarbor is an original, responsive email-client starter project. It is a separate project and does not modify any existing repository or deployment.

## Current capabilities
- Responsive inbox, sent, drafts, spam, and trash views
- Search, unread state, star, archive, and delete interactions
- Compose and reply interface
- Small Express API with input validation, security headers, and health check
- PostgreSQL schema and Docker Compose development setup
- Automated validation tests

## Important status
The frontend is a local UI preview with sample messages. The API validates message requests but **does not send or persist email yet**. This ZIP is a starter repository, not a production email service. Production delivery requires an email provider or mail-server integration, verified domains, SPF/DKIM/DMARC, authentication, persistence, attachment storage and scanning, abuse controls, and operational monitoring.

## Run locally
Requirements: Node.js 20+ and npm.

Frontend: open `frontend/index.html` in a browser. No build step is required.

API:
```sh
cd backend
npm install
npm test
npm start
```
API defaults to `http://localhost:3000`; health check: `/health`.

Docker development services:
```sh
docker compose up --build
```

## API
- `GET /health` — health status
- `POST /api/messages` — validates a draft payload and returns `501` while delivery is not configured

## Structure
```text
mailharbor-platform/
├── frontend/             # Responsive browser UI
├── backend/              # Express API and tests
├── database/schema.sql   # PostgreSQL starter schema
├── docker-compose.yml
├── .env.example
└── README.md
```
