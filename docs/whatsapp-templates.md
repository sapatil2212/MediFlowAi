# WhatsApp Utility Template Management — Admin Guide

This guide covers configuring and operating the WhatsApp **Cloud API utility
template** feature in the Super Admin dashboard: how official template messages
are authored, submitted to Meta, kept in sync, mapped to appointment
notifications, and how the whole feature degrades safely to the existing
plain-text + WhatsApp Web path.

The feature lives entirely inside the existing **WhatsApp Cloud** panel
(Super Admin → WhatsApp Cloud → **Templates**). It adds no new top-level
navigation and no second backend; every Meta call flows through the one Cloud
transport and every server action requires a Super Admin session.

---

## 1. What this feature does (and the incident it fixes)

Before this feature, appointment notifications were only ever sent as plain
text — over the official Cloud API inside Meta's 24-hour service window, and
over WhatsApp Web otherwise. Outside the 24-hour window Meta silently refuses
free-form text, which is why some booking confirmations never arrived.

Approved **utility templates** can be delivered outside the 24-hour window. This
feature lets a Super Admin author a template, submit it to Meta for review,
track its status, and map an **approved** template to an appointment
notification kind. When a notification is sent and a mapping is enabled, the
official channel sends the template instead of plain text.

**Safety invariant (the original incident guard):** when no enabled mapping
applies, the system behaves exactly as before — the official channel sends the
same plain text, the message log keeps `templateId = NULL`, and nothing about
the WhatsApp Web fallback changes. A template is only ever used when every gate
passes. If a template send fails, the message falls back to WhatsApp Web with
the readable (non-token) body, exactly as the plain-text path does.

---

## 2. Configuration

Cloud credentials are read from the `WaCloudConfig` row first, then from
environment variables as a fallback. Secrets are stored AES-256-GCM encrypted
and are never returned in any API response, activity record, health snapshot,
or log line.

| Variable                         | Purpose                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------- |
| `WA_CLOUD_PHONE_NUMBER_ID`       | The Cloud API phone number ID used to send messages.                            |
| `WA_CLOUD_WABA_ID`               | The Messaging Account ID (the WABA node). **Not** the Phone Number ID (see §4). |
| `WA_CLOUD_ACCESS_TOKEN`          | System-user access token with the required scopes (see §3).                     |
| `WA_CLOUD_APP_SECRET`            | App secret used to verify inbound webhook signatures (HMAC-SHA256).             |
| `WA_CLOUD_VERIFY_TOKEN`          | The verify token echoed during the webhook GET handshake.                       |
| `WA_CLOUD_API_VERSION`           | Graph API version override. Defaults to the current pinned version if unset.    |
| `WA_CLOUD_ENC_KEY`               | 32-byte key (hex) used to encrypt stored secrets and stored message bodies.     |
| `WA_CLOUD_TEMPLATE_SYNC_MINUTES` | Optional scheduled full-sync interval. Off by default; valid range is 30–1440.  |
| `WA_CLOUD_TEST_RECIPIENTS`       | Optional local-test allow-list; the official API only sends to these numbers.   |

### Scheduled sync interval

`WA_CLOUD_TEMPLATE_SYNC_MINUTES` controls the background full sync that
reconciles local template state with Meta. It is **off by default**. Leave it
unset (or `0`) to rely on webhooks plus manual "Sync all". A value between 30
and 1440 enables a periodic sync kicked from the reminder cycle; anything
outside that range is treated as off and logs a single warning.

---

## 3. Meta prerequisites

Before authoring templates, confirm the following in the Meta Business /
WhatsApp Manager setup:

- A **WhatsApp Business Account (WABA)** with a registered phone number.
- A **system-user access token** that carries both
  `whatsapp_business_management` (to create / list / edit / delete templates
  and read account health) and `whatsapp_business_messaging` (to send).
- The **app secret** configured so inbound webhook signatures can be verified.
- The webhook callback URL and verify token registered for the app (see §5).

The **Account health** view surfaces the token's scopes (never the token
itself), the WABA and phone nodes, the send health status, subscribed apps, and
an API-version expiry warning. Use it to confirm the prerequisites above.

---

## 4. Messaging Account ID vs Phone Number ID

A common misconfiguration is entering the **Phone Number ID** where the
**Messaging Account ID (WABA ID)** is expected. The Credentials tab labels this
field **"Messaging Account ID (legacy WABA ID)"** and the Account health check
verifies that the configured ID resolves to a WABA node. If it cannot, the
health view shows a note asking you to confirm it is not a Phone Number ID.

Template operations and the webhook `entry.id` match against this Messaging
Account ID; a template change for any other account is ignored.

---

## 5. Webhook field subscriptions

In addition to the message/status webhooks already used for delivery receipts,
subscribe the app to these four **template** webhook fields so template state
updates in near-real time:

- `message_template_status_update` — approval / rejection / pause / disable, and
  reinstatement events.
- `message_template_quality_update` — quality-rating changes.
- `template_category_update` — category recategorization by Meta.
- `message_template_components_update` — component changes on Meta's side.

All webhook deliveries are verified by HMAC-SHA256 **before** the body is
parsed; an invalid signature is rejected with `401` and changes no state. Each
entry is processed at most once (idempotency key), out-of-order deliveries are
dropped by a monotonic guard, and template changes for a different Messaging
Account are ignored.

---

## 6. Account restrictions

If Meta restricts the account, the send health status reports `BLOCKED` or
`LIMITED` rather than `AVAILABLE`. The Account health view explains the
restricted state and links to WhatsApp Manager so an operator can act. While an
account is restricted, template sends will fail and the router falls back to
WhatsApp Web; no patient notification depends solely on the official channel.

---

## 7. Authoring, submit, sync, and mapping workflows

### 7.1 Authoring a template

1. Open **WhatsApp Cloud → Templates → New template** (or install the built-in
   presets).
2. Enter the basic details: a lowercase name (`^[a-z0-9_]{1,128}$`), a language,
   and the category (utility on create).
3. Build the components: an optional **TEXT** header, the body, an optional
   footer (no variables), and optional buttons. Media and location headers are
   shown **disabled** with an explanation — they require Meta's Resumable Upload
   flow and are out of scope.
4. Map each `{{n}}` (or named) placeholder to a booking field
   (name, clinic name, doctor name, date, time, booking code) and provide sample
   values.
5. Use the **Preview** — it substitutes your sample values, is HTML-escaped,
   is labelled "Preview — not sent", and never calls Meta.

### 7.2 Submitting for review

Open **Submit for review**. The dialog shows the exact payload that will be sent
to Meta and requires an explicit confirmation. On success the template becomes
**Pending** — never "Approved". Approval only happens later, when Meta's signed
`message_template_status_update` webhook arrives (or a sync picks it up).

If a submission result is **uncertain** (a timeout or transport error), the
template is not auto-retried. Use **Check with Meta** to reconcile by name: if a
matching template is found on Meta it is adopted, otherwise the local draft
returns to an editable state.

### 7.3 Keeping templates in sync

- **Webhooks** apply status / quality / category / component changes as they
  happen.
- **Sync all** pages the full Meta template list and reconciles every row.
- **Single sync** refreshes one template from its Meta node.
- Optional **scheduled sync** runs a full sync on the configured interval (§2).

### 7.4 Mapping to appointment notifications

1. Open **Notification mappings**.
2. Assign an **approved, UTILITY** template to a notification kind.
3. Enabling the mapping is gated behind an **opt-in acknowledgement**: tick the
   acknowledgement, then enable. The acknowledgement and its version are
   recorded.
4. If the mapped template later stops being approved/utility (via webhook or
   sync), the mapping is invalidated and sends fall back to plain text.

> Note: the acknowledgement is a per-mapping Super Admin confirmation. There is
> no per-patient opt-in column; the plain-text path itself is not opt-in gated.

---

## 8. Runtime gate (how a send is decided)

For each appointment notification, the official channel uses a template **only**
when all of these hold, otherwise it sends plain text:

1. The Cloud API is enabled and a recipient phone number is present.
2. An **enabled** mapping with a current opt-in acknowledgement exists for the
   notification kind.
3. The mapped template is owned by the configured Messaging Account, its Meta
   status is `APPROVED`, and its category is `UTILITY`.
4. Every placeholder's mapped field resolves for this specific appointment. A
   single unresolved field sends plain text instead (never a blank parameter).

Variable resolution reads only the current appointment's context, so one
tenant's data can never leak into another tenant's message.

---

## 9. Rollback

Runtime DDL is additive and idempotent, and the legacy `status` column is
mirrored on every write, so the default rollback is **"revert the code, leave
the schema."** Reverting to the previous build leaves a working schema: the old
code reads the mirrored `status` values and ignores the new columns and tables.

To remove the schema additions entirely **after** reverting the code (note:
this drops authored drafts and is not recoverable except by re-deploying the new
build, which re-adds everything via runtime DDL):

```sql
-- Drop new tables (no FK references into them from legacy tables):
DROP TABLE IF EXISTS WaTemplateSyncRun;
DROP TABLE IF EXISTS WaNotifyMapping;
DROP TABLE IF EXISTS WaTemplateActivity;
DROP TABLE IF EXISTS WaTemplateRevision;
DROP TABLE IF EXISTS WaCloudRuntime;

-- Drop new indexes on WaCloudTemplate (ignore "check that column/key exists" errors):
ALTER TABLE WaCloudTemplate DROP INDEX uq_wct_meta_id;
ALTER TABLE WaCloudTemplate DROP INDEX idx_wct_source_state;
ALTER TABLE WaCloudTemplate DROP INDEX idx_wct_op;

-- Drop new WaCloudTemplate columns (legacy columns name/language/category/
-- bodyText/components/variables/varCount/headerType/headerImageUrl/status/
-- rejectionReason/metaTemplateId/notifyKind remain):
ALTER TABLE WaCloudTemplate
  DROP COLUMN displayTitle, DROP COLUMN description, DROP COLUMN purpose,
  DROP COLUMN parameterFormat, DROP COLUMN footerText, DROP COLUMN headerText,
  DROP COLUMN buttons, DROP COLUMN variableMappings, DROP COLUMN sampleValues,
  DROP COLUMN source, DROP COLUMN localState, DROP COLUMN opState,
  DROP COLUMN opKind, DROP COLUMN opClaimedAt, DROP COLUMN metaStatus,
  DROP COLUMN metaCategory, DROP COLUMN qualityScore, DROP COLUMN rejectionDetail,
  DROP COLUMN messagingAccountId, DROP COLUMN lastSubmittedAt, DROP COLUMN lastSyncedAt,
  DROP COLUMN metaUpdatedAt, DROP COLUMN archivedAt, DROP COLUMN createdBy, DROP COLUMN updatedBy;
```

The rollback never touches `Appointment` or any booking table.

---

## 10. Production deployment checklist

- [ ] Set `WA_CLOUD_ENC_KEY` (32-byte hex) so secrets and stored bodies are
      encrypted. Without it, nothing sensitive is persisted in plain text — the
      message body is simply stored as `NULL`.
- [ ] Configure the Cloud credentials (DB row or env): phone number ID,
      Messaging Account ID, access token, app secret, verify token.
- [ ] Confirm the access token scopes in **Account health**
      (`whatsapp_business_management` + `whatsapp_business_messaging`).
- [ ] Register the webhook callback URL and verify token, and subscribe the four
      template webhook fields (§5) in addition to the message/status fields.
- [ ] Verify the webhook handshake succeeds and a signed test delivery is
      accepted; confirm an invalid signature is rejected with `401`.
- [ ] Decide whether to enable scheduled sync
      (`WA_CLOUD_TEMPLATE_SYNC_MINUTES`); leave unset to rely on webhooks plus
      manual sync.
- [ ] Author or install templates, submit for review, and wait for the
      **Approved** webhook/sync before mapping. Never assume approval on submit.
- [ ] Map approved utility templates to notification kinds and enable each
      mapping only after ticking the opt-in acknowledgement.
- [ ] Confirm the fallback invariant: with no enabled mapping, notifications
      still send as plain text and fall back to WhatsApp Web unchanged.
