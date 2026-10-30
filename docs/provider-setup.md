# MailHarbor mail-provider setup

MailHarbor does not operate public MX servers itself. A real provider must supply SMTP submission for outbound email and inbound routing for received email.

## Outbound SMTP

Obtain these values from your selected provider:

| Environment variable | Provider value |
|---|---|
| \`SMTP_HOST\` | SMTP submission hostname |
| \`SMTP_PORT\` | Usually 587 for STARTTLS or 465 for implicit TLS |
| \`SMTP_SECURE\` | \`false\` for STARTTLS on 587, \`true\` for implicit TLS on 465 |
| \`SMTP_USER\` | SMTP username |
| \`SMTP_PASSWORD\` | SMTP password or provider API-generated SMTP credential |
| \`MAIL_FROM\` | Sender address on the verified sending domain |

Use the exact TLS mode and host issued by the provider. Keep the sender domain verified and authorized by the provider. MailHarbor refuses to create accounts or queue outbound messages when the SMTP configuration is incomplete.

## Inbound email

1. Configure an inbound route in a provider that can forward parsed email to an HTTPS webhook.
2. Set \`INBOUND_WEBHOOK_SECRET\` to a random secret shared only by that provider and MailHarbor.
3. Configure the provider to POST the normalized JSON payload below to \`/api/webhooks/inbound\`.
4. The provider must calculate HMAC-SHA256 over the exact raw HTTP request body and send \`X-MailHarbor-Signature: sha256=<hex-digest>\`.
5. Set the domain's MX records to the exact inbound destination supplied by the provider.

Expected payload:

\`\`\`json
{
  "eventId": "provider-event-id",
  "messageId": "<unique-message-id@example.net>",
  "from": "sender@example.net",
  "to": ["verified-user@your-domain.example"],
  "subject": "Subject",
  "text": "Plain-text message content"
}
\`\`\`

Only verified MailHarbor users whose account email exactly matches one of the payload recipients receive the message. Duplicate event IDs and provider message IDs are ignored. The webhook currently stores plain text only; it does not parse MIME attachments or HTML bodies.

## Domain authentication

At your DNS provider, publish the SPF, DKIM, and DMARC records supplied by your mail provider. Do not use generic or guessed record values. Start with the provider's recommended DMARC monitoring policy, review aggregate reports, then tighten policy after all legitimate senders are aligned.

## Secrets handling

Set secrets in Render's environment UI or a protected local \`.env\` file. Do not commit SMTP passwords, webhook secrets, private keys, or production database URLs. Rotate credentials after suspected exposure. Use separate test and production provider credentials.
