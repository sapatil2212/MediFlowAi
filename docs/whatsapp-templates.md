# WhatsApp Utility Templates and Notification Automation — Operator Guide

BookMyTime sends business-initiated booking notifications only through the official Meta WhatsApp Cloud API and only with an approved **UTILITY** template. A failed template gate never falls back to free-form Cloud text or `whatsapp-web.js`. This removes the 24-hour customer-service-window dependency from confirmations, reminders, and lifecycle updates.

Super Admin controls are under **Super Admin → WhatsApp Cloud**:

- **Overview** — delivery health, backlog, retry and alert metrics.
- **Logs** — per-event timeline and safe retry controls.
- **Automation** — platform/category switches, retry/rate/retention settings, and route matrix.
- **Template Catalog** — catalog-vs-Meta state, submission, approval, and activation.
- **Templates / Credentials / Account health** — low-level template and Cloud account operations.

Tenant owners configure their own notification switches, timezone, logs, and customer opt-outs under the WhatsApp area. Staff may view where their plan permits but cannot mutate these settings.

## 1. Incident fixed by this system

The original booking route sent free-form `type: "text"` messages when no template mapping existed. Meta could accept the HTTP request and then fail it asynchronously with error `131047` (“Re-engagement message”) when the customer had not messaged within 24 hours. Removing that fallback alone was not sufficient: if approved templates had never been synchronized and mapped, every message failed closed with `template_not_ready (mapping_missing)`.

The repaired flow is:

1. A booking transaction records a durable `NotificationEvent` outbox row.
2. The dispatcher re-reads the current tenant and booking state.
3. Category switches, tenant switches, recipient validity, consent, and current event truth are checked.
4. The route must resolve to an enabled, acknowledged template that belongs to the configured WABA and is currently `APPROVED` + `UTILITY` in its exact language.
5. The router sends `type: "template"`; no inbound-window lookup is performed.
6. Meta acceptance stores the `wamid`; signed status webhooks advance `sent → delivered → read` or record failure without allowing out-of-order regression.

A booking always survives a notification failure. The event and failure reason remain visible to operators.

## 2. Environment and account configuration

Cloud configuration is read from the central `WaCloudConfig` row first, with environment variables as per-field fallback. Stored secrets use AES-256-GCM and are never returned by admin APIs.

| Variable                   | Purpose                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| `WA_CLOUD_PHONE_NUMBER_ID` | Cloud API sender phone-number node ID.                                                      |
| `WA_CLOUD_WABA_ID`         | WhatsApp Business Account / Messaging Account ID. This is not the Phone Number ID.          |
| `WA_CLOUD_ACCESS_TOKEN`    | System-user token with management and messaging scopes.                                     |
| `WA_CLOUD_APP_SECRET`      | App secret used to verify webhook HMAC signatures.                                          |
| `WA_CLOUD_VERIFY_TOKEN`    | Token used for the webhook GET challenge.                                                   |
| `WA_CLOUD_API_VERSION`     | Optional Graph version override. The effective DB value may take precedence.                |
| `WA_CLOUD_ENC_KEY`         | Stable 32-byte hex encryption key for stored credentials. Never rotate without a migration. |
| `WA_CLOUD_TEST_RECIPIENTS` | Comma-separated local-test allow-list. Must be **unset** in production.                     |
| `APP_ORIGIN`               | Public HTTPS origin used in the static prefix of video-consultation template buttons.       |
| `SUPER_ADMIN_EMAIL`        | Recipient for critical notification-engine alert email.                                     |
| `EMAIL_USERNAME`           | Configured mail sender; alert email is skipped when absent.                                 |

`WA_CLOUD_TEST_RECIPIENTS` is a safety boundary, not only a UI hint. A process with this value set claims only allow-listed recipients. Events created by that process are marked test-mode and skipped by unrestricted production workers. Maintenance and catalog automation are disabled in a test-mode process. Do not set this variable to an empty placeholder in a production service definition; remove it.

The current API version must remain explicit and monitored. Upgrade it through a separately verified change before Meta’s displayed expiry date; do not silently change a production version while repairing delivery.

### Meta prerequisites

- WABA approved and business verified as required by Meta.
- Sender phone connected, registered, live, and able to send.
- System-user token with `whatsapp_business_management` and `whatsapp_business_messaging`.
- App subscribed to the configured WABA.
- Callback URL and verify token configured.
- Webhook fields subscribed: `messages`, `message_template_status_update`, `message_template_quality_update`, `template_category_update`, and `message_template_components_update`.

Use **Account health** to verify these facts. HTTP acceptance is not delivery proof; a signed `delivered` or `read` webhook is.

## 3. Approved clinic templates

These existing live templates are imported and reused; never submit duplicates or change their language during routing.

| Template                          | Language | Variables in order                             | Use                        |
| --------------------------------- | -------- | ---------------------------------------------- | -------------------------- |
| `appointment_booked`              | `en_US`  | name, clinic, doctor, date, time, queue number | Clinic booking created     |
| `appointment_cancelled`           | `en_US`  | name, clinic, date, time                       | Clinic booking cancelled   |
| `appointment_completed`           | `en`     | name, clinic, doctor                           | Clinic visit completed     |
| `appointment_reminder_day_before` | `en`     | name, clinic, doctor, date, time, queue number | Clinic day-before reminder |

The `en` and `en_US` values are exact Meta identifiers and are not interchangeable. These templates are clinic-only because their approved wording explicitly refers to a clinic, consultation, prescription, or queue at the clinic. The runtime gate returns `category_mismatch` if a wildcard mapping could otherwise route one to another industry.

The catalog adds category-specific UTILITY templates for salon, gym, coaching, restaurant, and professional-service events. It intentionally excludes payment/refund messages where BookMyTime has no customer payment event, and other candidates that have no corresponding product workflow.

## 4. Durable engine behavior

### Event and job model

`NotificationEvent` is both the transactional outbox and durable dispatch job. `eventKey` is unique, so repeated application requests do not create duplicate sends. `WaMessageLog` records each actual Cloud attempt and links back through `eventId`.

The worker uses atomic claims, claim tokens, and two-minute leases. An expired lease is requeued only if sending had not started. If a worker disappears after marking send-started, the event becomes `ambiguous` and is never automatically retried because Meta may already have accepted it.

Retryable Meta/network errors use exponential backoff with full jitter and the configured attempt cap. Permanent recipient errors, template/configuration failures, provider restrictions, and ambiguous transport outcomes are not blindly retried. Super Admin can retry only safe terminal rows that have no provider message ID.

### Reminder timing

- Day-before reminders target T−24h, clamped to 08:00–21:00 on the previous day in the tenant timezone.
- Same-day reminders target T−2h and are off by default per tenant.
- Restaurant timezone comes from restaurant settings unless the tenant notification timezone overrides it.
- Booking wall-clock values are converted to UTC instants in application code; scheduling does not depend on the database or server timezone.
- Rescheduling supersedes reminders for the old wall clock. Cancellation, completion, or provider-unavailable status cancels jobs that are no longer true.

### Consent

The platform default is `implied_by_booking`: a customer who gives a WhatsApp number for their booking may receive transactional UTILITY updates for that booking unless they opt out. The public checkbox is currently checked by default; changing that default is a product/legal decision, not an implementation detail. `explicit_only` can be selected by Super Admin when a recorded opt-in must exist.

A booking-form choice is stored per tenant. Tenant owners can record an opt-out or renewed opt-in. A whole-message `STOP` reply creates a platform-wide opt-out that blocks every tenant; `START` lifts it. Opt-outs always win over implied consent. This system does not grant marketing consent.

## 5. Catalog submission and activation

### Inspect before submitting

1. Open **Template Catalog** and run **Sync all**.
2. Confirm the WABA ID, sender health, and token scopes in **Account health**.
3. Review every row’s exact name, language, body, footer, sample values, and intended routes.
4. Existing name+language rows are never overwritten or recreated. `content_mismatch`, `reclassified`, `rejected`, `paused`, and `uncertain` require operator review.

### Submit missing catalog templates

1. Select missing `catalog_new` rows and confirm submission.
2. BookMyTime creates a validated local draft and posts category `UTILITY` with examples.
3. A successful create is recorded as Meta’s returned status, normally `PENDING`; it is never labeled approved locally.
4. If Meta returns an authentication, permission, rate-limit, or account-restriction stop code, batch submission stops rather than generating repeated failures.
5. If a transport outcome is uncertain, use **Check with Meta** or **Sync all** before any retry.

### Activate routes

Only exact-content `APPROVED` + `UTILITY` rows are eligible. Activation creates category-specific mappings, records the opt-in acknowledgement, and enables the route. It narrows legacy `*` mappings for industry-specific templates so the approved clinic text cannot leak into another category. An administrator’s enabled mapping to another sendable template, or an explicitly disabled mapping, is not silently replaced.

After deployment, run activation from the new code only. Do not pre-create category rows while an older production build still selects `LIMIT 1` by notification kind, because that build cannot deterministically choose among category mappings.

## 6. Webhooks and delivery state

The callback verifies `X-Hub-Signature-256` over the raw body before parsing. Invalid signatures return `401`. Each flattened entry has an idempotency key; duplicates are skipped, previously errored entries can be reclaimed, and an inability to store the idempotency row returns `503` so Meta retries.

Status callbacks update both `WaMessageLog` and the linked `NotificationEvent`. Provider timestamps are retained. Delivery progression is monotonic: duplicate or lower-rank updates are ignored, and `failed` cannot overwrite an already delivered/read event. A callback that beats the sender’s `wamid` update is checked once again after five seconds.

STOP/START replies are the only customer messages that trigger a consent confirmation. That confirmation is free-form only because the customer has just opened the service window; it is not part of business-initiated notification routing.

## 7. Operator runbook

### Deployment

1. Back up the database and preserve `WA_CLOUD_ENC_KEY`.
2. Build and test the exact revision being deployed.
3. Deploy one compatible version at a time; the runtime DDL is additive and idempotent.
4. Confirm `WA_CLOUD_TEST_RECIPIENTS` is absent from production.
5. Restart the Node/Nitro service and verify one worker starts.
6. Run **Sync all**, then inspect the four approved clinic templates and every submitted catalog row.
7. Run catalog activation from the deployed version.
8. Verify the webhook field subscriptions listed in §2.
9. Use only a consented, designated test recipient for an end-to-end booking. Confirm the Graph request is `type: "template"`, then wait for `delivered`/`read` in Logs.
10. Monitor backlog, `blocked`, `ambiguous`, retry rate, open alerts, and template state during rollout.

### Common failure reasons

| Reason                                           | Operator action                                                                      |
| ------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `mapping_missing` / `mapping_disabled`           | Sync, map the exact category route, acknowledge, and enable.                         |
| `template_not_approved` / `template_not_utility` | Inspect Meta state; never override it locally.                                       |
| `language_mismatch`                              | Map the exact approved language; do not convert `en` ↔ `en_US`.                      |
| `category_mismatch`                              | Replace a legacy wildcard with the category-specific catalog route.                  |
| `variables_unresolved`                           | Fix missing current booking/tenant data or choose a compatible template.             |
| `cloud_unavailable`                              | Check credentials, enabled state, WABA/phone IDs, token scopes, and account health.  |
| `consent_withdrawn`                              | Do not retry. Only the customer or authorized tenant workflow may opt in again.      |
| `ambiguous`                                      | Verify externally before manual action; an automatic retry could duplicate delivery. |

## 8. Rollback

The safest rollback is **revert the application code and leave the additive schema in place**. The earlier build ignores the new notification tables/columns, and removing schema is unnecessary during incident rollback.

Before any schema removal:

1. Pause the notification engine and stop all application workers.
2. Back up `NotificationEvent`, `NotificationConsent`, `TenantNotificationSettings`, `NotificationPlatformSettings`, `NotificationAudit`, `NotificationAlert`, `WaNotifyMapping`, and `WaMessageLog`.
3. Confirm no rollback target writes the new schema and decide whether losing audit/consent history is acceptable.
4. Consolidate category-specific mappings to at most one row per `notifyKind` before restoring the legacy unique index.
5. Run DDL in a maintenance window. MySQL DDL may auto-commit and is not an atomic rollback.

Destructive rollback, only after those checks:

```sql
DROP TABLE IF EXISTS NotificationEvent;
DROP TABLE IF EXISTS NotificationConsent;
DROP TABLE IF EXISTS TenantNotificationSettings;
DROP TABLE IF EXISTS NotificationPlatformSettings;
DROP TABLE IF EXISTS NotificationAudit;
DROP TABLE IF EXISTS NotificationAlert;

ALTER TABLE WaMessageLog
  DROP COLUMN eventId,
  DROP COLUMN sentAtMs,
  DROP COLUMN deliveredAtMs,
  DROP COLUMN readAtMs,
  DROP COLUMN failedAtMs;

-- Only after proving there is no more than one row for each notifyKind:
ALTER TABLE WaNotifyMapping
  DROP INDEX uq_wnm_kind_category,
  DROP COLUMN businessCategory,
  ADD UNIQUE KEY uq_wnm_kind_enabled (notifyKind);
```

This rollback does not modify `Appointment` or other booking rows. Dropping notification tables permanently removes pending jobs, consent records, operational history, and alert state; restore them from backup if the new engine is reintroduced.
