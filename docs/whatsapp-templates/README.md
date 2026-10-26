# WhatsApp utility templates for BookMyTime

These files list the Meta WhatsApp message templates (category Utility) that BookMyTime needs for the messages it sends to customers. There is one file per business category in `PROFESSION_OPTIONS` (`src/lib/tenant-provisioning.ts:34`). Each template is written field by field, in the same order as Meta's "Create template" form, so it can be copied straight into WhatsApp Manager.

All categories share one central WhatsApp Business Account (WABA). Template names must therefore be unique across every file.

## Files

| File                                                 | Category (`PROFESSION_OPTIONS` value)                       | Tenant prefix | Dashboard                                | Templates | New |
| ---------------------------------------------------- | ----------------------------------------------------------- | ------------- | ---------------------------------------- | --------- | --- |
| [healthcare.md](healthcare.md)                       | Healthcare and medical                                      | `clinic-`     | `src/routes/dashboards/medical.tsx`      | 17        | 8   |
| [beauty-wellness.md](beauty-wellness.md)             | Beauty and wellness                                         | `beauty-`     | `src/routes/dashboards/beauty.tsx`       | 9         | 9   |
| [fitness-gym.md](fitness-gym.md)                     | Fitness Gym etc                                             | `gym-`        | `src/routes/dashboards/gym.tsx`          | 9         | 9   |
| [professional-services.md](professional-services.md) | Professional services like law, consultant, real estate, CA | `advisory-`   | `src/routes/dashboards/professional.tsx` | 9         | 9   |
| [education.md](education.md)                         | Education institutions                                      | `edu-`        | `src/routes/dashboards/education.tsx`    | 9         | 9   |
| [restaurant.md](restaurant.md)                       | Restaurant and dining                                       | `resto-`      | `src/routes/dashboards/restaurant.tsx`   | 6         | 6   |
| Total                                                |                                                             |               |                                          | 59        | 50  |

## Template index

The app trigger is the `AptNotifyKind` from `src/lib/appointment-notify.ts`, or the function that sends the message.

| App trigger                                                                  | Healthcare                                                                                                                                     | Beauty                                   | Gym                               | Professional                                | Education                         | Restaurant                                                  |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------- | ------------------------------------------- | --------------------------------- | ----------------------------------------------------------- |
| `booked`                                                                     | `appointment_booked` (submitted)                                                                                                               | `beauty_appointment_booked`              | `gym_session_booked`              | `advisory_consultation_booked`              | `edu_session_booked`              | `restaurant_table_booked` (from `queueBookingNotification`) |
| `confirmed`                                                                  | `appointment_confirmed` (submitted)                                                                                                            | `beauty_appointment_confirmed`           | `gym_session_confirmed`           | `advisory_consultation_confirmed`           | `edu_session_confirmed`           | none sent                                                   |
| `cancelled`                                                                  | `appointment_cancelled` (submitted)                                                                                                            | `beauty_appointment_cancelled`           | `gym_session_cancelled`           | `advisory_consultation_cancelled`           | `edu_session_cancelled`           | none sent                                                   |
| `completed`                                                                  | `appointment_completed` (submitted)                                                                                                            | `beauty_service_completed`               | `gym_session_completed`           | `advisory_consultation_completed`           | `edu_session_completed`           | none sent                                                   |
| `tokenUpdated`                                                               | `appointment_queue_number_updated` (submitted)                                                                                                 | `beauty_queue_number_updated`            | `gym_queue_number_updated`        | `advisory_queue_number_updated`             | `edu_queue_number_updated`        | not used                                                    |
| `reminderDayBefore`                                                          | `appointment_reminder_day_before` (submitted)                                                                                                  | `beauty_appointment_reminder_day_before` | `gym_session_reminder_day_before` | `advisory_consultation_reminder_day_before` | `edu_session_reminder_day_before` | `restaurant_reminder_day_before`                            |
| `reminderDayOf`                                                              | `appointment_reminder_day_of` (submitted)                                                                                                      | `beauty_appointment_reminder_day_of`     | `gym_session_reminder_day_of`     | `advisory_consultation_reminder_day_of`     | `edu_session_reminder_day_of`     | `restaurant_reminder_day_of`                                |
| `reminder2h`                                                                 | `appointment_reminder_2h` (submitted)                                                                                                          | `beauty_appointment_reminder_2h`         | `gym_session_reminder_2h`         | `advisory_consultation_reminder_2h`         | `edu_session_reminder_2h`         | `restaurant_reminder_2h`                                    |
| `reminder1h`                                                                 | `appointment_reminder_1h` (submitted)                                                                                                          | `beauty_appointment_reminder_1h`         | `gym_session_reminder_1h`         | `advisory_consultation_reminder_1h`         | `edu_session_reminder_1h`         | `restaurant_reminder_1h`                                    |
| Video reminders (`reminder*` when `consultationMode = 'video'`)              | `appointment_video_reminder_day_before`, `appointment_video_reminder_day_of`, `appointment_video_reminder_2h`, `appointment_video_reminder_1h` | n/a                                      | n/a                               | n/a                                         | n/a                               | n/a                                                         |
| `videoLinkIssued`                                                            | `appointment_video_link_issued`                                                                                                                | n/a                                      | n/a                               | n/a                                         | n/a                               | n/a                                                         |
| `videoLinkReissued`                                                          | `appointment_video_link_reissued`                                                                                                              | n/a                                      | n/a                               | n/a                                         | n/a                               | n/a                                                         |
| Doctor emergency leave (`processDoctorEmergencyLeaveServerFn`)               | `appointment_reschedule_needed`                                                                                                                | n/a                                      | n/a                               | n/a                                         | n/a                               | n/a                                                         |
| Doctor leave cancelled (`cancelDoctorLeaveAndReinstateAppointmentsServerFn`) | `appointment_reinstated`                                                                                                                       | n/a                                      | n/a                               | n/a                                         | n/a                               | n/a                                                         |
| Table reassigned (`queueBookingNotification(..., "tableChanged")`)           | n/a                                                                                                                                            | n/a                                      | n/a                               | n/a                                         | n/a                               | `restaurant_table_changed`                                  |

"n/a" means the category cannot receive that message. Video is healthcare only (`src/lib/feature-access.ts:326`). The doctor leave tools live in the Doctor Directory on the medical dashboard only (`src/routes/dashboards/medical.tsx:11465`). Restaurant status changes send nothing (`src/lib/restaurant.ts:832`).

## How to submit a template in WhatsApp Manager

1. Open WhatsApp Manager, then Account tools, then Message templates, then Create template.
2. Category: Utility. Template type: Default.
3. Name: copy the `Name` value. Language: English (US).
4. Content: Type of variable Number, Media sample None, Header None.
5. Body: paste the fenced body exactly as written. It is plain text with blank lines between paragraphs.
6. Variable samples: enter the sample for each `{{n}}` as listed.
7. Footer: `This is an automated notification message.`
8. Buttons: none, except the healthcare video templates. For those, add one "Visit website" button: URL type Dynamic, base URL `https://bookmytime.tech/consult/` (Meta adds `{{1}}` at the end), and the listed sample URL.
9. Message validity period: turn on the custom period and pick the option closest to the listed value.
10. Submit. If Meta suggests a different category (for example Authentication), do not accept it. Check the body against the rules below.

Submit these in WhatsApp Manager, not from the in-app Super Admin Templates tab. That tab sends only the header and body to Meta (`buildTemplateComponents`, `src/lib/wa-cloud-admin.ts:389`), so the footer and buttons would be lost.

## Rules every template here follows

- Body is 1024 characters or fewer. Variables run `{{1}}` to `{{n}}` with no gaps and appear in that order. The body never starts or ends with a variable. No two variables are next to each other, and every variable has fixed words around it.
- Footer is the same fixed text everywhere: 43 characters, no variables. No header.
- Wording is strictly transactional, so the template stays Utility: no offers, discounts, sales, upsell or "buy" wording.
- No words that push Meta towards Authentication: "token", "code", "OTP", "verify", "verification", "password", "PIN", and no `#` before a number. Meta flagged "Your token number is #{{6}}" as Authentication. That is why the daily token is called "queue number", or "booking number" for restaurants.
- Plain text only: no emojis and no WhatsApp `*bold*` or `_italic_` markers.
- Templates never invite a reply. The central number auto-replies that it cannot receive messages (`src/lib/wa-auto-reply.ts:200`).
- URL buttons put their only variable at the end of the URL. Button text is 25 characters or fewer ([Meta template components](https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates/components)).
- Validity periods for Utility templates can be set from 30 seconds to 12 hours ([8x8 summary of Meta's TTL ranges](https://developer.8x8.com/connect/docs/guide-whatsapp-template-validity-period-ttl/)). The values used here: 1h reminder 30 minutes, 2h reminder 1 hour, day-of reminder 3 hours, queue-number change 3 hours, everything else 12 hours.

## Naming convention

- Lowercase `a-z`, `0-9` and `_` only.
- Healthcare keeps the unprefixed names that are already submitted (`appointment_*`).
- Every other category uses a prefix: `beauty_`, `gym_`, `advisory_`, `edu_`, `restaurant_`.
- After the prefix comes the category's own word for the booking (`appointment`, `session`, `consultation`, `table`), then the event (`booked`, `confirmed`, `cancelled`, `completed`, `queue_number_updated`, `reminder_day_before`, `reminder_day_of`, `reminder_2h`, `reminder_1h`).
- Variable order for every appointment kind matches `TEMPLATE_VAR_SPEC` (`src/lib/appointment-notify.ts:88`), so all categories can share the existing variable builder `buildTemplateVars`. The exceptions are restaurant messages and the doctor leave notices, which have no spec entry. Their files list the order used.

## Not covered (no utility template needed)

- Marketing: WhatsApp campaigns and bulk sends (`createWACampaignServerFn` / `startWACampaignServerFn`, `src/lib/auth.ts:5363` / `:5409`, `sendBulkWAServerFn` `:5638`). These would need Marketing templates.
- Test messages: `sendTestWaServerFn` (`src/lib/auth.ts:3202`), the restaurant settings test (`src/lib/restaurant-settings.ts:3438`) and the Super Admin Cloud test (`testWaCloudConfig`, `src/lib/wa-cloud-admin.ts:224`).
- Replies inside a conversation the customer started: the central auto-reply (`src/lib/wa-auto-reply.ts:260`), and the keyword and AI-booking replies sent from a tenant's own WhatsApp Web session in `wa-server.cjs`. These are inside the 24-hour window, so no template is needed.
- Email: the video link email (`sendVideoLinkEmail`) is not WhatsApp.

## Known gaps

1. Templates are not sent yet. The official channel sends plain text (`src/lib/whatsapp-router.ts:143`). `sendTemplateMessage` (`src/lib/whatsapp-cloud.ts:296`) is not used for notifications. Approving these templates changes nothing until the app is wired to send them.
2. There is one template per notify kind. The template mapping (`WaCloudTemplate.notifyKind`) picks a single template per kind. Choosing the beauty, gym, advisory or edu version needs a code change that selects by tenant profession or prefix.
3. Today's plain text uses medical wording for every non-restaurant category. `buildAppointmentMessage` has no profession branch, so it says "consultation", "prescription", "speedy recovery" and "Token No: #". The `buildTemplateVars` fallbacks are also medical: `our clinic`, `our doctor`, and `—` when there is no token. Gym and education public bookings can have no trainer or teacher, which would show "with our doctor".
4. Video templates need a code change. The app must pass the join token as the URL button parameter, but `sendTemplateMessage` only builds header and body parameters. The Templates tab also refuses to map video kinds (`src/lib/wa-cloud-admin.ts:311`). Video reminders share their notify kind with in-person reminders, so the app must also choose the video template when `consultationMode = 'video'`. The button URL assumes `APP_ORIGIN` is `https://bookmytime.tech` (`src/lib/video.server.ts:94`).
5. Restaurant notices and doctor leave notices go through WhatsApp Web only. They are sent by `enqueueWA` directly (`src/lib/restaurant.ts:472`, `src/lib/auth.ts:2827` / `:3097`), not through the official router. The leave text can be edited by staff or written by AI and includes the reason. A template is fixed text without the reason.
6. Restaurant reminders. Restaurant bookings live in `Appointment`, so the scheduler sends them medical-worded reminders. A booking that spans several tables has one row per table, so the guest can get one reminder per table. Restaurant reminder templates drop `doctorName`, so they need their own variable order when wired.
7. Language. The app defaults to `en_US` (`src/lib/wa-cloud-admin.ts:335`). If the 9 submitted healthcare templates were created as "English" (`en`), either add an English (US) version with the same body, or set the language to `en` on their Templates-tab rows.
8. Education time. Education bookings never store a slot, so the time variable comes from the stored date and time. For public bookings that time is not a real session time.
