# Professional services (law, consultant, real estate, CA): WhatsApp utility templates

- Profession (`PROFESSION_OPTIONS` value): `Professional services like law, consultant, real estate, CA` (label "Professional Services (Law, Consultant, Real Estate, CA)")
- Tenant prefix: `advisory-`
- Dashboard: `src/routes/dashboards/professional.tsx`
- Wording used here: consultation, firm or office, advisor or consultant (the `{{3}}` value), client file, queue number. These terms come from the dashboard ("Firm Profile", "Client Records", "Consultant", "Advisor") and the public booking page ("Consultation Scheduled!", "Select Advisor / Consultant", "Consultation Date").
- Templates: 9, all new.

Professional-services tenants book and update through the same server functions as healthcare: `createAppointmentServerFn` / `updateAppointmentServerFn` from `src/routes/dashboards/professional.tsx:1845` / `:1812`, and `createAppointmentPublicServerFn` from the public page. They also get the same reminders. Outbound notifications are template-only; map an approved professional-services template or the event fails closed with `template_not_ready`. The templates below keep the `TEMPLATE_VAR_SPEC` variable order of each kind. Video links and doctor leave notices are not sent to this category.

Samples use the app's formats: `fmtDate` gives `Tuesday, October 20, 2026`, and the time is the booked slot, for example `03:00 PM`.

---

### 1. advisory_consultation_booked

- Status: New — not yet submitted
- App trigger: `booked`, sent by `sendAppointmentNotification` from `src/lib/auth.ts:1210` (dashboard booking), `src/lib/auth.ts:1466` (branch booking) and `src/lib/booking.ts:346` (public booking page)
- Name: `advisory_consultation_booked`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

Your consultation at {{2}} with {{3}} is booked for {{4}} at {{5}}. Your queue number for the day is {{6}}.

Thank you for booking with us.
```

- Variable samples: {{1}} `Rahul Nair` · {{2}} `Desai & Associates` · {{3}} `Meera Desai` · {{4}} `Tuesday, October 20, 2026` · {{5}} `03:00 PM` · {{6}} `2`
- Variable mapping: {{1}} = name, {{2}} = clinicName (firm name), {{3}} = doctorName (advisor or consultant), {{4}} = date, {{5}} = time, {{6}} = tokenNo (`TEMPLATE_VAR_SPEC.booked`)
- Footer: `This is an automated notification message.`
- Buttons: None
- Message validity period: 12 hours (pick the closest option offered)

### 2. advisory_consultation_confirmed

- Status: New — not yet submitted
- App trigger: `confirmed`, sent by `sendAppointmentNotification` at `src/lib/auth.ts:1823` (`updateAppointmentServerFn`, status changed to Confirmed)
- Name: `advisory_consultation_confirmed`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

Your consultation at {{2}} with {{3}} on {{4}} at {{5}} has been confirmed. Your queue number for the day is {{6}}.

We look forward to meeting you.
```

- Variable samples: {{1}} `Rahul Nair` · {{2}} `Desai & Associates` · {{3}} `Meera Desai` · {{4}} `Tuesday, October 20, 2026` · {{5}} `03:00 PM` · {{6}} `2`
- Variable mapping: {{1}} = name, {{2}} = clinicName, {{3}} = doctorName, {{4}} = date, {{5}} = time, {{6}} = tokenNo (`TEMPLATE_VAR_SPEC.confirmed`)
- Footer: `This is an automated notification message.`
- Buttons: None
- Message validity period: 12 hours (pick the closest option offered)

### 3. advisory_consultation_cancelled

- Status: New — not yet submitted
- App trigger: `cancelled`, sent by `sendAppointmentNotification` at `src/lib/auth.ts:1823` (status changed to Cancelled)
- Name: `advisory_consultation_cancelled`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

Your consultation at {{2}} scheduled for {{3}} at {{4}} has been cancelled.

If this was a mistake or you would like to rebook, please contact the office directly.
```

- Variable samples: {{1}} `Rahul Nair` · {{2}} `Desai & Associates` · {{3}} `Tuesday, October 20, 2026` · {{4}} `03:00 PM`
- Variable mapping: {{1}} = name, {{2}} = clinicName, {{3}} = date, {{4}} = time (`TEMPLATE_VAR_SPEC.cancelled`)
- Footer: `This is an automated notification message.`
- Buttons: None
- Message validity period: 12 hours (pick the closest option offered)

### 4. advisory_consultation_completed

- Status: New — not yet submitted
- App trigger: `completed`, sent by `sendAppointmentNotification` at `src/lib/auth.ts:1823` (status changed to Completed). The dashboard marks it complete at `src/routes/dashboards/professional.tsx:3712`.
- Name: `advisory_consultation_completed`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

Thank you for meeting with us at {{2}} today. Your consultation with {{3}} is now complete.

Any notes or next steps from the meeting have been saved to your client file. Have a good day.
```

- Variable samples: {{1}} `Rahul Nair` · {{2}} `Desai & Associates` · {{3}} `Meera Desai`
- Variable mapping: {{1}} = name, {{2}} = clinicName, {{3}} = doctorName (`TEMPLATE_VAR_SPEC.completed`)
- Footer: `This is an automated notification message.`
- Buttons: None
- Message validity period: 12 hours (pick the closest option offered)

### 5. advisory_queue_number_updated

- Status: New — not yet submitted
- App trigger: `tokenUpdated`, sent by `sendPatientMessage` at `src/lib/reminder-scheduler.ts:108` (`runTokenCorrections`, rows flagged at `src/lib/token.server.ts:93`)
- Name: `advisory_queue_number_updated`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

The queue number for your consultation at {{2}} with {{3}} on {{4}} at {{5}} has changed. Your new queue number is {{6}}.

Your consultation date and time have not changed. Please share this number at the reception.
```

- Variable samples: {{1}} `Rahul Nair` · {{2}} `Desai & Associates` · {{3}} `Meera Desai` · {{4}} `Tuesday, October 20, 2026` · {{5}} `03:00 PM` · {{6}} `3`
- Variable mapping: {{1}} = name, {{2}} = clinicName, {{3}} = doctorName, {{4}} = date, {{5}} = time, {{6}} = tokenNo (`TEMPLATE_VAR_SPEC.tokenUpdated`)
- Footer: `This is an automated notification message.`
- Buttons: None
- Message validity period: 3 hours (pick the closest option offered)

### 6. advisory_consultation_reminder_day_before

- Status: New — not yet submitted
- App trigger: `reminderDayBefore`, chosen at `src/lib/reminder-scheduler.ts:216` and sent at `src/lib/reminder-scheduler.ts:253`
- Name: `advisory_consultation_reminder_day_before`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

Reminder: You have a consultation at {{2}} with {{3}} tomorrow, {{4}} at {{5}}. Your queue number for the day is {{6}}.

Please arrive 10 minutes early. See you soon!
```

- Variable samples: {{1}} `Rahul Nair` · {{2}} `Desai & Associates` · {{3}} `Meera Desai` · {{4}} `Tuesday, October 20, 2026` · {{5}} `03:00 PM` · {{6}} `2`
- Variable mapping: {{1}} = name, {{2}} = clinicName, {{3}} = doctorName, {{4}} = date, {{5}} = time, {{6}} = tokenNo (`TEMPLATE_VAR_SPEC.reminderDayBefore`)
- Footer: `This is an automated notification message.`
- Buttons: None
- Message validity period: 12 hours (pick the closest option offered)

### 7. advisory_consultation_reminder_day_of

- Status: New — not yet submitted
- App trigger: `reminderDayOf`, chosen at `src/lib/reminder-scheduler.ts:213` and sent at `src/lib/reminder-scheduler.ts:253`
- Name: `advisory_consultation_reminder_day_of`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

Reminder: Your consultation at {{2}} with {{3}} is today at {{4}}. Your queue number for the day is {{5}}.

Please arrive 10 minutes early.
```

- Variable samples: {{1}} `Rahul Nair` · {{2}} `Desai & Associates` · {{3}} `Meera Desai` · {{4}} `03:00 PM` · {{5}} `2`
- Variable mapping: {{1}} = name, {{2}} = clinicName, {{3}} = doctorName, {{4}} = time, {{5}} = tokenNo (`TEMPLATE_VAR_SPEC.reminderDayOf`)
- Footer: `This is an automated notification message.`
- Buttons: None
- Message validity period: 3 hours (pick the closest option offered)

### 8. advisory_consultation_reminder_2h

- Status: New — not yet submitted
- App trigger: `reminder2h`, chosen at `src/lib/reminder-scheduler.ts:210` and sent at `src/lib/reminder-scheduler.ts:253`
- Name: `advisory_consultation_reminder_2h`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

Reminder: Your consultation at {{2}} with {{3}} is in about 2 hours, today at {{4}}. Your queue number for the day is {{5}}.

See you soon!
```

- Variable samples: {{1}} `Rahul Nair` · {{2}} `Desai & Associates` · {{3}} `Meera Desai` · {{4}} `03:00 PM` · {{5}} `2`
- Variable mapping: {{1}} = name, {{2}} = clinicName, {{3}} = doctorName, {{4}} = time, {{5}} = tokenNo (`TEMPLATE_VAR_SPEC.reminder2h`)
- Footer: `This is an automated notification message.`
- Buttons: None
- Message validity period: 1 hour (pick the closest option offered)

### 9. advisory_consultation_reminder_1h

- Status: New — not yet submitted
- App trigger: `reminder1h`, chosen at `src/lib/reminder-scheduler.ts:207` and sent at `src/lib/reminder-scheduler.ts:253`
- Name: `advisory_consultation_reminder_1h`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

Reminder: Your consultation at {{2}} with {{3}} is in about 1 hour, today at {{4}}. Your queue number for the day is {{5}}.

Please start heading over. See you soon!
```

- Variable samples: {{1}} `Rahul Nair` · {{2}} `Desai & Associates` · {{3}} `Meera Desai` · {{4}} `03:00 PM` · {{5}} `2`
- Variable mapping: {{1}} = name, {{2}} = clinicName, {{3}} = doctorName, {{4}} = time, {{5}} = tokenNo (`TEMPLATE_VAR_SPEC.reminder1h`)
- Footer: `This is an automated notification message.`
- Buttons: None
- Message validity period: 30 minutes (pick the closest option offered)
