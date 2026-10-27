# Restaurant and dining: WhatsApp utility templates

- Profession (`PROFESSION_OPTIONS` value): `Restaurant and dining` (`PROFESSION_RESTAURANT`, `src/lib/restaurant-availability.ts:240`, label "Restaurant & Dining")
- Tenant prefix: `resto-` (`TENANT_PREFIX_RESTAURANT`, `src/lib/restaurant-availability.ts:243`)
- Dashboard: `src/routes/dashboards/restaurant.tsx`
- Wording used here: table booking, restaurant, guest, party size, table, booking number.
- Templates: 6, all new.

Restaurant guests receive two kinds of message from the app today:

1. Booking and table-change notices from `queueBookingNotification`. The helper
   awaits `sendAppointmentNotification` with `restaurantBooked` or
   `restaurantTableChanged`, so only a mapped, approved official Cloud utility
   template can be submitted. The booking write remains successful when the
   template is unavailable.
2. The four appointment reminders. Restaurant bookings are stored in the
   `Appointment` table with no doctor. Each reminder is also template-only; map
   a restaurant-specific approved template whose variables do not require
   `doctorName`, otherwise the event fails closed with `template_not_ready`.

Restaurant booking status changes (`setRestaurantBookingStatusServerFn`, `src/lib/restaurant.ts:832`) send no message, so there are no cancelled, confirmed or completed templates for this category. The restaurant settings test message (`src/lib/restaurant-settings.ts:3438`) is excluded.

Sample formats: booking and table-change notices use `booking.date` exactly as stored (`YYYY-MM-DD`, for example `2026-10-20`; see `src/lib/restaurant.server.ts:1086`). Reminders use `fmtDate` (`Tuesday, October 20, 2026`). Times are slot labels such as `07:30 PM`.

---

### 1. restaurant_table_booked

- Status: New — not yet submitted
- App trigger: `queueBookingNotification(..., "booked")`, called by public, walk-in, and staff reservation creation. The helper awaits the `restaurantBooked` template attempt after persistence.
- Name: `restaurant_table_booked`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

Your table at {{2}} is booked. Here are your booking details:

Date: {{3}}
Time: {{4}}
Party size: {{5}}
Table: {{6}}
Booking number: {{7}}

Please mention your booking number when you arrive. We look forward to seeing you!
```

- Variable samples: {{1}} `Karan Malhotra` · {{2}} `Spice Garden` · {{3}} `2026-10-20` · {{4}} `07:30 PM` · {{5}} `4` · {{6}} `T1 + T2` · {{7}} `12`
- Variable mapping: {{1}} = name, {{2}} = clinicName, {{3}} = date, {{4}} = time, {{5}} = partySize, {{6}} = tableName, {{7}} = tokenNo (`restaurantBooked`).
- Footer: `This is an automated notification message.`
- Buttons: None
- Message validity period: 12 hours (pick the closest option offered)

### 2. restaurant_table_changed

- Status: New — not yet submitted
- App trigger: `queueBookingNotification(..., "tableChanged")` after a genuine table reassignment. The helper awaits the `restaurantTableChanged` template attempt after persistence.
- Name: `restaurant_table_changed`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

The table for your booking at {{2}} has been changed. Here are your updated booking details:

Date: {{3}}
Time: {{4}}
Party size: {{5}}
New table: {{6}}
Booking number: {{7}}

Your date and time are the same, only the table has changed. See you soon!
```

- Variable samples: {{1}} `Karan Malhotra` · {{2}} `Spice Garden` · {{3}} `2026-10-20` · {{4}} `07:30 PM` · {{5}} `4` · {{6}} `T5` · {{7}} `12`
- Variable mapping: {{1}} = name, {{2}} = clinicName, {{3}} = date, {{4}} = time, {{5}} = partySize, {{6}} = tableName, {{7}} = tokenNo (`restaurantTableChanged`).
- Footer: `This is an automated notification message.`
- Buttons: None
- Message validity period: 12 hours (pick the closest option offered)

### 3. restaurant_reminder_day_before

- Status: New — not yet submitted
- App trigger: `reminderDayBefore` for a restaurant booking row, chosen at `src/lib/reminder-scheduler.ts:216` and sent at `src/lib/reminder-scheduler.ts:253`
- Name: `restaurant_reminder_day_before`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

Reminder: You have a table booking at {{2}} tomorrow, {{3}} at {{4}}. Your booking number is {{5}}.

Please arrive on time so your table is ready for you. See you soon!
```

- Variable samples: {{1}} `Karan Malhotra` · {{2}} `Spice Garden` · {{3}} `Tuesday, October 20, 2026` · {{4}} `07:30 PM` · {{5}} `12`
- Variable mapping: {{1}} = name, {{2}} = clinicName (the scheduler reads `User.clinicName`), {{3}} = date, {{4}} = time, {{5}} = tokenNo. This is `TEMPLATE_VAR_SPEC.reminderDayBefore` without `doctorName`.
- Footer: `This is an automated notification message.`
- Buttons: None
- Message validity period: 12 hours (pick the closest option offered)

### 4. restaurant_reminder_day_of

- Status: New — not yet submitted
- App trigger: `reminderDayOf` for a restaurant booking row, chosen at `src/lib/reminder-scheduler.ts:213` and sent at `src/lib/reminder-scheduler.ts:253`
- Name: `restaurant_reminder_day_of`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

Reminder: Your table booking at {{2}} is today at {{3}}. Your booking number is {{4}}.

Please arrive on time so your table is ready for you.
```

- Variable samples: {{1}} `Karan Malhotra` · {{2}} `Spice Garden` · {{3}} `07:30 PM` · {{4}} `12`
- Variable mapping: {{1}} = name, {{2}} = clinicName, {{3}} = time, {{4}} = tokenNo. This is `TEMPLATE_VAR_SPEC.reminderDayOf` without `doctorName`.
- Footer: `This is an automated notification message.`
- Buttons: None
- Message validity period: 3 hours (pick the closest option offered)

### 5. restaurant_reminder_2h

- Status: New — not yet submitted
- App trigger: `reminder2h` for a restaurant booking row, chosen at `src/lib/reminder-scheduler.ts:210` and sent at `src/lib/reminder-scheduler.ts:253`
- Name: `restaurant_reminder_2h`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

Reminder: Your table booking at {{2}} is in about 2 hours, today at {{3}}. Your booking number is {{4}}.

See you soon!
```

- Variable samples: {{1}} `Karan Malhotra` · {{2}} `Spice Garden` · {{3}} `07:30 PM` · {{4}} `12`
- Variable mapping: {{1}} = name, {{2}} = clinicName, {{3}} = time, {{4}} = tokenNo. This is `TEMPLATE_VAR_SPEC.reminder2h` without `doctorName`.
- Footer: `This is an automated notification message.`
- Buttons: None
- Message validity period: 1 hour (pick the closest option offered)

### 6. restaurant_reminder_1h

- Status: New — not yet submitted
- App trigger: `reminder1h` for a restaurant booking row, chosen at `src/lib/reminder-scheduler.ts:207` and sent at `src/lib/reminder-scheduler.ts:253`
- Name: `restaurant_reminder_1h`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

Reminder: Your table booking at {{2}} is in about 1 hour, today at {{3}}. Your booking number is {{4}}.

Please start heading over. See you soon!
```

- Variable samples: {{1}} `Karan Malhotra` · {{2}} `Spice Garden` · {{3}} `07:30 PM` · {{4}} `12`
- Variable mapping: {{1}} = name, {{2}} = clinicName, {{3}} = time, {{4}} = tokenNo. This is `TEMPLATE_VAR_SPEC.reminder1h` without `doctorName`.
- Footer: `This is an automated notification message.`
- Buttons: None
- Message validity period: 30 minutes (pick the closest option offered)
