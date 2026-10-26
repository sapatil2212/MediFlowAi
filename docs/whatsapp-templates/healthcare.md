# Healthcare and medical: WhatsApp utility templates

- Profession (`PROFESSION_OPTIONS` value): `Healthcare and medical` (label "Healthcare & Medical")
- Tenant prefix: `clinic-`
- Dashboard: `src/routes/dashboards/medical.tsx`
- Wording used here: appointment, clinic, doctor, consultation, prescription, queue number.
- Templates: 17 (1-9 already submitted, 10-17 new).

Templates 1-9 are the ones already submitted in WhatsApp Manager. Their names and bodies are recorded here exactly as submitted, so do not create them again. Templates 10-17 cover the other healthcare messages the app sends today: the doctor leave notices, the video consultation links, and the video versions of the reminders.

Language check for 1-9: the app sends templates as `en_US` by default (`src/lib/wa-cloud-admin.ts:335`). If a submitted template was created as "English" (`en`) and not "English (US)", it will not match. See the "Known gaps" section in [README.md](README.md).

Variable samples use the app's real formats. The date comes from `fmtDate` (`src/lib/appointment-notify.ts:61`, en-US long, for example `Tuesday, October 20, 2026`). The time is the booked slot string, or `fmtTime` (`src/lib/appointment-notify.ts:70`, for example `10:30 AM`) when there is no slot.

---

### 1. appointment_booked

- Status: Submitted
- App trigger: `booked`, sent by `sendAppointmentNotification` from `src/lib/auth.ts:1210` (dashboard booking, `createAppointmentServerFn`), `src/lib/auth.ts:1466` (`createSubLocationBookingServerFn`) and `src/lib/booking.ts:346` (public booking page, `createAppointmentPublicServerFn`)
- Name: `appointment_booked`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

Your appointment at {{2}} with {{3}} is booked for {{4}} at {{5}}. Your queue number at the clinic is {{6}}.

Thank you for choosing us!
```

- Variable samples: {{1}} `Priya Sharma` · {{2}} `CityCare Clinic` · {{3}} `Dr. Rohan Mehta` · {{4}} `Tuesday, October 20, 2026` · {{5}} `10:30 AM` · {{6}} `7`
- Variable mapping: {{1}} = name, {{2}} = clinicName, {{3}} = doctorName, {{4}} = date, {{5}} = time, {{6}} = tokenNo (`TEMPLATE_VAR_SPEC.booked`)
- Footer: `This is an automated notification message.`
- Buttons: None
- Message validity period: 12 hours (pick the closest option offered)

### 2. appointment_confirmed

- Status: Submitted
- App trigger: `confirmed`, sent by `sendAppointmentNotification` at `src/lib/auth.ts:1823` (`updateAppointmentServerFn`, only when the status actually changes to Confirmed; mapping at `src/lib/auth.ts:1809`)
- Name: `appointment_confirmed`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

Your appointment at {{2}} with {{3}} on {{4}} at {{5}} has been confirmed. Your queue number at the clinic is {{6}}.

We look forward to seeing you.
```

- Variable samples: {{1}} `Priya Sharma` · {{2}} `CityCare Clinic` · {{3}} `Dr. Rohan Mehta` · {{4}} `Tuesday, October 20, 2026` · {{5}} `10:30 AM` · {{6}} `7`
- Variable mapping: {{1}} = name, {{2}} = clinicName, {{3}} = doctorName, {{4}} = date, {{5}} = time, {{6}} = tokenNo (`TEMPLATE_VAR_SPEC.confirmed`)
- Footer: `This is an automated notification message.`
- Buttons: None
- Message validity period: 12 hours (pick the closest option offered)

### 3. appointment_cancelled

- Status: Submitted
- App trigger: `cancelled`, sent by `sendAppointmentNotification` at `src/lib/auth.ts:1823` (`updateAppointmentServerFn`, status changed to Cancelled)
- Name: `appointment_cancelled`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

Your appointment at {{2}} scheduled for {{3}} at {{4}} has been cancelled.

If this was a mistake or you would like to rebook, please contact the clinic.
```

- Variable samples: {{1}} `Priya Sharma` · {{2}} `CityCare Clinic` · {{3}} `Tuesday, October 20, 2026` · {{4}} `10:30 AM`
- Variable mapping: {{1}} = name, {{2}} = clinicName, {{3}} = date, {{4}} = time (`TEMPLATE_VAR_SPEC.cancelled`)
- Footer: `This is an automated notification message.`
- Buttons: None
- Message validity period: 12 hours (pick the closest option offered)

### 4. appointment_completed

- Status: Submitted
- App trigger: `completed`, sent by `sendAppointmentNotification` at `src/lib/auth.ts:1823` (`updateAppointmentServerFn`, status changed to Completed, for example when the consultation is finished)
- Name: `appointment_completed`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

Thank you for visiting {{2}} with {{3}} today. Your consultation is now complete.

Your prescription and advice, if any, have been recorded. Take care!
```

- Variable samples: {{1}} `Priya Sharma` · {{2}} `CityCare Clinic` · {{3}} `Dr. Rohan Mehta`
- Variable mapping: {{1}} = name, {{2}} = clinicName, {{3}} = doctorName (`TEMPLATE_VAR_SPEC.completed`)
- Footer: `This is an automated notification message.`
- Buttons: None
- Message validity period: 12 hours (pick the closest option offered)

### 5. appointment_queue_number_updated

- Status: Submitted
- App trigger: `tokenUpdated`, sent by `sendPatientMessage` at `src/lib/reminder-scheduler.ts:108` (`runTokenCorrections`). It covers rows that `renumberDailyTokens` flagged with `tokenNotifyPending = 1` (`src/lib/token.server.ts:93`) after a booking moved their daily number.
- Name: `appointment_queue_number_updated`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

The queue number for your appointment at {{2}} with {{3}} on {{4}} at {{5}} has changed. Your new queue number is {{6}}.

Your appointment date and time are the same. Please share this number at the reception.
```

- Variable samples: {{1}} `Priya Sharma` · {{2}} `CityCare Clinic` · {{3}} `Dr. Rohan Mehta` · {{4}} `Tuesday, October 20, 2026` · {{5}} `10:30 AM` · {{6}} `8`
- Variable mapping: {{1}} = name, {{2}} = clinicName, {{3}} = doctorName, {{4}} = date, {{5}} = time, {{6}} = tokenNo (`TEMPLATE_VAR_SPEC.tokenUpdated`)
- Footer: `This is an automated notification message.`
- Buttons: None
- Message validity period: 3 hours (pick the closest option offered)

### 6. appointment_reminder_day_before

- Status: Submitted
- App trigger: `reminderDayBefore`, chosen at `src/lib/reminder-scheduler.ts:216` and sent by `sendPatientMessage` at `src/lib/reminder-scheduler.ts:253` (in-person appointments; video appointments use template 14)
- Name: `appointment_reminder_day_before`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

Reminder: You have an appointment at {{2}} with {{3}} tomorrow, {{4}} at {{5}}. Your queue number at the clinic is {{6}}.

Please arrive 10 minutes early. See you soon!
```

- Variable samples: {{1}} `Priya Sharma` · {{2}} `CityCare Clinic` · {{3}} `Dr. Rohan Mehta` · {{4}} `Tuesday, October 20, 2026` · {{5}} `10:30 AM` · {{6}} `7`
- Variable mapping: {{1}} = name, {{2}} = clinicName, {{3}} = doctorName, {{4}} = date, {{5}} = time, {{6}} = tokenNo (`TEMPLATE_VAR_SPEC.reminderDayBefore`)
- Footer: `This is an automated notification message.`
- Buttons: None
- Message validity period: 12 hours (pick the closest option offered)

### 7. appointment_reminder_day_of

- Status: Submitted
- App trigger: `reminderDayOf`, chosen at `src/lib/reminder-scheduler.ts:213` (same day, after 8 AM, more than 150 minutes ahead) and sent at `src/lib/reminder-scheduler.ts:253` (in-person; video uses template 15)
- Name: `appointment_reminder_day_of`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

Reminder: Your appointment at {{2}} with {{3}} is today at {{4}}. Your queue number at the clinic is {{5}}.

Please arrive 10 minutes early.
```

- Variable samples: {{1}} `Priya Sharma` · {{2}} `CityCare Clinic` · {{3}} `Dr. Rohan Mehta` · {{4}} `10:30 AM` · {{5}} `7`
- Variable mapping: {{1}} = name, {{2}} = clinicName, {{3}} = doctorName, {{4}} = time, {{5}} = tokenNo (`TEMPLATE_VAR_SPEC.reminderDayOf`)
- Footer: `This is an automated notification message.`
- Buttons: None
- Message validity period: 3 hours (pick the closest option offered)

### 8. appointment_reminder_2h

- Status: Submitted
- App trigger: `reminder2h`, chosen at `src/lib/reminder-scheduler.ts:210` (135 minutes or less ahead) and sent at `src/lib/reminder-scheduler.ts:253` (in-person; video uses template 16)
- Name: `appointment_reminder_2h`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

Reminder: Your appointment at {{2}} with {{3}} is in about 2 hours, today at {{4}}. Your queue number at the clinic is {{5}}.

See you soon!
```

- Variable samples: {{1}} `Priya Sharma` · {{2}} `CityCare Clinic` · {{3}} `Dr. Rohan Mehta` · {{4}} `10:30 AM` · {{5}} `7`
- Variable mapping: {{1}} = name, {{2}} = clinicName, {{3}} = doctorName, {{4}} = time, {{5}} = tokenNo (`TEMPLATE_VAR_SPEC.reminder2h`)
- Footer: `This is an automated notification message.`
- Buttons: None
- Message validity period: 1 hour (pick the closest option offered)

### 9. appointment_reminder_1h

- Status: Submitted
- App trigger: `reminder1h`, chosen at `src/lib/reminder-scheduler.ts:207` (75 minutes or less ahead) and sent at `src/lib/reminder-scheduler.ts:253` (in-person; video uses template 17)
- Name: `appointment_reminder_1h`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

Reminder: Your appointment at {{2}} with {{3}} is in about 1 hour, today at {{4}}. Your queue number at the clinic is {{5}}.

Please start heading over. See you soon!
```

- Variable samples: {{1}} `Priya Sharma` · {{2}} `CityCare Clinic` · {{3}} `Dr. Rohan Mehta` · {{4}} `10:30 AM` · {{5}} `7`
- Variable mapping: {{1}} = name, {{2}} = clinicName, {{3}} = doctorName, {{4}} = time, {{5}} = tokenNo (`TEMPLATE_VAR_SPEC.reminder1h`)
- Footer: `This is an automated notification message.`
- Buttons: None
- Message validity period: 30 minutes (pick the closest option offered)

### 10. appointment_reschedule_needed

- Status: New — not yet submitted
- App trigger: doctor emergency leave. `processDoctorEmergencyLeaveServerFn` (`src/lib/auth.ts:2706`) is called from the Emergency Leave modal (`src/components/medical/DoctorEmergencyLeaveModal.tsx:527`, medical dashboard, Doctor Directory). It sets each affected appointment to `Reschedule Needed` and sends the notice by `enqueueWA` at `src/lib/auth.ts:2827`. Default wording is at `src/lib/auth.ts:2790`.
- Name: `appointment_reschedule_needed`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

We are sorry to inform you that your appointment at {{2}} with {{3}} on {{4}} at {{5}} needs to be rescheduled, because the doctor is unavailable that day due to an unexpected absence.

The clinic will contact you with other available times. You can also call the clinic to choose a new time.
```

- Variable samples: {{1}} `Priya Sharma` · {{2}} `CityCare Clinic` · {{3}} `Dr. Rohan Mehta` · {{4}} `Tue, 20 Oct, 2026` · {{5}} `10:30 AM`
- Variable mapping: {{1}} = appointment name (fallback `Patient`), {{2}} = clinicName (`ClinicProfile.clinicName`, else the account's clinic name), {{3}} = doctor name, {{4}} = appointment date (this path formats it en-IN, for example `Tue, 20 Oct, 2026`), {{5}} = appointment timeSlot (or the en-IN time). There is no `TEMPLATE_VAR_SPEC` entry for this message. The order follows the appointment-notify convention.
- Footer: `This is an automated notification message.`
- Buttons: None
- Message validity period: 12 hours (pick the closest option offered)
- Note: today's text can be edited by staff or written by AI, and it includes the leave reason and invites a reply. The template is fixed text. It leaves out the free-text reason and does not ask for a reply, because the central number cannot receive replies.

### 11. appointment_reinstated

- Status: New — not yet submitted
- App trigger: doctor leave cancelled. `cancelDoctorLeaveAndReinstateAppointmentsServerFn` (`src/lib/auth.ts:2979`) is called from the Cancel Leave modal (`src/components/medical/DoctorCancelLeaveModal.tsx:266`). It sets the selected appointments back to `Confirmed` and sends the notice by `enqueueWA` at `src/lib/auth.ts:3097`. Default wording is at `src/lib/auth.ts:3070`.
- Name: `appointment_reinstated`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

Your appointment at {{2}} with {{3}} on {{4}} at {{5}} will go ahead as originally scheduled. The doctor is available again, and your appointment has been reinstated and confirmed.

You do not need to reschedule. We look forward to seeing you.
```

- Variable samples: {{1}} `Priya Sharma` · {{2}} `CityCare Clinic` · {{3}} `Dr. Rohan Mehta` · {{4}} `Tue, 20 Oct, 2026` · {{5}} `10:30 AM`
- Variable mapping: {{1}} = appointment name (fallback `Patient`), {{2}} = clinicName, {{3}} = doctor name, {{4}} = appointment date (en-IN on this path), {{5}} = appointment timeSlot (or the en-IN time). There is no `TEMPLATE_VAR_SPEC` entry for this message.
- Footer: `This is an automated notification message.`
- Buttons: None
- Message validity period: 12 hours (pick the closest option offered)
- Note: same as template 10. Staff-edited or AI-written text cannot be carried, and the template does not invite a reply.

### 12. appointment_video_link_issued

- Status: New — not yet submitted
- App trigger: `videoLinkIssued`, sent by `sendAppointmentNotification` in `notifyVideoLink` (`src/lib/video.server.ts:1351`). It runs when a video room is created for a video appointment (`src/lib/video.server.ts:1311`, through `syncVideoRoomForAppointment` from `src/lib/auth.ts:1225`, `src/lib/auth.ts:1838` and `src/lib/booking.ts:361`) and from `createVideoRoomServerFn` (`src/lib/video.ts:116`). Ad-hoc meetings send the same kind through `notifyInstantMeetingLink` (`src/lib/video.server.ts:1605`, from `src/lib/video.ts:448`).
- Name: `appointment_video_link_issued`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

Your video consultation at {{2}} with {{3}} is scheduled for {{4}} at {{5}}.

Tap the button below at your appointment time to join from a phone or computer with a camera and microphone. You will wait briefly until the doctor admits you.
```

- Variable samples: {{1}} `Priya Sharma` · {{2}} `CityCare Clinic` · {{3}} `Dr. Rohan Mehta` · {{4}} `Tuesday, October 20, 2026` · {{5}} `10:30 AM`
- Variable mapping: {{1}} = name (ad-hoc meetings fall back to `there`), {{2}} = clinicName, {{3}} = doctorName, {{4}} = date, {{5}} = time (`TEMPLATE_VAR_SPEC.videoLinkIssued`; these paths pass no slot, so the time is `fmtTime` of the appointment time). Button {{1}} = the join token, which is the part of the minted link after `/consult/`.
- Footer: `This is an automated notification message.`
- Buttons: 1 × Visit website. Button text `Join consultation`. URL type Dynamic. Website URL `https://bookmytime.tech/consult/{{1}}` (enter `https://bookmytime.tech/consult/` and Meta adds `{{1}}` at the end). Sample URL `https://bookmytime.tech/consult/Hmi1pJR8hIKWqSHSmSjPiw_2JaX0Pzfexep8ABCgtM4`. The link shape is `${APP_ORIGIN}/consult/${token}` (`src/lib/video.server.ts:271`), and the token is 43 base64url characters.
- Message validity period: 12 hours (pick the closest option offered)
- Note: the app needs a code change before it can send this template (see README "Known gaps").

### 13. appointment_video_link_reissued

- Status: New — not yet submitted
- App trigger: `videoLinkReissued`, sent by `sendAppointmentNotification` in `notifyVideoLink` (`src/lib/video.server.ts:1351`). It runs when the doctor regenerates the join link (`regenerateJoinTokenServerFn`, `src/lib/video.ts:135`, which also revokes the old link).
- Name: `appointment_video_link_reissued`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

Here is your updated video consultation link for {{2}} with {{3}} on {{4}} at {{5}}.

The previous link no longer works. Tap the button below at your appointment time to join.
```

- Variable samples: {{1}} `Priya Sharma` · {{2}} `CityCare Clinic` · {{3}} `Dr. Rohan Mehta` · {{4}} `Tuesday, October 20, 2026` · {{5}} `10:30 AM`
- Variable mapping: {{1}} = name, {{2}} = clinicName, {{3}} = doctorName, {{4}} = date, {{5}} = time (`TEMPLATE_VAR_SPEC.videoLinkReissued`). Button {{1}} = the new join token (after `/consult/`).
- Footer: `This is an automated notification message.`
- Buttons: 1 × Visit website. Button text `Join consultation`. URL type Dynamic. Website URL `https://bookmytime.tech/consult/{{1}}`. Sample URL `https://bookmytime.tech/consult/Hmi1pJR8hIKWqSHSmSjPiw_2JaX0Pzfexep8ABCgtM4`
- Message validity period: 12 hours (pick the closest option offered)
- Note: the app needs a code change before it can send this template (see README "Known gaps").

### 14. appointment_video_reminder_day_before

- Status: New — not yet submitted
- App trigger: `reminderDayBefore` for an appointment with `consultationMode = 'video'`. The scheduler mints a fresh join link for the reminder (`src/lib/reminder-scheduler.ts:230` and `:236`, `issueJoinToken(..., "reminder")`) and sends it at `src/lib/reminder-scheduler.ts:253`. Today's video reminder text includes the link and says "You can join online at your appointment time".
- Name: `appointment_video_reminder_day_before`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

Reminder: You have a video consultation at {{2}} with {{3}} tomorrow, {{4}} at {{5}}. Your queue number is {{6}}.

You can join online at your appointment time using the button below. See you soon!
```

- Variable samples: {{1}} `Priya Sharma` · {{2}} `CityCare Clinic` · {{3}} `Dr. Rohan Mehta` · {{4}} `Tuesday, October 20, 2026` · {{5}} `10:30 AM` · {{6}} `7`
- Variable mapping: {{1}} = name, {{2}} = clinicName, {{3}} = doctorName, {{4}} = date, {{5}} = time, {{6}} = tokenNo (`TEMPLATE_VAR_SPEC.reminderDayBefore`). Button {{1}} = the reminder's join token (after `/consult/`).
- Footer: `This is an automated notification message.`
- Buttons: 1 × Visit website. Button text `Join consultation`. URL type Dynamic. Website URL `https://bookmytime.tech/consult/{{1}}`. Sample URL `https://bookmytime.tech/consult/Hmi1pJR8hIKWqSHSmSjPiw_2JaX0Pzfexep8ABCgtM4`
- Message validity period: 12 hours (pick the closest option offered)

### 15. appointment_video_reminder_day_of

- Status: New — not yet submitted
- App trigger: `reminderDayOf` for a video appointment (`src/lib/reminder-scheduler.ts:213`, join link minted at `:236`, sent at `:253`)
- Name: `appointment_video_reminder_day_of`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

Reminder: Your video consultation at {{2}} with {{3}} is today at {{4}}. Your queue number is {{5}}.

Tap the button below at your appointment time to join.
```

- Variable samples: {{1}} `Priya Sharma` · {{2}} `CityCare Clinic` · {{3}} `Dr. Rohan Mehta` · {{4}} `10:30 AM` · {{5}} `7`
- Variable mapping: {{1}} = name, {{2}} = clinicName, {{3}} = doctorName, {{4}} = time, {{5}} = tokenNo (`TEMPLATE_VAR_SPEC.reminderDayOf`). Button {{1}} = the reminder's join token.
- Footer: `This is an automated notification message.`
- Buttons: 1 × Visit website. Button text `Join consultation`. URL type Dynamic. Website URL `https://bookmytime.tech/consult/{{1}}`. Sample URL `https://bookmytime.tech/consult/Hmi1pJR8hIKWqSHSmSjPiw_2JaX0Pzfexep8ABCgtM4`
- Message validity period: 3 hours (pick the closest option offered)

### 16. appointment_video_reminder_2h

- Status: New — not yet submitted
- App trigger: `reminder2h` for a video appointment (`src/lib/reminder-scheduler.ts:210`, join link minted at `:236`, sent at `:253`)
- Name: `appointment_video_reminder_2h`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

Reminder: Your video consultation at {{2}} with {{3}} is in about 2 hours, today at {{4}}. Your queue number is {{5}}.

Tap the button below at your appointment time to join. See you soon!
```

- Variable samples: {{1}} `Priya Sharma` · {{2}} `CityCare Clinic` · {{3}} `Dr. Rohan Mehta` · {{4}} `10:30 AM` · {{5}} `7`
- Variable mapping: {{1}} = name, {{2}} = clinicName, {{3}} = doctorName, {{4}} = time, {{5}} = tokenNo (`TEMPLATE_VAR_SPEC.reminder2h`). Button {{1}} = the reminder's join token.
- Footer: `This is an automated notification message.`
- Buttons: 1 × Visit website. Button text `Join consultation`. URL type Dynamic. Website URL `https://bookmytime.tech/consult/{{1}}`. Sample URL `https://bookmytime.tech/consult/Hmi1pJR8hIKWqSHSmSjPiw_2JaX0Pzfexep8ABCgtM4`
- Message validity period: 1 hour (pick the closest option offered)

### 17. appointment_video_reminder_1h

- Status: New — not yet submitted
- App trigger: `reminder1h` for a video appointment (`src/lib/reminder-scheduler.ts:207`, join link minted at `:236`, sent at `:253`)
- Name: `appointment_video_reminder_1h`
- Category: Utility
- Language: English (US)
- Type of variable: Number
- Media sample: None
- Header type: None
- Body:

```
Hello {{1}},

Reminder: Your video consultation at {{2}} with {{3}} is in about 1 hour, today at {{4}}. Your queue number is {{5}}.

Please be ready to join online using the button below. See you soon!
```

- Variable samples: {{1}} `Priya Sharma` · {{2}} `CityCare Clinic` · {{3}} `Dr. Rohan Mehta` · {{4}} `10:30 AM` · {{5}} `7`
- Variable mapping: {{1}} = name, {{2}} = clinicName, {{3}} = doctorName, {{4}} = time, {{5}} = tokenNo (`TEMPLATE_VAR_SPEC.reminder1h`). Button {{1}} = the reminder's join token.
- Footer: `This is an automated notification message.`
- Buttons: 1 × Visit website. Button text `Join consultation`. URL type Dynamic. Website URL `https://bookmytime.tech/consult/{{1}}`. Sample URL `https://bookmytime.tech/consult/Hmi1pJR8hIKWqSHSmSjPiw_2JaX0Pzfexep8ABCgtM4`
- Message validity period: 30 minutes (pick the closest option offered)
