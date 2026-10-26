# Education institutions: WhatsApp utility templates

- Profession (`PROFESSION_OPTIONS` value): `Education institutions` (label "Education Institutions")
- Tenant prefix: `edu-`
- Dashboard: `src/routes/dashboards/education.tsx`
- Wording used here: session, institute, teacher or instructor (the `{{3}}` value), student record, queue number. These terms come from the dashboard ("Teachers & Instructors", "Students Record", "Academy Profile", "Bookings") and the public booking page ("Session Booked!", "Teacher / Instructor", "Student Name").
- Templates: 9, all new.

Education tenants book and update through the same server functions as healthcare: `createAppointmentServerFn` / `updateAppointmentServerFn` from `src/routes/dashboards/education.tsx:1830` / `:1797`, and `createAppointmentPublicServerFn` from the public page. They also get the same reminders. Today they receive the medical plain-text wording from `buildAppointmentMessage`. The templates below keep the `TEMPLATE_VAR_SPEC` variable order of each kind. Video links and doctor leave notices are not sent to this category.

Education specifics in the code:

- Education bookings never store a time slot. Both the dashboard (`src/routes/dashboards/education.tsx:1839`) and the public page (`src/routes/book.$tenantId.tsx:381`) pass `timeSlot: undefined`.
- So the time variable is always `fmtTime` of the stored date and time. For dashboard bookings this is the chosen time, for example `09:00 AM`. Public bookings send only a date, so the time is not a real session time. See README "Known gaps".
- A teacher is optional on the public page, so `{{3}}` can be empty.

---

### 1. edu_session_booked

- Status: New — not yet submitted
- App trigger: `booked`, sent by `sendAppointmentNotification` from `src/lib/auth.ts:1210` (dashboard booking), `src/lib/auth.ts:1466` (branch booking) and `src/lib/booking.ts:346` (public booking page)
- Name: `edu_session_booked`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

Your session at {{2}} with {{3}} is booked for {{4}} at {{5}}. Your queue number for the day is {{6}}.

Thank you for choosing our institute.
```

- Variable samples: {{1}} `Sneha Patil` · {{2}} `Bright Future Academy` · {{3}} `Kavya Rao` · {{4}} `Tuesday, October 20, 2026` · {{5}} `09:00 AM` · {{6}} `5`
- Variable mapping: {{1}} = name, {{2}} = clinicName (institute name), {{3}} = doctorName (teacher or instructor), {{4}} = date, {{5}} = time, {{6}} = tokenNo (`TEMPLATE_VAR_SPEC.booked`)
- Footer: `This is an automated notification message.`
- Buttons: None
- Message validity period: 12 hours (pick the closest option offered)

### 2. edu_session_confirmed

- Status: New — not yet submitted
- App trigger: `confirmed`, sent by `sendAppointmentNotification` at `src/lib/auth.ts:1823` (`updateAppointmentServerFn`, status changed to Confirmed)
- Name: `edu_session_confirmed`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

Your session at {{2}} with {{3}} on {{4}} at {{5}} has been confirmed. Your queue number for the day is {{6}}.

We look forward to seeing you.
```

- Variable samples: {{1}} `Sneha Patil` · {{2}} `Bright Future Academy` · {{3}} `Kavya Rao` · {{4}} `Tuesday, October 20, 2026` · {{5}} `09:00 AM` · {{6}} `5`
- Variable mapping: {{1}} = name, {{2}} = clinicName, {{3}} = doctorName, {{4}} = date, {{5}} = time, {{6}} = tokenNo (`TEMPLATE_VAR_SPEC.confirmed`)
- Footer: `This is an automated notification message.`
- Buttons: None
- Message validity period: 12 hours (pick the closest option offered)

### 3. edu_session_cancelled

- Status: New — not yet submitted
- App trigger: `cancelled`, sent by `sendAppointmentNotification` at `src/lib/auth.ts:1823` (status changed to Cancelled)
- Name: `edu_session_cancelled`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

Your session at {{2}} scheduled for {{3}} at {{4}} has been cancelled.

If this was a mistake or you would like to rebook, please contact the institute directly.
```

- Variable samples: {{1}} `Sneha Patil` · {{2}} `Bright Future Academy` · {{3}} `Tuesday, October 20, 2026` · {{4}} `09:00 AM`
- Variable mapping: {{1}} = name, {{2}} = clinicName, {{3}} = date, {{4}} = time (`TEMPLATE_VAR_SPEC.cancelled`)
- Footer: `This is an automated notification message.`
- Buttons: None
- Message validity period: 12 hours (pick the closest option offered)

### 4. edu_session_completed

- Status: New — not yet submitted
- App trigger: `completed`, sent by `sendAppointmentNotification` at `src/lib/auth.ts:1823` (status changed to Completed). The dashboard marks it complete at `src/routes/dashboards/education.tsx:3713`.
- Name: `edu_session_completed`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

Thank you for attending your session at {{2}} with {{3}} today. The session is now complete.

Any notes or progress updates from today have been saved to your student record. Take care!
```

- Variable samples: {{1}} `Sneha Patil` · {{2}} `Bright Future Academy` · {{3}} `Kavya Rao`
- Variable mapping: {{1}} = name, {{2}} = clinicName, {{3}} = doctorName (`TEMPLATE_VAR_SPEC.completed`)
- Footer: `This is an automated notification message.`
- Buttons: None
- Message validity period: 12 hours (pick the closest option offered)

### 5. edu_queue_number_updated

- Status: New — not yet submitted
- App trigger: `tokenUpdated`, sent by `sendPatientMessage` at `src/lib/reminder-scheduler.ts:108` (`runTokenCorrections`, rows flagged at `src/lib/token.server.ts:93`)
- Name: `edu_queue_number_updated`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

The queue number for your session at {{2}} with {{3}} on {{4}} at {{5}} has changed. Your new queue number is {{6}}.

Your session date and time have not changed. Please share this number at the front desk.
```

- Variable samples: {{1}} `Sneha Patil` · {{2}} `Bright Future Academy` · {{3}} `Kavya Rao` · {{4}} `Tuesday, October 20, 2026` · {{5}} `09:00 AM` · {{6}} `6`
- Variable mapping: {{1}} = name, {{2}} = clinicName, {{3}} = doctorName, {{4}} = date, {{5}} = time, {{6}} = tokenNo (`TEMPLATE_VAR_SPEC.tokenUpdated`)
- Footer: `This is an automated notification message.`
- Buttons: None
- Message validity period: 3 hours (pick the closest option offered)

### 6. edu_session_reminder_day_before

- Status: New — not yet submitted
- App trigger: `reminderDayBefore`, chosen at `src/lib/reminder-scheduler.ts:216` and sent at `src/lib/reminder-scheduler.ts:253`
- Name: `edu_session_reminder_day_before`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

Reminder: You have a session at {{2}} with {{3}} tomorrow, {{4}} at {{5}}. Your queue number for the day is {{6}}.

Please arrive 10 minutes early. See you soon!
```

- Variable samples: {{1}} `Sneha Patil` · {{2}} `Bright Future Academy` · {{3}} `Kavya Rao` · {{4}} `Tuesday, October 20, 2026` · {{5}} `09:00 AM` · {{6}} `5`
- Variable mapping: {{1}} = name, {{2}} = clinicName, {{3}} = doctorName, {{4}} = date, {{5}} = time, {{6}} = tokenNo (`TEMPLATE_VAR_SPEC.reminderDayBefore`)
- Footer: `This is an automated notification message.`
- Buttons: None
- Message validity period: 12 hours (pick the closest option offered)

### 7. edu_session_reminder_day_of

- Status: New — not yet submitted
- App trigger: `reminderDayOf`, chosen at `src/lib/reminder-scheduler.ts:213` and sent at `src/lib/reminder-scheduler.ts:253`
- Name: `edu_session_reminder_day_of`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

Reminder: Your session at {{2}} with {{3}} is today at {{4}}. Your queue number for the day is {{5}}.

Please arrive 10 minutes early.
```

- Variable samples: {{1}} `Sneha Patil` · {{2}} `Bright Future Academy` · {{3}} `Kavya Rao` · {{4}} `09:00 AM` · {{5}} `5`
- Variable mapping: {{1}} = name, {{2}} = clinicName, {{3}} = doctorName, {{4}} = time, {{5}} = tokenNo (`TEMPLATE_VAR_SPEC.reminderDayOf`)
- Footer: `This is an automated notification message.`
- Buttons: None
- Message validity period: 3 hours (pick the closest option offered)

### 8. edu_session_reminder_2h

- Status: New — not yet submitted
- App trigger: `reminder2h`, chosen at `src/lib/reminder-scheduler.ts:210` and sent at `src/lib/reminder-scheduler.ts:253`
- Name: `edu_session_reminder_2h`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

Reminder: Your session at {{2}} with {{3}} is in about 2 hours, today at {{4}}. Your queue number for the day is {{5}}.

See you soon!
```

- Variable samples: {{1}} `Sneha Patil` · {{2}} `Bright Future Academy` · {{3}} `Kavya Rao` · {{4}} `09:00 AM` · {{5}} `5`
- Variable mapping: {{1}} = name, {{2}} = clinicName, {{3}} = doctorName, {{4}} = time, {{5}} = tokenNo (`TEMPLATE_VAR_SPEC.reminder2h`)
- Footer: `This is an automated notification message.`
- Buttons: None
- Message validity period: 1 hour (pick the closest option offered)

### 9. edu_session_reminder_1h

- Status: New — not yet submitted
- App trigger: `reminder1h`, chosen at `src/lib/reminder-scheduler.ts:207` and sent at `src/lib/reminder-scheduler.ts:253`
- Name: `edu_session_reminder_1h`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

Reminder: Your session at {{2}} with {{3}} is in about 1 hour, today at {{4}}. Your queue number for the day is {{5}}.

Please start heading over. See you soon!
```

- Variable samples: {{1}} `Sneha Patil` · {{2}} `Bright Future Academy` · {{3}} `Kavya Rao` · {{4}} `09:00 AM` · {{5}} `5`
- Variable mapping: {{1}} = name, {{2}} = clinicName, {{3}} = doctorName, {{4}} = time, {{5}} = tokenNo (`TEMPLATE_VAR_SPEC.reminder1h`)
- Footer: `This is an automated notification message.`
- Buttons: None
- Message validity period: 30 minutes (pick the closest option offered)
