# Beauty and wellness: WhatsApp utility templates

- Profession (`PROFESSION_OPTIONS` value): `Beauty and wellness` (label "Beauty & Wellness")
- Tenant prefix: `beauty-`
- Dashboard: `src/routes/dashboards/beauty.tsx`
- Wording used here: service appointment, salon, stylist or therapist (the `{{3}}` value), client record, queue number. These terms come from the dashboard ("Stylists & Therapists", "Client Records", "Salon/Spa Profile", "Service History") and the public booking page (`src/routes/book.$tenantId.tsx`: "Service Scheduled!", "Select Stylist / Therapist").
- Templates: 9, all new.

Beauty tenants book and update through the same server functions as healthcare: `createAppointmentServerFn` / `updateAppointmentServerFn` from `src/routes/dashboards/beauty.tsx:1838` / `:1805`, and `createAppointmentPublicServerFn` from the public page. They also get the same reminders. Today they receive the medical plain-text wording from `buildAppointmentMessage`. The templates below use beauty wording but keep the `TEMPLATE_VAR_SPEC` variable order of each kind, so they can be mapped to the existing variables. Video links and doctor leave notices are not sent to this category. Video is healthcare only (`src/lib/feature-access.ts:326`), and the leave tools exist only on the medical dashboard.

Samples use the app's formats: `fmtDate` gives `Tuesday, October 20, 2026`, and the time is the booked slot, for example `11:00 AM`.

---

### 1. beauty_appointment_booked

- Status: New — not yet submitted
- App trigger: `booked`, sent by `sendAppointmentNotification` from `src/lib/auth.ts:1210` (dashboard booking), `src/lib/auth.ts:1466` (branch booking) and `src/lib/booking.ts:346` (public booking page)
- Name: `beauty_appointment_booked`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

Your service appointment at {{2}} with {{3}} is booked for {{4}} at {{5}}. Your queue number for the day is {{6}}.

Thank you for booking with us.
```

- Variable samples: {{1}} `Neha Kapoor` · {{2}} `Glow Beauty Studio` · {{3}} `Aisha Khan` · {{4}} `Tuesday, October 20, 2026` · {{5}} `11:00 AM` · {{6}} `4`
- Variable mapping: {{1}} = name, {{2}} = clinicName (business name), {{3}} = doctorName (stylist or therapist), {{4}} = date, {{5}} = time, {{6}} = tokenNo (`TEMPLATE_VAR_SPEC.booked`)
- Footer: `This is an automated notification message.`
- Buttons: None
- Message validity period: 12 hours (pick the closest option offered)

### 2. beauty_appointment_confirmed

- Status: New — not yet submitted
- App trigger: `confirmed`, sent by `sendAppointmentNotification` at `src/lib/auth.ts:1823` (`updateAppointmentServerFn`, status changed to Confirmed)
- Name: `beauty_appointment_confirmed`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

Your service appointment at {{2}} with {{3}} on {{4}} at {{5}} has been confirmed. Your queue number for the day is {{6}}.

We look forward to welcoming you.
```

- Variable samples: {{1}} `Neha Kapoor` · {{2}} `Glow Beauty Studio` · {{3}} `Aisha Khan` · {{4}} `Tuesday, October 20, 2026` · {{5}} `11:00 AM` · {{6}} `4`
- Variable mapping: {{1}} = name, {{2}} = clinicName, {{3}} = doctorName, {{4}} = date, {{5}} = time, {{6}} = tokenNo (`TEMPLATE_VAR_SPEC.confirmed`)
- Footer: `This is an automated notification message.`
- Buttons: None
- Message validity period: 12 hours (pick the closest option offered)

### 3. beauty_appointment_cancelled

- Status: New — not yet submitted
- App trigger: `cancelled`, sent by `sendAppointmentNotification` at `src/lib/auth.ts:1823` (status changed to Cancelled)
- Name: `beauty_appointment_cancelled`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

Your service appointment at {{2}} scheduled for {{3}} at {{4}} has been cancelled.

If this was a mistake or you would like to rebook, please contact the salon directly.
```

- Variable samples: {{1}} `Neha Kapoor` · {{2}} `Glow Beauty Studio` · {{3}} `Tuesday, October 20, 2026` · {{4}} `11:00 AM`
- Variable mapping: {{1}} = name, {{2}} = clinicName, {{3}} = date, {{4}} = time (`TEMPLATE_VAR_SPEC.cancelled`)
- Footer: `This is an automated notification message.`
- Buttons: None
- Message validity period: 12 hours (pick the closest option offered)

### 4. beauty_service_completed

- Status: New — not yet submitted
- App trigger: `completed`, sent by `sendAppointmentNotification` at `src/lib/auth.ts:1823` (status changed to Completed). The dashboard marks it complete at `src/routes/dashboards/beauty.tsx:3709`.
- Name: `beauty_service_completed`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

Thank you for visiting {{2}} today. Your service with {{3}} is now complete.

Any service notes from your visit have been saved to your client record. Take care!
```

- Variable samples: {{1}} `Neha Kapoor` · {{2}} `Glow Beauty Studio` · {{3}} `Aisha Khan`
- Variable mapping: {{1}} = name, {{2}} = clinicName, {{3}} = doctorName (`TEMPLATE_VAR_SPEC.completed`)
- Footer: `This is an automated notification message.`
- Buttons: None
- Message validity period: 12 hours (pick the closest option offered)

### 5. beauty_queue_number_updated

- Status: New — not yet submitted
- App trigger: `tokenUpdated`, sent by `sendPatientMessage` at `src/lib/reminder-scheduler.ts:108` (`runTokenCorrections`, rows flagged at `src/lib/token.server.ts:93`)
- Name: `beauty_queue_number_updated`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

The queue number for your service appointment at {{2}} with {{3}} on {{4}} at {{5}} has changed. Your new queue number is {{6}}.

Your appointment date and time have not changed. Please share this number at the front desk.
```

- Variable samples: {{1}} `Neha Kapoor` · {{2}} `Glow Beauty Studio` · {{3}} `Aisha Khan` · {{4}} `Tuesday, October 20, 2026` · {{5}} `11:00 AM` · {{6}} `5`
- Variable mapping: {{1}} = name, {{2}} = clinicName, {{3}} = doctorName, {{4}} = date, {{5}} = time, {{6}} = tokenNo (`TEMPLATE_VAR_SPEC.tokenUpdated`)
- Footer: `This is an automated notification message.`
- Buttons: None
- Message validity period: 3 hours (pick the closest option offered)

### 6. beauty_appointment_reminder_day_before

- Status: New — not yet submitted
- App trigger: `reminderDayBefore`, chosen at `src/lib/reminder-scheduler.ts:216` and sent at `src/lib/reminder-scheduler.ts:253`
- Name: `beauty_appointment_reminder_day_before`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

Reminder: You have a service appointment at {{2}} with {{3}} tomorrow, {{4}} at {{5}}. Your queue number for the day is {{6}}.

Please arrive 10 minutes early. See you soon!
```

- Variable samples: {{1}} `Neha Kapoor` · {{2}} `Glow Beauty Studio` · {{3}} `Aisha Khan` · {{4}} `Tuesday, October 20, 2026` · {{5}} `11:00 AM` · {{6}} `4`
- Variable mapping: {{1}} = name, {{2}} = clinicName, {{3}} = doctorName, {{4}} = date, {{5}} = time, {{6}} = tokenNo (`TEMPLATE_VAR_SPEC.reminderDayBefore`)
- Footer: `This is an automated notification message.`
- Buttons: None
- Message validity period: 12 hours (pick the closest option offered)

### 7. beauty_appointment_reminder_day_of

- Status: New — not yet submitted
- App trigger: `reminderDayOf`, chosen at `src/lib/reminder-scheduler.ts:213` and sent at `src/lib/reminder-scheduler.ts:253`
- Name: `beauty_appointment_reminder_day_of`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

Reminder: Your service appointment at {{2}} with {{3}} is today at {{4}}. Your queue number for the day is {{5}}.

Please arrive 10 minutes early.
```

- Variable samples: {{1}} `Neha Kapoor` · {{2}} `Glow Beauty Studio` · {{3}} `Aisha Khan` · {{4}} `11:00 AM` · {{5}} `4`
- Variable mapping: {{1}} = name, {{2}} = clinicName, {{3}} = doctorName, {{4}} = time, {{5}} = tokenNo (`TEMPLATE_VAR_SPEC.reminderDayOf`)
- Footer: `This is an automated notification message.`
- Buttons: None
- Message validity period: 3 hours (pick the closest option offered)

### 8. beauty_appointment_reminder_2h

- Status: New — not yet submitted
- App trigger: `reminder2h`, chosen at `src/lib/reminder-scheduler.ts:210` and sent at `src/lib/reminder-scheduler.ts:253`
- Name: `beauty_appointment_reminder_2h`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

Reminder: Your service appointment at {{2}} with {{3}} is in about 2 hours, today at {{4}}. Your queue number for the day is {{5}}.

See you soon!
```

- Variable samples: {{1}} `Neha Kapoor` · {{2}} `Glow Beauty Studio` · {{3}} `Aisha Khan` · {{4}} `11:00 AM` · {{5}} `4`
- Variable mapping: {{1}} = name, {{2}} = clinicName, {{3}} = doctorName, {{4}} = time, {{5}} = tokenNo (`TEMPLATE_VAR_SPEC.reminder2h`)
- Footer: `This is an automated notification message.`
- Buttons: None
- Message validity period: 1 hour (pick the closest option offered)

### 9. beauty_appointment_reminder_1h

- Status: New — not yet submitted
- App trigger: `reminder1h`, chosen at `src/lib/reminder-scheduler.ts:207` and sent at `src/lib/reminder-scheduler.ts:253`
- Name: `beauty_appointment_reminder_1h`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

Reminder: Your service appointment at {{2}} with {{3}} is in about 1 hour, today at {{4}}. Your queue number for the day is {{5}}.

Please start heading over. See you soon!
```

- Variable samples: {{1}} `Neha Kapoor` · {{2}} `Glow Beauty Studio` · {{3}} `Aisha Khan` · {{4}} `11:00 AM` · {{5}} `4`
- Variable mapping: {{1}} = name, {{2}} = clinicName, {{3}} = doctorName, {{4}} = time, {{5}} = tokenNo (`TEMPLATE_VAR_SPEC.reminder1h`)
- Footer: `This is an automated notification message.`
- Buttons: None
- Message validity period: 30 minutes (pick the closest option offered)
