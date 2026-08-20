# Requirements Document

## Introduction

The Settings area of the Restaurant_Dashboard (`/dashboards/restaurant`) currently offers a narrower experience than the Settings area of the five Category_Dashboards (`/dashboards/medical`, `/dashboards/beauty`, `/dashboards/gym`, `/dashboards/education`, `/dashboards/professional`). The Category_Dashboards expose seven Settings_Sub_Tabs — business profile (with account security), working hours, a category registry, a bookable-resource directory with per-resource blocked dates, WhatsApp alerts (alert configuration plus device pairing), manage users (create, edit, deactivate, plan limits), and multi location. The Restaurant_Dashboard exposes seven Settings_Sub_Tabs too, but three Category_Dashboard capabilities have no counterpart (category registry, blocked dates, WhatsApp device pairing) and three counterparts are shallower than their Category_Dashboard equivalent (no account security in the profile, no hour presets, a create/delete-only user list).

This feature brings the Restaurant_Dashboard Settings area to parity with the Category_Dashboard Settings areas, expressed in restaurant terms: Dining_Areas take the place of departments and service categories, the Menu takes the place of the service catalogue, Dining_Tables remain the bookable-resource directory, and Closure_Days take the place of provider leaves and holidays. Every capability added here stays inside the existing plan and role gating model, stays scoped to one Tenant, and feeds the same Availability_Service that the Public_Booking_Form already consumes.

Two decisions in this document intentionally change previously specified behaviour, and are called out in the criteria that state them:

- The `Restaurant Profile` sub-tab becomes ungated so that it is present for every account that reaches the Settings area, matching the ungated business-profile sub-tab of every Category_Dashboard. This supersedes the part of `restaurant-table-booking` Requirement 2.9 that omits `Restaurant Profile` when the restaurant configuration permission is neither `operate` nor `view_only`.
- The Settings_Sub_Tab set grows from seven entries to nine entries, so the sub-tab order stated in `restaurant-table-booking` Requirement 2.5 is extended rather than replaced.

## Glossary

- **Tenant**: A workspace identified by a unique `tenantId`. Every account sharing a `tenantId` belongs to the same Tenant.
- **Restaurant_Tenant**: A Tenant whose Business_Profession is `Restaurant and dining`.
- **Restaurant_Dashboard**: The dashboard served at `/dashboards/restaurant`.
- **Category_Dashboard**: Any one of the five non-restaurant dashboards served at `/dashboards/medical`, `/dashboards/beauty`, `/dashboards/gym`, `/dashboards/education`, and `/dashboards/professional`.
- **Settings_Area**: The `Settings` navigation tab body of a dashboard.
- **Settings_Sub_Tab**: One named section inside a Settings_Area (for example `Operating Hours`).
- **Sub_Tab_Selector**: The control that selects the rendered Settings_Sub_Tab.
- **Owner_Account**: The account that owns the Tenant, resolved with role `admin`.
- **Sub_User**: An account of the Tenant stored in `SubUser`, with role `reception` or `doctor`.
- **Branch_Account**: An account of the Tenant stored in `Location`, resolved with role `location`.
- **Feature_Access_Service**: The existing server-side component that resolves, per account, which plan-gated features are available and at which permission level.
- **Config_Permission**: The permission the Feature_Access_Service resolves for the `restaurant_config` feature. Permitted values are `operate`, `view_only`, and `none`.
- **Users_Permission**: The permission the Feature_Access_Service resolves for the `users` feature.
- **Locations_Permission**: The permission the Feature_Access_Service resolves for the `locations` feature.
- **WhatsApp_Permission**: The permission the Feature_Access_Service resolves for the `whatsapp` feature.
- **Booking_Portal_Link**: The public URL `/book/{tenantId}` of the Restaurant_Tenant.
- **Account_Security_Section**: The part of the `Restaurant Profile` sub-tab that changes the signed-in account's own email address and password.
- **Verification_Code**: A 4-digit numeric code emailed to a submitted email address, valid for 5 minutes from issue.
- **Operating_Hours**: The per-weekday Open_Time, Close_Time, and Closed_Flag of a Restaurant_Tenant, expressed in the Tenant_Timezone.
- **Open_Time**: A whole-minute time of day from `00:00` to `23:59`.
- **Close_Time**: A whole-minute time of day from `00:00` to `23:59`.
- **Closed_Flag**: A boolean marking a weekday as closed.
- **Hours_Preset**: A named set of Operating_Hours values applied to all seven weekdays in one action.
- **Closure_Day**: A dated exception that suppresses bookings, described by a Closure_Date, a Closure_Scope, a Closure_Reason, and a Holiday_Flag.
- **Closure_Date**: A calendar date in `YYYY-MM-DD` form, interpreted in the Tenant_Timezone.
- **Closure_Scope**: The reach of a Closure_Day. Permitted values are `restaurant` (the whole Restaurant_Tenant) and a single Dining_Table identifier.
- **Closure_Reason**: A free-text label of at most 100 characters describing a Closure_Day.
- **Holiday_Flag**: A boolean marking a Closure_Day as a public holiday.
- **Dining_Area**: A named seating zone of a Restaurant_Tenant (for example `Main`, `Terrace`, `Private Room`), described by an Area_Name and an Area_Display_Order.
- **Area_Name**: The name of a Dining_Area, of trimmed length 1 to 30 characters.
- **Area_Display_Order**: A whole number from 1 to 999 ordering Dining_Areas.
- **Dining_Table**: A bookable table of a Restaurant_Tenant, described by Table_Name, Seat_Capacity, Table_Area, Display_Order, and Table_State, as defined in the `restaurant-table-booking` spec.
- **Table_Booking**: A stored reservation for a Dining_Table, as defined in the `restaurant-table-booking` spec.
- **Booking_Status**: The stored lifecycle state of a Table_Booking, as defined in the `restaurant-table-booking` spec.
- **Location_Identifier**: The identifier that associates a restaurant settings record with one Branch_Account; an absent Location_Identifier associates the record with the Owner_Account's unscoped restaurant settings.
- **Table_Area**: The Dining_Area a Dining_Table belongs to.
- **Menu_Category**: A named grouping of Menu_Items, described by a Category_Name of trimmed length 1 to 40 characters and a Category_Display_Order from 1 to 999.
- **Menu_Item**: A dish or drink offered by a Restaurant_Tenant, described by an Item_Name of trimmed length 1 to 80 characters, an Item_Price, an Item_Description of at most 300 characters, an Item_Display_Order from 1 to 999, and an Item_State.
- **Item_Price**: A whole number of currency minor units from 0 to 10000000 inclusive.
- **Item_State**: The publication state of a Menu_Item. Permitted values are `available` and `unavailable`.
- **Service_Settings**: The Slot_Interval, Turn_Time, Max_Party_Size, Advance_Booking_Window, Min_Lead_Time, and Tenant_Timezone of a Restaurant_Tenant, as defined in the `restaurant-table-booking` spec.
- **Availability_Service**: The existing component that computes Booking_Slots and Available_Tables for a date.
- **Booking_Slot**: One bookable start time computed by the Availability_Service.
- **Public_Booking_Form**: The public page `/book/{tenantId}` used by guests to book a table.
- **WhatsApp_Alert_Config**: The stored alert phone number and alert-enabled flag of a Tenant.
- **WhatsApp_Session**: The paired WhatsApp Web device session of a Tenant.
- **Session_State**: The reported state of a WhatsApp_Session. Permitted values are `DISCONNECTED`, `CONNECTING`, `QR_READY`, `CONNECTED`, and `ERROR`.
- **Plan_Limit_Message**: A message stating which account type the current subscription plan permits and how many of them.
- **Tenant_Timezone**: The IANA timezone stored in the Service_Settings of the Restaurant_Tenant.
- **Compact_Viewport**: A rendered viewport whose width is less than 768 CSS pixels.
- **Change_Operation**: A create, update, or delete operation applied to a stored record.

## Requirements

### Requirement 1: Settings area structure parity

**User Story:** As a restaurant owner, I want the Settings area to be laid out like the Settings area of the other dashboards, so that I can find every setting in a familiar place.

#### Acceptance Criteria

1. WHEN an account enters the Settings_Area, THE Restaurant_Dashboard SHALL display a section heading and a section description.
2. WHERE the visible set of Settings_Sub_Tabs is nonempty, THE Sub_Tab_Selector SHALL list each visible Settings_Sub_Tab exactly once in the canonical order `Restaurant Profile`, `Operating Hours`, `Dining Areas`, `Tables`, `Menu`, `Booking Rules`, `WhatsApp Alerts`, `Multi Location`, and `Manage Users`.
3. THE Restaurant_Dashboard SHALL provide, for each Settings_Sub_Tab of a Category_Dashboard, one Settings_Sub_Tab counterpart: `Restaurant Profile` for the business profile, `Operating Hours` for working hours, `Dining Areas` for the category registry, `Tables` for the bookable-resource directory, `WhatsApp Alerts` for WhatsApp alerts, `Multi Location` for multi location, and `Manage Users` for manage users.
4. WHILE the Settings_Area is rendered in a Compact_Viewport, THE Settings_Area SHALL render the Sub_Tab_Selector as a single-select dropdown and mark the rendered Settings_Sub_Tab as selected.
5. WHILE the Settings_Area is rendered in a viewport of 768 CSS pixels or wider, THE Settings_Area SHALL render the Sub_Tab_Selector as a horizontal bar and mark the rendered Settings_Sub_Tab as selected.
6. WHEN an account selects a visible Settings_Sub_Tab, THE Settings_Area SHALL render exactly the body of the selected Settings_Sub_Tab.
7. IF an account supplies no requested Settings_Sub_Tab or requests a Settings_Sub_Tab outside the visible set, THEN THE Settings_Area SHALL select and render the first visible Settings_Sub_Tab in the canonical order of criterion 2.
8. IF the visible set of Settings_Sub_Tabs is empty, THEN THE Settings_Area SHALL render neither a Sub_Tab_Selector nor a Settings_Sub_Tab body and SHALL display a message stating that the account's role has no restaurant settings to manage.
9. IF the Feature_Access_Service returns no resolution for the requesting account, THEN THE Settings_Area SHALL render only `Restaurant Profile` as the selected Settings_Sub_Tab together with a message stating that feature access could not be resolved.

### Requirement 2: Restaurant profile and account security parity

**User Story:** As a restaurant owner, I want the profile sub-tab to carry the booking portal, my photo, my restaurant details, and my login credentials, so that I manage my account exactly as owners of the other dashboards do.

#### Acceptance Criteria

1. THE Restaurant_Dashboard SHALL display the `Restaurant Profile` sub-tab for every account that reaches the Settings_Area, superseding the omission of `Restaurant Profile` stated in `restaurant-table-booking` Requirement 2.9.
2. THE `Restaurant Profile` sub-tab SHALL display the exact Booking_Portal_Link of the Restaurant_Tenant as selectable text and a copy control.
3. THE `Restaurant Profile` sub-tab SHALL display a scannable QR code that decodes to the exact Booking_Portal_Link of the Restaurant_Tenant.
4. WHEN an account activates the copy control, THE `Restaurant Profile` sub-tab SHALL write the exact Booking_Portal_Link to the clipboard and display a copied confirmation for 2 seconds.
5. THE `Restaurant Profile` sub-tab SHALL display the stored restaurant name, owner or manager name, account phone, team size, public email, contact number, WhatsApp number, landline, address, cuisine or services, and description.
6. WHERE Config_Permission is `operate`, THE `Restaurant Profile` sub-tab SHALL render editable controls for the profile fields listed in criterion 5.
7. WHERE Config_Permission is `operate`, WHEN an account submits the profile fields listed in criterion 5, THE Restaurant_Dashboard SHALL store the trimmed value of each submitted profile field.
8. WHERE Config_Permission is `view_only`, THE `Restaurant Profile` sub-tab SHALL render the profile fields listed in criterion 5 as read-only.
9. WHERE Config_Permission is `view_only`, THE `Restaurant Profile` sub-tab SHALL render no save control for the profile fields and SHALL display a message stating that the account's role can view but not change the details.
10. WHERE Config_Permission is `operate`, THE `Restaurant Profile` sub-tab SHALL accept a profile photo upload in JPEG, PNG, or WEBP format of at most 5 megabytes.
11. WHERE Config_Permission is `operate`, WHEN a profile photo upload succeeds, THE `Restaurant Profile` sub-tab SHALL display the stored profile photo.
12. IF a submitted profile photo exceeds 5 megabytes or is not in JPEG, PNG, or WEBP format, THEN THE `Restaurant Profile` sub-tab SHALL reject the upload, display a message naming the 5-megabyte limit and the permitted formats, and retain the stored photo unchanged.
13. THE Account_Security_Section SHALL be available to every account that reaches the `Restaurant Profile` sub-tab, independent of Config_Permission.
14. WHEN the Account_Security_Section issues a Verification_Code, THE Account_Security_Section SHALL issue exactly 4 numeric digits that remain valid for exactly 5 minutes from issue.
15. WHEN an account submits an email address that differs from the account's stored email address, THE Account_Security_Section SHALL send a Verification_Code to the submitted address.
16. WHEN the Account_Security_Section sends a Verification_Code, THE Account_Security_Section SHALL display a resend control that becomes usable 60 seconds after the send.
17. IF a submitted email address equals the account's stored email address, THEN THE Account_Security_Section SHALL reject the submission, display a message stating that the address is already registered to the account, and send no Verification_Code.
18. IF a submitted email address is already registered to another account, THEN THE Account_Security_Section SHALL reject the submission, display a message stating that the address is registered to another account, and send no Verification_Code.
19. WHEN an account submits a Verification_Code that matches an unexpired Verification_Code issued for the submitted email address, THE Account_Security_Section SHALL replace the account's stored email address with the submitted address and display the new address as the account email.
20. IF a submitted Verification_Code does not match an unexpired Verification_Code issued for the submitted email address, THEN THE Account_Security_Section SHALL reject the submission, display a message stating that the code is invalid or expired, and retain the stored email address unchanged.
21. WHEN an account submits the correct current password together with a new password of at least 8 characters and a matching confirmation, THE Account_Security_Section SHALL replace the account's stored password with the new password and display a confirmation.
22. IF a submitted new password and the submitted confirmation differ, THEN THE Account_Security_Section SHALL reject the submission, display a message stating that the passwords do not match, and retain the stored password unchanged.
23. IF a submitted new password is shorter than 8 characters, THEN THE Account_Security_Section SHALL reject the submission, display a message stating the 8-character minimum, and retain the stored password unchanged.
24. IF a submitted current password does not match the account's stored password, THEN THE Account_Security_Section SHALL reject the submission, display a message stating that the current password is incorrect, and retain the stored password unchanged.

### Requirement 3: Operating hours editing parity

**User Story:** As a restaurant owner, I want the same hour-editing shortcuts the other dashboards offer, so that setting a weekly schedule takes a few clicks instead of fourteen edits.

#### Acceptance Criteria

1. THE `Operating Hours` sub-tab SHALL display exactly one Operating_Hours entry for each of the seven weekdays.
2. THE `Operating Hours` sub-tab SHALL display the stored Open_Time, stored Close_Time, and stored Closed_Flag in each weekday entry.
3. WHERE Config_Permission is `operate`, THE `Operating Hours` sub-tab SHALL provide at least three named Hours_Presets and a control that applies one submitted Open_Time and Close_Time pair to the displayed weekday entries.
4. WHEN an account applies an Hours_Preset, THE `Operating Hours` sub-tab SHALL set the displayed Open_Time, displayed Close_Time, and displayed Closed_Flag of all seven weekdays to the values of the Hours_Preset without changing the stored Operating_Hours.
5. WHEN an account applies one Open_Time and Close_Time pair to all weekdays, THE `Operating Hours` sub-tab SHALL set the displayed Open_Time and displayed Close_Time of every weekday whose Closed_Flag is false without changing any displayed Closed_Flag or stored Operating_Hours.
6. WHEN an account submits Operating_Hours in which all seven weekdays are present and each weekday is either closed or carries an Open_Time and a strictly later Close_Time, THE Restaurant_Dashboard SHALL store the Operating_Hours of all seven weekdays atomically and display a confirmation.
7. IF a submitted Operating_Hours set omits a weekday or contains one or more open weekdays with an absent Open_Time, an absent Close_Time, or a Close_Time that is not strictly later than the Open_Time, THEN THE Restaurant_Dashboard SHALL reject the whole submission, name each invalid weekday in a message, and retain the stored Operating_Hours of all seven weekdays unchanged.
8. WHERE Config_Permission is `view_only`, THE `Operating Hours` sub-tab SHALL display the stored Operating_Hours as read-only and render no Hours_Preset control, apply-to-all control, or save control.
9. WHEN stored Operating_Hours change, THE Availability_Service SHALL use the changed stored Operating_Hours for every subsequent availability request of that Restaurant_Tenant.

### Requirement 4: Closure days and holidays

**User Story:** As a restaurant owner, I want to block specific dates for the whole restaurant or for one table, so that guests cannot book a day we are shut or a table that is out of service.

#### Acceptance Criteria

1. THE `Operating Hours` sub-tab SHALL display a month calendar interpreted in the Tenant_Timezone and mark every Closure_Date in the displayed month whose Closure_Scope is `restaurant`.
2. THE `Operating Hours` sub-tab SHALL provide controls that navigate from the displayed month to the immediately previous month and the immediately next month.
3. WHERE Config_Permission is `operate`, WHEN an account submits an existing calendar date in `YYYY-MM-DD` form that is not stored for the submitted Closure_Scope together with a Closure_Reason of at most 100 characters and a Holiday_Flag, THE Restaurant_Dashboard SHALL store exactly one Closure_Day carrying the submitted values.
4. WHERE Config_Permission is `operate`, WHEN an account removes a stored Closure_Day, THE Restaurant_Dashboard SHALL delete exactly that Closure_Day and leave every other Closure_Day of the Restaurant_Tenant unchanged.
5. IF a submitted Closure_Date duplicates a stored Closure_Date of the same Closure_Scope, THEN THE Restaurant_Dashboard SHALL reject the submission, display a message stating that the date is already blocked, and leave all stored Closure_Days unchanged.
6. IF a submitted Closure_Reason exceeds 100 characters or a submitted Closure_Date is not an existing calendar date expressed in `YYYY-MM-DD` form, THEN THE Restaurant_Dashboard SHALL reject the submission, display a message naming each offending field and the permitted form, and leave all stored Closure_Days unchanged.
7. WHERE a Closure_Day with Closure_Scope `restaurant` is stored for a requested date, THE Availability_Service SHALL return no Booking_Slot for that date and report the date as closed.
8. WHERE a Closure_Day whose Closure_Scope is a Dining_Table identifier is stored for a requested date, THE Availability_Service SHALL exclude that Dining_Table from every Booking_Slot of that date and evaluate every other Dining_Table under all other availability rules.
9. WHEN a Closure_Day with Closure_Scope `restaurant` is stored for a date on which Table_Bookings exist, THE Restaurant_Dashboard SHALL display the count of all Table_Bookings of the Restaurant_Tenant on that date.
10. WHEN a Closure_Day whose Closure_Scope is a Dining_Table identifier is stored for a date on which Table_Bookings exist, THE Restaurant_Dashboard SHALL display the count of Table_Bookings assigned to that Dining_Table on that date.
11. WHEN a Closure_Day is stored for a date on which Table_Bookings exist, THE Restaurant_Dashboard SHALL retain every affected Table_Booking with its Booking_Status unchanged.
12. THE `Tables` sub-tab SHALL display, for each Dining_Table, the count of stored Closure_Days whose Closure_Scope is that Dining_Table identifier.
13. WHERE Config_Permission is `view_only`, THE `Operating Hours` sub-tab and the `Tables` sub-tab SHALL display stored Closure_Days as read-only and render no create control or delete control for Closure_Days.

### Requirement 5: Dining areas registry

**User Story:** As a restaurant owner, I want a managed list of dining areas like the category list in the other dashboards, so that my tables are grouped consistently instead of by free-typed text.

#### Acceptance Criteria

1. THE `Dining Areas` sub-tab SHALL display every stored Dining_Area of the Restaurant_Tenant ordered by Area_Display_Order ascending, then Area_Name ascending compared case-insensitively, together with the count of Dining_Tables assigned to each Dining_Area.
2. WHERE Config_Permission is `operate`, WHEN an account submits an Area_Name with a trimmed length from 1 to 30 characters that is unique within the Restaurant_Tenant compared case-insensitively after trimming, THE Restaurant_Dashboard SHALL create one Dining_Area with the trimmed Area_Name.
3. WHERE no Area_Display_Order is supplied, WHEN an account submits a new Dining_Area, THE Restaurant_Dashboard SHALL set the Area_Display_Order to 1 greater than the highest stored Area_Display_Order of the Restaurant_Tenant or to 1 when the Restaurant_Tenant holds no other Dining_Area.
4. WHERE Config_Permission is `operate`, WHEN an account requests deletion of a stored Dining_Area with zero assigned Dining_Tables, THE Restaurant_Dashboard SHALL delete that Dining_Area and leave every other Dining_Area unchanged.
5. IF a submitted Area_Name has a trimmed length of 0 or greater than 30 characters, THEN THE Restaurant_Dashboard SHALL reject the submission, display a message stating the 1-to-30-character range, and store no Dining_Area.
6. IF a submitted Area_Name matches a stored Area_Name of the same Restaurant_Tenant compared case-insensitively after trimming, THEN THE Restaurant_Dashboard SHALL reject the submission, display a message stating that the dining area already exists, and store no additional Dining_Area.
7. IF an account requests deletion of a Dining_Area with at least one assigned Dining_Table, THEN THE Restaurant_Dashboard SHALL reject the deletion, display a message stating the count of assigned Dining_Tables, and retain that Dining_Area.
8. THE `Tables` sub-tab SHALL offer only the stored Dining_Areas of the Restaurant_Tenant as the selectable Table_Area values for a submitted Dining_Table.
9. WHERE a Restaurant_Tenant holds no stored Dining_Area, THE Restaurant_Dashboard SHALL treat the Dining_Area named `Main` as the single stored Dining_Area of that Restaurant_Tenant.
10. WHERE Config_Permission is `view_only`, THE `Dining Areas` sub-tab SHALL display the stored Dining_Areas as read-only and render no create control or delete control.

### Requirement 6: Menu management

**User Story:** As a restaurant owner, I want to keep my menu in the dashboard, so that guests see what we serve when they book a table.

#### Acceptance Criteria

1. THE `Menu` sub-tab SHALL display every stored Menu_Category of the Restaurant_Tenant ordered by Category_Display_Order ascending, then Category_Name ascending compared case-insensitively, and display the Menu_Items of each Menu_Category ordered by Item_Display_Order ascending, then Item_Name ascending compared case-insensitively.
2. WHERE Config_Permission is `operate`, THE `Menu` sub-tab SHALL accept creation, editing, and deletion operations for Menu_Categories and Menu_Items.
3. WHEN an account submits a Menu_Item carrying an Item_Name of trimmed length 1 to 80 characters, an Item_Price from 0 to 10000000, an Item_Description of at most 300 characters, and a Menu_Category of the same Restaurant_Tenant, THE Restaurant_Dashboard SHALL store that Menu_Item with Item_State `available` when no Item_State is supplied.
4. IF a submitted Menu_Item carries a field outside the bounds stated in criterion 3, THEN THE Restaurant_Dashboard SHALL reject the submission, display a message naming every offending field together with the permitted bound, and leave all stored Menu_Categories and Menu_Items unchanged.
5. IF a submitted Category_Name matches a stored Category_Name of the same Restaurant_Tenant compared case-insensitively after trimming, THEN THE Restaurant_Dashboard SHALL reject the submission, display a message stating that the menu category already exists, and leave all stored Menu_Categories and Menu_Items unchanged.
6. WHEN an account requests deletion of a Menu_Category that holds Menu_Items, THE Restaurant_Dashboard SHALL display the count of Menu_Items that the deletion would cascade to and leave the Menu_Category and Menu_Items unchanged pending confirmation.
7. WHEN an account confirms deletion of a Menu_Category, THE Restaurant_Dashboard SHALL delete the Menu_Category and every Menu_Item held by that Menu_Category.
8. WHEN an account sets the Item_State of a Menu_Item to `unavailable`, THE `Menu` sub-tab SHALL continue to display the Menu_Item with Item_State `unavailable`.
9. WHERE a stored Menu_Item has Item_State `unavailable`, THE Public_Booking_Form SHALL omit that Menu_Item from the displayed menu.
10. WHERE the Restaurant_Tenant holds at least one Menu_Item whose Item_State is `available`, THE Public_Booking_Form SHALL display the Menu_Categories and their `available` Menu_Items with Item_Name, Item_Price, and Item_Description in the order of criterion 1.
11. WHERE the Restaurant_Tenant holds no Menu_Item whose Item_State is `available`, THE Public_Booking_Form SHALL render no menu section and render every other booking control unchanged.
12. THE Restaurant_Dashboard SHALL store at most 40 Menu_Categories and at most 500 Menu_Items per Restaurant_Tenant.
13. IF a submission would exceed 40 Menu_Categories or 500 Menu_Items for the Restaurant_Tenant, THEN THE Restaurant_Dashboard SHALL reject the submission, display a message stating each exceeded maximum, and leave all stored Menu_Categories and Menu_Items unchanged.
14. WHERE Config_Permission is `view_only`, THE `Menu` sub-tab SHALL display the stored Menu_Categories and Menu_Items as read-only and render no create control, edit control, or delete control.

### Requirement 7: WhatsApp alerts sub-tab parity

**User Story:** As a restaurant owner, I want to pair my WhatsApp device and send a test message from the Settings area, so that I can set up alerts the same way the other dashboards do.

#### Acceptance Criteria

1. WHERE the Feature_Access_Service resolves the `whatsapp` feature as visible, THE Restaurant_Dashboard SHALL include the `WhatsApp Alerts` sub-tab in the visible set of Settings_Sub_Tabs.
2. WHILE the `WhatsApp Alerts` sub-tab is the rendered Settings_Sub_Tab, THE `WhatsApp Alerts` sub-tab SHALL display the stored WhatsApp_Alert_Config as an alert phone number field and an alert-enabled toggle.
3. WHERE WhatsApp_Permission is `operate`, WHEN an account submits a WhatsApp_Alert_Config and storage succeeds, THE Restaurant_Dashboard SHALL store the submitted alert phone number and alert-enabled flag and display a success confirmation.
4. WHILE the `WhatsApp Alerts` sub-tab is the rendered Settings_Sub_Tab, THE `WhatsApp Alerts` sub-tab SHALL display the current Session_State of the WhatsApp_Session and a refresh control.
5. WHEN an account activates the refresh control, THE Restaurant_Dashboard SHALL re-read the Session_State and display the re-read Session_State.
6. WHILE the Session_State is `QR_READY` AND the `WhatsApp Alerts` sub-tab is the rendered Settings_Sub_Tab, THE `WhatsApp Alerts` sub-tab SHALL display the pairing QR code and pairing instructions.
7. WHILE the Session_State is not `CONNECTED` AND the `WhatsApp Alerts` sub-tab is the rendered Settings_Sub_Tab, THE Restaurant_Dashboard SHALL re-read the Session_State at intervals of at most 5 seconds.
8. WHILE the Session_State is `CONNECTED` AND the `WhatsApp Alerts` sub-tab is the rendered Settings_Sub_Tab, THE `WhatsApp Alerts` sub-tab SHALL display the paired phone number, pending message queue count, sent message count, disconnect control, and test-message control.
9. WHERE WhatsApp_Permission is `operate`, WHILE the Session_State is `CONNECTED`, WHEN an account submits a test message to a phone number and queueing succeeds, THE Restaurant_Dashboard SHALL queue the message and display the successful queue outcome.
10. WHERE WhatsApp_Permission is `view_only`, THE `WhatsApp Alerts` sub-tab SHALL display the stored WhatsApp_Alert_Config and Session_State as read-only and render no save control, pairing control, disconnect control, or test-message control.
11. IF storage of a submitted WhatsApp_Alert_Config fails, THEN THE Restaurant_Dashboard SHALL display an error, display no success confirmation, and retain the prior stored WhatsApp_Alert_Config unchanged.
12. IF queueing a submitted test message fails, THEN THE Restaurant_Dashboard SHALL display an error, display no successful queue outcome, and retain the prior stored WhatsApp_Alert_Config unchanged.
13. IF a read of the Session_State fails, THEN THE `WhatsApp Alerts` sub-tab SHALL display Session_State `ERROR` together with a message stating that the WhatsApp session state could not be read and retain the displayed WhatsApp_Alert_Config.

### Requirement 8: Manage users parity

**User Story:** As a restaurant owner, I want to add, edit, deactivate, and remove staff logins with the plan limits shown, so that managing my team matches the other dashboards.

#### Acceptance Criteria

1. WHERE the Feature_Access_Service resolves the `users` feature as visible, THE Restaurant_Dashboard SHALL include the `Manage Users` sub-tab in the visible set of Settings_Sub_Tabs.
2. THE `Manage Users` sub-tab SHALL display every Sub_User of the Restaurant_Tenant with the Sub_User name, email address, phone number, role, and active state.
3. THE `Manage Users` sub-tab SHALL display the Plan_Limit_Message of the Restaurant_Tenant's current subscription plan.
4. WHERE Users_Permission is `operate`, WHEN an account submits a new Sub_User carrying a name, an email address not registered to another account of the Restaurant_Tenant, a role of `reception` or `doctor`, and a password of at least 8 characters that matches the confirmation, THE Restaurant_Dashboard SHALL create the Sub_User in an active state and display a confirmation.
5. WHERE Users_Permission is `operate`, WHEN an account submits an edit to a stored Sub_User, THE Restaurant_Dashboard SHALL store the submitted name, phone number, role, and active state.
6. WHERE Users_Permission is `operate`, WHEN an account submits an edit with a new password of at least 8 characters that matches the confirmation, THE Restaurant_Dashboard SHALL replace the stored password of that Sub_User.
7. WHERE Users_Permission is `operate`, WHEN an account submits an edit without a new password, THE Restaurant_Dashboard SHALL retain the stored password of that Sub_User unchanged.
8. WHERE Users_Permission is `operate`, WHEN an account sets the active state of a Sub_User to inactive, THE Restaurant_Dashboard SHALL store the inactive state and THE Feature_Access_Service SHALL deny that Sub_User access to every plan-gated feature.
9. WHERE Users_Permission is `operate`, WHEN an account confirms deletion of a Sub_User, THE Restaurant_Dashboard SHALL delete that Sub_User and leave every other Sub_User of the Restaurant_Tenant unchanged.
10. IF a submitted role is neither `reception` nor `doctor`, THEN THE Restaurant_Dashboard SHALL reject the submission, display a message naming the permitted roles, and leave every stored Sub_User unchanged.
11. IF a submitted password is shorter than 8 characters or does not match the confirmation, THEN THE Restaurant_Dashboard SHALL reject the submission, display a message naming each failed rule, and leave every stored Sub_User unchanged.
12. IF a submitted email address is already registered to a Sub_User of the Restaurant_Tenant, THEN THE Restaurant_Dashboard SHALL reject the submission, display a message stating that the email address is already in use, and create no Sub_User.
13. IF creation of a Sub_User is refused because the current subscription plan permits no further account of the submitted role, THEN THE `Manage Users` sub-tab SHALL display the refusal message together with a control that opens the `Manage Plans` tab and create no Sub_User.
14. IF a valid Sub_User creation request cannot be stored, THEN THE Restaurant_Dashboard SHALL display a message stating that the Sub_User could not be created and create no Sub_User.
15. WHERE Users_Permission is `view_only`, THE `Manage Users` sub-tab SHALL display the Sub_Users as read-only and render no create control, edit control, delete control, or activation control.

### Requirement 9: Multi location parity for restaurant settings

**User Story:** As an owner of several branches, I want each branch to hold its own tables, dining areas, menu, and closure days, so that branch staff manage only their own restaurant.

#### Acceptance Criteria

1. WHERE the Feature_Access_Service resolves the `locations` feature as visible, THE Restaurant_Dashboard SHALL include the `Multi Location` sub-tab in the visible set of Settings_Sub_Tabs and use the terms `Branch` and `Branches` within that sub-tab.
2. THE `Multi Location` sub-tab SHALL display every Branch_Account of the Restaurant_Tenant with the Branch_Account name, address, contact details, and active state.
3. WHILE a Branch_Account is the signed-in account, THE Settings_Area SHALL display only the Dining_Tables, Dining_Areas, Menu_Categories, Menu_Items, and Closure_Days whose Location_Identifier equals the signed-in Branch_Account identifier.
4. WHILE a Branch_Account is the signed-in account, WHEN storage of a Dining_Table, Dining_Area, Menu_Category, Menu_Item, or Closure_Day succeeds, THE Restaurant_Dashboard SHALL set the Location_Identifier of the stored record to the signed-in Branch_Account identifier.
5. WHILE the Owner_Account is signed in and no Branch_Account is selected, THE Settings_Area SHALL display only Dining_Tables, Dining_Areas, Menu_Categories, Menu_Items, and Closure_Days whose Location_Identifier is absent.
6. WHILE the Owner_Account is the signed-in account, THE Settings_Area SHALL display a control that selects one Branch_Account.
7. WHEN the Owner_Account selects a Branch_Account, THE Settings_Area SHALL restrict every listed Dining_Table, Dining_Area, Menu_Category, Menu_Item, and Closure_Day to records whose Location_Identifier equals the selected Branch_Account identifier.
8. WHERE Locations_Permission is `view_only`, THE `Multi Location` sub-tab SHALL display the Branch_Accounts as read-only and render no create control, edit control, or delete control.

### Requirement 10: Permission and plan gating of the settings area

**User Story:** As a security-conscious owner, I want every settings capability to respect plan and role on the server, so that hiding a control is not the only barrier.

#### Acceptance Criteria

1. THE Settings_Area SHALL display the `Restaurant Profile` sub-tab for every account that reaches the Settings_Area.
2. WHERE Config_Permission is neither `operate` nor `view_only`, THE Settings_Area SHALL omit the `Operating Hours`, `Dining Areas`, `Tables`, `Menu`, and `Booking Rules` sub-tabs.
3. THE Restaurant_Dashboard SHALL enforce Config_Permission on the server for every Change_Operation on Operating_Hours, Closure_Days, Dining_Areas, Menu_Categories, Menu_Items, Dining_Tables, and Service_Settings.
4. IF an account whose Config_Permission is not `operate` submits a Change_Operation for Operating_Hours, Closure_Days, Dining_Areas, Menu_Categories, Menu_Items, Dining_Tables, or Service_Settings, THEN THE Restaurant_Dashboard SHALL reject the Change_Operation, return a message stating that the account is not authorised to change booking rules, and leave every stored record unchanged.
5. THE Restaurant_Dashboard SHALL enforce Users_Permission on the server for every Change_Operation on a Sub_User.
6. IF an account whose Users_Permission is not `operate` submits a Change_Operation for a Sub_User, THEN THE Restaurant_Dashboard SHALL reject the Change_Operation, return an authorisation error, and leave every stored Sub_User unchanged.
7. THE Restaurant_Dashboard SHALL enforce Locations_Permission on the server for every Change_Operation on a Branch_Account.
8. IF an account whose Locations_Permission is not `operate` submits a Change_Operation for a Branch_Account, THEN THE Restaurant_Dashboard SHALL reject the Change_Operation, return an authorisation error, and leave every stored Branch_Account unchanged.
9. THE Restaurant_Dashboard SHALL enforce WhatsApp_Permission on the server for every Change_Operation on the WhatsApp_Alert_Config or WhatsApp_Session.
10. IF an account whose WhatsApp_Permission is not `operate` submits a Change_Operation for the WhatsApp_Alert_Config or WhatsApp_Session, THEN THE Restaurant_Dashboard SHALL reject the Change_Operation, return an authorisation error, and leave the stored WhatsApp_Alert_Config and WhatsApp_Session unchanged.
11. THE Restaurant_Dashboard SHALL scope every read and every write of Dining_Areas, Menu_Categories, Menu_Items, and Closure_Days to the `tenantId` of the requesting account.
12. IF a request references a Dining_Area, Menu_Category, Menu_Item, or Closure_Day of another Tenant, THEN THE Restaurant_Dashboard SHALL reject the request, return a not-found message, and leave every stored record unchanged.

### Requirement 11: Settings persistence consistency

**User Story:** As a restaurant owner, I want saving a setting twice to be harmless and to see the same values when I come back, so that I can trust the Settings area.

#### Acceptance Criteria

1. WHEN an account stores a Dining_Area, Menu_Category, Menu_Item, Closure_Day, or set of Operating_Hours and reads the same record set without an intervening Change_Operation, THE Restaurant_Dashboard SHALL return values equal to the stored submission after the specified trimming and defaulting rules are applied.
2. WHEN an account submits the same unchanged Operating_Hours set, Service_Settings set, or WhatsApp_Alert_Config twice in succession, THE Restaurant_Dashboard SHALL leave the stored values equal to the values stored after the first submission.
3. WHEN an account submits the same Closure_Day twice in succession, THE Restaurant_Dashboard SHALL store exactly one Closure_Day for that Closure_Date and Closure_Scope.
4. THE Restaurant_Dashboard SHALL return Dining_Areas, Menu_Categories, and Menu_Items in the orders stated in Requirement 5 criterion 1 and Requirement 6 criterion 1 for every read, independent of insertion order.
5. WHEN a stored setting change alters availability, THE Availability_Service SHALL use the changed stored values for every subsequent availability computation of that Restaurant_Tenant.
6. WHEN a stored setting change alters availability, THE Restaurant_Dashboard SHALL leave every existing Table_Booking and Booking_Status unchanged.
