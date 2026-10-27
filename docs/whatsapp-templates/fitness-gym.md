# Fitness Gym etc: WhatsApp utility templates

- Profession (`PROFESSION_OPTIONS` value): `Fitness Gym etc` (label "Fitness & Gym")
- Tenant prefix: `gym-`
- Dashboard: `src/routes/dashboards/gym.tsx`
- Wording used here: training session, gym, trainer or coach (the `{{3}}` value), client record, workout plan, queue number. These terms come from the dashboard ("Book Session", "Trainer / Coach", "Session Date", "Workout Plans", "Gym Profile") and the public booking page ("Training Session Scheduled!", "Coach / Trainer").
- Templates: 9, all new.

Gym tenants book and update through the same server functions as healthcare: `createAppointmentServerFn` / `updateAppointmentServerFn` from `src/routes/dashboards/gym.tsx:1874` / `:1841`, and `createAppointmentPublicServerFn` from the public page. They also get the same reminders. Outbound notifications are template-only; map an approved template from this catalogue or the event fails closed with `template_not_ready`. The templates below keep the `TEMPLATE_VAR_SPEC` variable order of each kind. Video links and doctor leave notices are not sent to this category.

Gym specifics in the code:

- The public gym page has no slot picker. It stores the session at 9:00 AM by default (`src/routes/book.$tenantId.tsx:252`), so a public booking's time shows `09:00 AM`.
- A trainer is optional on the public page, so `{{3}}` can be empty. See README "Known gaps".

---

### 1. gym_session_booked

- Status: New — not yet submitted
- App trigger: `booked`, sent by `sendAppointmentNotification` from `src/lib/auth.ts:1210` (dashboard booking), `src/lib/auth.ts:1466` (branch booking) and `src/lib/booking.ts:346` (public booking page)
- Name: `gym_session_booked`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

Your training session at {{2}} with {{3}} is booked for {{4}} at {{5}}. Your queue number for the day is {{6}}.

Thank you for training with us.
```

- Variable samples: {{1}} `Arjun Verma` · {{2}} `IronCore Fitness` · {{3}} `Vikram Singh` · {{4}} `Tuesday, October 20, 2026` · {{5}} `06:30 AM` · {{6}} `3`
- Variable mapping: {{1}} = name, {{2}} = clinicName (gym name), {{3}} = doctorName (trainer or coach), {{4}} = date, {{5}} = time, {{6}} = tokenNo (`TEMPLATE_VAR_SPEC.booked`)
- Footer: `This is an automated notification message.`
- Buttons: None
- Message validity period: 12 hours (pick the closest option offered)

### 2. gym_session_confirmed

- Status: New — not yet submitted
- App trigger: `confirmed`, sent by `sendAppointmentNotification` at `src/lib/auth.ts:1823` (`updateAppointmentServerFn`, status changed to Confirmed)
- Name: `gym_session_confirmed`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

Your training session at {{2}} with {{3}} on {{4}} at {{5}} has been confirmed. Your queue number for the day is {{6}}.

We look forward to seeing you at the gym.
```

- Variable samples: {{1}} `Arjun Verma` · {{2}} `IronCore Fitness` · {{3}} `Vikram Singh` · {{4}} `Tuesday, October 20, 2026` · {{5}} `06:30 AM` · {{6}} `3`
- Variable mapping: {{1}} = name, {{2}} = clinicName, {{3}} = doctorName, {{4}} = date, {{5}} = time, {{6}} = tokenNo (`TEMPLATE_VAR_SPEC.confirmed`)
- Footer: `This is an automated notification message.`
- Buttons: None
- Message validity period: 12 hours (pick the closest option offered)

### 3. gym_session_cancelled

- Status: New — not yet submitted
- App trigger: `cancelled`, sent by `sendAppointmentNotification` at `src/lib/auth.ts:1823` (status changed to Cancelled)
- Name: `gym_session_cancelled`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

Your training session at {{2}} scheduled for {{3}} at {{4}} has been cancelled.

If this was a mistake or you would like to rebook, please contact the gym directly.
```

- Variable samples: {{1}} `Arjun Verma` · {{2}} `IronCore Fitness` · {{3}} `Tuesday, October 20, 2026` · {{4}} `06:30 AM`
- Variable mapping: {{1}} = name, {{2}} = clinicName, {{3}} = date, {{4}} = time (`TEMPLATE_VAR_SPEC.cancelled`)
- Footer: `This is an automated notification message.`
- Buttons: None
- Message validity period: 12 hours (pick the closest option offered)

### 4. gym_session_completed

- Status: New — not yet submitted
- App trigger: `completed`, sent by `sendAppointmentNotification` at `src/lib/auth.ts:1823` (status changed to Completed). The dashboard marks it complete at `src/routes/dashboards/gym.tsx:3760`.
- Name: `gym_session_completed`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

Thank you for training at {{2}} with {{3}} today. Your session is now complete.

Any workout plan or trainer notes from today have been saved to your client record. Take care!
```

- Variable samples: {{1}} `Arjun Verma` · {{2}} `IronCore Fitness` · {{3}} `Vikram Singh`
- Variable mapping: {{1}} = name, {{2}} = clinicName, {{3}} = doctorName (`TEMPLATE_VAR_SPEC.completed`)
- Footer: `This is an automated notification message.`
- Buttons: None
- Message validity period: 12 hours (pick the closest option offered)

### 5. gym_queue_number_updated

- Status: New — not yet submitted
- App trigger: `tokenUpdated`, sent by `sendPatientMessage` at `src/lib/reminder-scheduler.ts:108` (`runTokenCorrections`, rows flagged at `src/lib/token.server.ts:93`)
- Name: `gym_queue_number_updated`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

The queue number for your training session at {{2}} with {{3}} on {{4}} at {{5}} has changed. Your new queue number is {{6}}.

Your session date and time have not changed. Please share this number at the front desk.
```

- Variable samples: {{1}} `Arjun Verma` · {{2}} `IronCore Fitness` · {{3}} `Vikram Singh` · {{4}} `Tuesday, October 20, 2026` · {{5}} `06:30 AM` · {{6}} `4`
- Variable mapping: {{1}} = name, {{2}} = clinicName, {{3}} = doctorName, {{4}} = date, {{5}} = time, {{6}} = tokenNo (`TEMPLATE_VAR_SPEC.tokenUpdated`)
- Footer: `This is an automated notification message.`
- Buttons: None
- Message validity period: 3 hours (pick the closest option offered)

### 6. gym_session_reminder_day_before

- Status: New — not yet submitted
- App trigger: `reminderDayBefore`, chosen at `src/lib/reminder-scheduler.ts:216` and sent at `src/lib/reminder-scheduler.ts:253`
- Name: `gym_session_reminder_day_before`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

Reminder: You have a training session at {{2}} with {{3}} tomorrow, {{4}} at {{5}}. Your queue number for the day is {{6}}.

Please arrive 10 minutes early. See you soon!
```

- Variable samples: {{1}} `Arjun Verma` · {{2}} `IronCore Fitness` · {{3}} `Vikram Singh` · {{4}} `Tuesday, October 20, 2026` · {{5}} `06:30 AM` · {{6}} `3`
- Variable mapping: {{1}} = name, {{2}} = clinicName, {{3}} = doctorName, {{4}} = date, {{5}} = time, {{6}} = tokenNo (`TEMPLATE_VAR_SPEC.reminderDayBefore`)
- Footer: `This is an automated notification message.`
- Buttons: None
- Message validity period: 12 hours (pick the closest option offered)

### 7. gym_session_reminder_day_of

- Status: New — not yet submitted
- App trigger: `reminderDayOf`, chosen at `src/lib/reminder-scheduler.ts:213` and sent at `src/lib/reminder-scheduler.ts:253`
- Name: `gym_session_reminder_day_of`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

Reminder: Your training session at {{2}} with {{3}} is today at {{4}}. Your queue number for the day is {{5}}.

Please arrive 10 minutes early.
```

- Variable samples: {{1}} `Arjun Verma` · {{2}} `IronCore Fitness` · {{3}} `Vikram Singh` · {{4}} `06:30 AM` · {{5}} `3`
- Variable mapping: {{1}} = name, {{2}} = clinicName, {{3}} = doctorName, {{4}} = time, {{5}} = tokenNo (`TEMPLATE_VAR_SPEC.reminderDayOf`)
- Footer: `This is an automated notification message.`
- Buttons: None
- Message validity period: 3 hours (pick the closest option offered)

### 8. gym_session_reminder_2h

- Status: New — not yet submitted
- App trigger: `reminder2h`, chosen at `src/lib/reminder-scheduler.ts:210` and sent at `src/lib/reminder-scheduler.ts:253`
- Name: `gym_session_reminder_2h`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

Reminder: Your training session at {{2}} with {{3}} is in about 2 hours, today at {{4}}. Your queue number for the day is {{5}}.

See you soon!
```

- Variable samples: {{1}} `Arjun Verma` · {{2}} `IronCore Fitness` · {{3}} `Vikram Singh` · {{4}} `06:30 AM` · {{5}} `3`
- Variable mapping: {{1}} = name, {{2}} = clinicName, {{3}} = doctorName, {{4}} = time, {{5}} = tokenNo (`TEMPLATE_VAR_SPEC.reminder2h`)
- Footer: `This is an automated notification message.`
- Buttons: None
- Message validity period: 1 hour (pick the closest option offered)

### 9. gym_session_reminder_1h

- Status: New — not yet submitted
- App trigger: `reminder1h`, chosen at `src/lib/reminder-scheduler.ts:207` and sent at `src/lib/reminder-scheduler.ts:253`
- Name: `gym_session_reminder_1h`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

Reminder: Your training session at {{2}} with {{3}} is in about 1 hour, today at {{4}}. Your queue number for the day is {{5}}.

Please start heading over. See you soon!
```

- Variable samples: {{1}} `Arjun Verma` · {{2}} `IronCore Fitness` · {{3}} `Vikram Singh` · {{4}} `06:30 AM` · {{5}} `3`
- Variable mapping: {{1}} = name, {{2}} = clinicName, {{3}} = doctorName, {{4}} = time, {{5}} = tokenNo (`TEMPLATE_VAR_SPEC.reminder1h`)
- Footer: `This is an automated notification message.`
- Buttons: None
- Message validity period: 30 minutes (pick the closest option offered)
