# Requirements Document

## Introduction

BookMyTime already serves five business categories selected from the **Business Profession / Industry** dropdown at signup (Healthcare & Medical, Beauty & Wellness, Fitness & Gym, Professional Services, Education Institutions). Each category gets its own dashboard route under `/dashboards/*`, its own tenant id prefix, and its own vocabulary on the shared public booking page `/book/$tenantId`.

This feature adds a sixth category: **Restaurant & Dining**. A Restaurant_Tenant gets a dedicated dashboard that mirrors the structure of the existing category dashboards (Overview, Calendar, Bookings List, Guests, WhatsApp, Settings, Manage Plans) plus the capabilities a restaurant actually needs:

1. **Table management** — the owner registers each dining table with a name and a seat capacity, grouped into areas (for example Indoor, Outdoor, Rooftop).
2. **Service configuration** — operating hours per weekday, slot interval, turn time, party size limit, advance booking window, and minimum lead time.
3. **A visual table booking form** — the guest picks party size, date, and time slot, then sees a visual layout of the restaurant's tables with live availability and picks a table (or lets the system assign one).
4. **Owner-side records** — every booking is recorded against a table with party size, slot, status, and token, filterable and editable from the dashboard, including walk-in bookings entered by staff and table reassignment.

A booking may hold **one or more tables**: a party too large for any single table combines several into a Table_Group, and no table carries a minimum party — a party of one may take four tables if it wants them. Seat_Capacity is guidance, never a refusal.

Scope boundary: floor-plan drag-and-drop coordinates, menus, pre-orders, and deposits are outside this scope.

## Glossary

- **Tenant**: A logical workspace identified by a unique `tenantId`. All accounts sharing a `tenantId` belong to the same Tenant.
- **Business_Profession**: The industry value stored on the owner account (`User.profession`), chosen from the Business Profession / Industry dropdown at signup.
- **Restaurant_Tenant**: A Tenant whose Business_Profession equals `Restaurant and dining`.
- **Tenant_Timezone**: The IANA timezone held in the Restaurant Profile of a Tenant, in which Open_Time, Close_Time, Booking_Slot start times, the current time, and the current date are evaluated for that Tenant.
- **Owner_Account**: The parent account of a Tenant, resolved with role `admin`.
- **Staff_Account**: A child account of a Tenant, resolved with role `reception`, `doctor`, or `location`.
- **Guest**: A person who books a table. Stored as a guest record scoped to one Tenant.
- **Normalised_Phone**: The phone value produced by removing every space, hyphen, opening bracket, and closing bracket from a submitted phone value. Two phone values match when their Normalised_Phone values are equal.
- **Signup_Form**: The `/signup` page, which collects business details including Business_Profession.
- **Account_Service**: The server-side component that creates owner accounts and assigns each new Tenant its `tenantId`.
- **Dashboard_Router**: The `/dashboard` route, which redirects an authenticated account to the dashboard matching its Business_Profession.
- **Restaurant_Dashboard**: The owner-facing dashboard served at `/dashboards/restaurant`.
- **Core_Navigation_Entry**: A Restaurant_Dashboard navigation entry that is present for every account of a Restaurant_Tenant. The Core_Navigation_Entries are `Overview`, `Calendar`, `Bookings List`, `Guests`, and `Settings`.
- **Gated_Navigation_Entry**: A Restaurant_Dashboard navigation entry or Settings sub-tab whose presence the Feature_Access_Service resolves. The Gated_Navigation_Entries are `WhatsApp`, `Manage Plans`, `WhatsApp Alerts`, `Multi Location`, and `Manage Users`.
- **Dining_Table**: A bookable table belonging to one Restaurant_Tenant, described by Table_Name, Seat_Capacity, Table_Area, Display_Order, and Table_State.
- **Table_Name**: The human-readable identifier of a Dining_Table (for example `T1`, `Window 4`, `Booth A`).
- **Seat_Capacity**: The number of guests a Dining_Table seats, expressed as a whole number.
- **Table_Area**: A named grouping of Dining_Tables within one Restaurant_Tenant (for example `Indoor`, `Outdoor`, `Rooftop`).
- **Display_Order**: A whole number that orders Dining_Tables within one Table_Area.
- **Table_State**: The lifecycle state of a Dining_Table. Permitted values are `active` and `inactive`.
- **Table_Registry**: The server-side component that creates, reads, updates, deactivates, and deletes Dining_Tables.
- **Service_Settings**: The per-Tenant restaurant configuration comprising Slot_Interval, Turn_Time, Max_Party_Size, Advance_Booking_Window, and Min_Lead_Time.
- **Operating_Hours**: The per-weekday Open_Time, Close_Time, and Closed_Flag of a Restaurant_Tenant.
- **Open_Time**: The clock time at which a Restaurant_Tenant starts service on a given weekday.
- **Close_Time**: The clock time at which a Restaurant_Tenant stops service on a given weekday.
- **Closed_Flag**: A boolean marking a weekday on which a Restaurant_Tenant provides no service.
- **Slot_Interval**: The number of minutes between consecutive Booking_Slot start times.
- **Turn_Time**: The number of minutes a Dining_Table stays occupied by one Table_Booking.
- **Max_Party_Size**: The largest Party_Size a Restaurant_Tenant accepts through the Public_Booking_Form.
- **Advance_Booking_Window**: The number of days ahead of the current date for which a Guest may book.
- **Min_Lead_Time**: The number of minutes that must remain between the current time and a Booking_Slot start time for that Booking_Slot to be bookable.
- **Booking_Slot**: A discrete service start time on a given date, generated from Operating_Hours at Slot_Interval steps.
- **Party_Size**: The number of guests included in one Table_Booking.
- **Occupancy_Window**: The half-open time interval `[slot start, slot start + Turn_Time)` during which a Table_Booking occupies its Dining_Table.
- **Table_Booking**: A recorded reservation of one Dining_Table for one Guest, holding Party_Size, booking date-time, Booking_Slot, assigned Dining_Table, Turn_Time snapshot, Booking_Status, Booking_Token, and Booking_Group.
- **Table_Group**: The one or more Dining_Tables a single reservation holds. A Table_Group of one is the ordinary case; a larger one seats a party no single Dining_Table can seat. No relationship is required between the summed Seat_Capacity of a Table_Group and the Party_Size.
- **Booking_Group**: The identifier shared by the Table_Bookings of one reservation, one per Dining_Table of its Table_Group. For a Table_Group of one, the Booking_Group equals that Table_Booking's own identifier. Every Table_Booking of a Booking_Group shares its Guest, Party_Size, booking date-time, Booking_Slot, Booking_Status, and Booking_Token.
- **Booking_Status**: The state of a Table_Booking. Permitted values are `Pending`, `Confirmed`, `Seated`, `Completed`, `Cancelled`, and `No Show`.
- **Blocking_Status**: A Booking_Status that reserves a Dining_Table. The Blocking_Statuses are `Pending`, `Confirmed`, `Seated`, and `Completed`.
- **Releasing_Status**: A Booking_Status that frees a Dining_Table. The Releasing_Statuses are `Cancelled` and `No Show`.
- **Booking_Token**: A sequential whole number assigned per Tenant per calendar date to each Table_Booking.
- **Availability_Service**: The server-side component that computes Booking_Slots and, per Booking_Slot, the set of available Dining_Tables.
- **Available_Table**: A Dining_Table whose Table_State is `active` and whose Occupancy_Window for the requested Booking_Slot overlaps no existing Table_Booking in a Blocking_Status. Seat_Capacity does not affect membership: tables combine into a Table_Group to seat a larger party, and no table carries a minimum party.
- **Booking_Service**: The server-side component that creates and updates Table_Bookings.
- **Public_Booking_Form**: The public page `/book/$tenantId` used by Guests to create bookings.
- **Table_Layout_View**: The visual component of the Public_Booking_Form and Restaurant_Dashboard that renders Dining_Tables grouped by Table_Area with an availability state per Dining_Table.
- **Availability_State**: The rendered state of a Dining_Table in the Table_Layout_View. Permitted values are `Available`, `Unavailable`, and `Selected`.
- **Feature_Access_Service**: The existing component that resolves, per account, which plan-gated features are available and at which permission level.
- **Notification_Service**: The existing WhatsApp notification pipeline that queues messages for a Tenant.
- **Location**: A branch of a Tenant stored in the `Location` table, used when the multi-location feature is available.
- **Primary_Location**: The default Location of a Tenant, used when the multi-location feature is unavailable.

## Requirements

### Requirement 1: Restaurant category selection at signup

**User Story:** As a restaurant owner, I want to pick Restaurant & Dining when I sign up, so that my workspace is created as a restaurant workspace from the start.

#### Acceptance Criteria

1. THE Signup_Form SHALL display an option labelled `Restaurant & Dining` carrying the value `Restaurant and dining` in the Business Profession / Industry control as a sixth option added alongside the five existing Business_Profession options `Healthcare and medical`, `Beauty and wellness`, `Fitness Gym etc`, `Professional services like law, consultant, real estate, CA`, and `Education institutions`, retaining each of those five options with its existing label and its existing value.
2. WHERE the selected Business_Profession is `Restaurant and dining`, THE Signup_Form SHALL label the business name field `Restaurant Name` and SHALL accept in that field a business name whose trimmed length is between 1 and 100 characters inclusive.
3. WHEN a signup is submitted with Business_Profession `Restaurant and dining`, THE Account_Service SHALL store `Restaurant and dining` as the Business_Profession of the created Owner_Account.
4. WHEN the Account_Service creates a Tenant whose Business_Profession is `Restaurant and dining`, THE Account_Service SHALL assign a `tenantId` that starts with `resto-` and that differs from the `tenantId` of every existing Tenant.
5. WHEN the Account_Service creates a Restaurant_Tenant, THE Account_Service SHALL store for that Tenant the default Service_Settings Slot_Interval 30 minutes, Turn_Time 90 minutes, Max_Party_Size 12, Advance_Booking_Window 60 days, and Min_Lead_Time 30 minutes.
6. IF a signup is submitted with Business_Profession `Restaurant and dining` and a business name whose trimmed length is 0 or greater than 100 characters, THEN THE Signup_Form SHALL reject the submission, return a message stating that the restaurant name must be between 1 and 100 characters, send no signup request, and retain the values already entered in the form.
7. WHEN the selected Business_Profession changes from `Restaurant and dining` to another Business_Profession, THE Signup_Form SHALL restore the default business name field label and retain the text already entered in the business name field.
8. IF the creation of the Owner_Account, the creation of the Tenant, or the creation of the default Service_Settings fails during a Restaurant_Tenant signup, THEN THE Account_Service SHALL persist none of the Owner_Account, the Tenant, and the default Service_Settings, return an error indication to the Signup_Form, and leave no partially created Tenant.

### Requirement 2: Restaurant dashboard routing and structure

**User Story:** As a restaurant owner, I want my own dashboard that works like the other category dashboards, so that I manage bookings in a familiar layout.

#### Acceptance Criteria

1. WHEN an authenticated account whose Business_Profession is `Restaurant and dining` opens `/dashboard`, THE Dashboard_Router SHALL navigate to `/dashboards/restaurant`.
2. WHEN an authenticated account whose Business_Profession differs from `Restaurant and dining`, whose Business_Profession is absent, or whose Business_Profession is an empty value requests `/dashboards/restaurant`, THE Restaurant_Dashboard SHALL redirect that account to `/dashboard` and SHALL render no Restaurant_Dashboard content before that redirect.
3. IF a request for `/dashboards/restaurant` carries no session, carries an expired session, or carries a session that resolves to no account, THEN THE Restaurant_Dashboard SHALL redirect the request to `/login` and render no Restaurant_Dashboard content before that redirect.
4. THE Restaurant_Dashboard SHALL display the Core_Navigation_Entries `Overview`, `Calendar`, `Bookings List`, `Guests`, and `Settings` for every account that reaches `/dashboards/restaurant`.
5. THE Restaurant_Dashboard SHALL display the Settings sub-tabs `Restaurant Profile`, `Operating Hours`, `Tables`, and `Booking Rules` for every account whose resolved permission for restaurant configuration is `operate`.
6. WHERE the Feature_Access_Service resolves a Gated_Navigation_Entry as visible for the requesting account, THE Restaurant_Dashboard SHALL display that Gated_Navigation_Entry.
7. WHERE the Feature_Access_Service resolves a Gated_Navigation_Entry as not visible for the requesting account, THE Restaurant_Dashboard SHALL omit that Gated_Navigation_Entry from the rendered navigation.
8. WHERE the resolved permission of the requesting account for restaurant configuration is `view_only`, THE Restaurant_Dashboard SHALL display the stored Dining_Tables in the `Tables` sub-tab and the stored Service_Settings in the `Booking Rules` sub-tab, SHALL render no create control, edit control, delete control, or save control for Dining_Tables or Service_Settings, and SHALL, together with the Table_Registry, reject every change to a Dining_Table or to Service_Settings submitted by that account and retain the stored Dining_Tables and the stored Service_Settings unchanged.
9. WHERE the resolved permission of the requesting account for restaurant configuration is neither `operate` nor `view_only`, THE Restaurant_Dashboard SHALL omit the `Restaurant Profile`, `Operating Hours`, `Tables`, and `Booking Rules` sub-tabs.
10. IF the Feature_Access_Service returns no resolution for the requesting account, THEN THE Restaurant_Dashboard SHALL display only the Core_Navigation_Entries, omit every Gated_Navigation_Entry and every Settings sub-tab, and display a message stating that feature access could not be resolved.
11. IF an account requests a Gated_Navigation_Entry that the Feature_Access_Service resolves as not visible for that account, THEN THE Restaurant_Dashboard SHALL render the `Overview` entry and render no content of the requested Gated_Navigation_Entry.

### Requirement 3: Table management

**User Story:** As a restaurant owner, I want to add my tables with names and seat counts, so that guests can book a specific real table.

#### Acceptance Criteria

1. WHEN the Owner_Account submits a Table_Name whose trimmed length is between 1 and 40 characters together with a Seat_Capacity that is a whole number between 1 and 30, THE Table_Registry SHALL create a Dining_Table scoped to the `tenantId` of the requesting session holding the trimmed Table_Name, the submitted Seat_Capacity, and Table_State `active`, and SHALL return the identifier of the created Dining_Table.
2. THE Table_Registry SHALL accept a Table_Name whose trimmed length is between 1 and 40 characters, treating a Table_Name consisting only of whitespace as a trimmed length of 0.
3. IF a submitted Table_Name matches, after trimming and case-insensitive comparison, the Table_Name of an existing Dining_Table in the same Tenant other than the Dining_Table being edited, THEN THE Table_Registry SHALL reject the submission, return the message `A table with this name already exists`, and leave every stored Dining_Table unchanged.
4. THE Table_Registry SHALL accept a Seat_Capacity that is a whole number between 1 and 30.
5. IF a submitted Seat_Capacity is not a whole number or falls outside 1 through 30, THEN THE Table_Registry SHALL reject the submission, return the message `Seat capacity must be between 1 and 30`, and leave every stored Dining_Table unchanged.
6. WHERE a Table_Area whose trimmed length is between 1 and 30 characters is supplied, THE Table_Registry SHALL store the trimmed Table_Area on the Dining_Table.
7. WHERE no Table_Area is supplied or the supplied Table_Area has a trimmed length of 0, THE Table_Registry SHALL store `Main` as the Table_Area of the Dining_Table.
8. WHEN the Owner_Account edits a Dining_Table with a Table_Name, Seat_Capacity, and Table_Area that satisfy criteria 2 through 7 and a Display_Order that is a whole number between 1 and 999, THE Table_Registry SHALL persist the updated Table_Name, Seat_Capacity, Table_Area, and Display_Order, retain the identifier of that Dining_Table, and retain every Table_Booking that references that Dining_Table.
9. WHEN the Owner_Account sets the Table_State of a Dining_Table to `inactive`, THE Table_Registry SHALL store Table_State `inactive` for that Dining_Table and retain every existing Table_Booking that references that Dining_Table with its Booking_Status unchanged.
10. WHERE the Table_State of a Dining_Table is `inactive`, THE Availability_Service SHALL exclude that Dining_Table from every Available_Table set.
11. IF the Owner_Account requests deletion of a Dining_Table that is referenced by a Table_Booking whose Booking_Slot start time is later than the current time and whose Booking_Status is a Blocking_Status, THEN THE Table_Registry SHALL reject the deletion, return the message `This table has upcoming bookings. Set the table to inactive instead`, and retain that Dining_Table with its Table_State and every referencing Table_Booking unchanged.
12. WHEN the Owner_Account requests deletion of a Dining_Table that no Table_Booking references, or of a Dining_Table referenced only by Table_Bookings whose Booking_Slot start time is at or before the current time or whose Booking_Status is a Releasing_Status, THE Table_Registry SHALL delete that Dining_Table, retain those Table_Bookings, and continue to display for each retained Table_Booking the Table_Name it was booked against.
13. WHERE the Table_State of a Dining_Table is `inactive`, WHILE a Table_Booking on that Dining_Table holds a Blocking_Status, THE Booking_Service SHALL retain that Table_Booking with its Booking_Status unchanged, permit every Booking_Status change defined in Requirement 9 on that Table_Booking, and honour that Table_Booking for its Occupancy_Window.
14. THE Table_Registry SHALL return, for every read of Dining_Tables, the Dining_Tables ordered by Table_Area ascending, then Display_Order ascending, then Table_Name ascending, comparing Table_Area and Table_Name case-insensitively.
15. THE Restaurant_Dashboard SHALL display the registered Dining_Tables in the Table_Layout_View grouped by Table_Area in the order defined in criterion 14, showing for each Dining_Table the Table_Name, the Seat_Capacity, and the Table_State as a text label.
16. IF a submission carries a Table_Name whose trimmed length is 0 or greater than 40 characters, or a Table_Area whose trimmed length is greater than 30 characters, THEN THE Table_Registry SHALL reject the submission, return an error message naming the offending field and its permitted length range, and leave every stored Dining_Table unchanged.
17. WHERE no Display_Order is supplied for a submitted Dining_Table, THE Table_Registry SHALL set the Display_Order of that Dining_Table to 1 greater than the highest Display_Order among the Dining_Tables of the same Tenant in the same Table_Area, and to 1 where that Table_Area holds no other Dining_Table.
18. IF the Owner_Account submits a new Dining_Table while the requesting Tenant already holds 200 Dining_Tables counted across both Table_States, THEN THE Table_Registry SHALL reject the submission, return an error message stating that the maximum of 200 tables per restaurant is reached, and create no Dining_Table.

### Requirement 4: Booking rules configuration

**User Story:** As a restaurant owner, I want to set my service hours, seating duration, and booking limits, so that the public form only offers slots I can actually serve.

#### Acceptance Criteria

1. THE Restaurant_Dashboard SHALL allow the Owner_Account to set, for each of the seven weekdays, an Open_Time and a Close_Time that are whole-minute times of day between 00:00 and 23:59 inclusive in the Tenant_Timezone and a Closed_Flag whose value is true or false.
2. IF a submitted Operating_Hours change carries, for any weekday whose Closed_Flag is false, a Close_Time earlier than or equal to the Open_Time of that weekday, an absent Open_Time, or an absent Close_Time, THEN THE Restaurant_Dashboard SHALL reject the entire submission, return a message naming that weekday and stating that an Open_Time and a later Close_Time are required for that weekday, and retain the previously stored Operating_Hours for all seven weekdays unchanged.
3. THE Service_Settings SHALL accept a Slot_Interval that is one of the values 15, 30, or 60 minutes, with a default of 30 minutes.
4. THE Service_Settings SHALL accept a Turn_Time that is a whole number of minutes between 30 and 240 inclusive, with a default of 90 minutes.
5. THE Service_Settings SHALL accept a Max_Party_Size that is a whole number between 1 and 30 inclusive, with a default of 12.
6. THE Service_Settings SHALL accept an Advance_Booking_Window that is a whole number of days between 1 and 365 inclusive, with a default of 60 days.
7. THE Service_Settings SHALL accept a Min_Lead_Time that is a whole number of minutes between 0 and 1440 inclusive, with a default of 30 minutes.
8. IF a submitted Service_Settings change carries a value that is not a whole number, that is not one of the enumerated values permitted for that field, or that falls outside the inclusive range stated for that field, THEN THE Restaurant_Dashboard SHALL reject the entire submission, return a message naming every offending field together with its permitted values or its permitted inclusive range, and retain the previously stored Service_Settings unchanged.
9. IF a Restaurant_Tenant holds no stored value for a Service_Settings field, THEN THE Availability_Service SHALL apply the default stated for that field in criteria 3 through 7.
10. WHEN the Owner_Account saves valid Service_Settings, THE Availability_Service SHALL apply the saved values to every subsequent availability computation for that Tenant.
11. IF an account whose resolved permission for restaurant configuration is not `operate` submits a change to Operating_Hours or to Service_Settings, THEN THE Restaurant_Dashboard SHALL reject the submission, return a message stating that the account is not authorised to change booking rules, and retain the stored Operating_Hours and the stored Service_Settings unchanged.
12. WHEN the Owner_Account saves valid Operating_Hours or valid Service_Settings, THE Booking_Service SHALL retain every existing Table_Booking unchanged, including every Table_Booking whose Booking_Slot falls outside the newly saved Operating_Hours.
13. WHERE the Closed_Flag of a weekday is true, THE Availability_Service SHALL return an empty Booking_Slot list for every date falling on that weekday and SHALL ignore any stored Open_Time and Close_Time for that weekday.

### Requirement 5: Slot and table availability computation

**User Story:** As a guest, I want to see which time slots and tables are free for my party, so that I can book without calling the restaurant.

#### Acceptance Criteria

1. WHEN the Availability_Service receives a `tenantId`, a booking date, and a Party_Size, THE Availability_Service SHALL return the Booking_Slots for that date and the Available_Tables for each returned Booking_Slot.
2. THE Availability_Service SHALL generate Booking_Slots starting at the Open_Time of the booking date weekday and stepping forward by Slot_Interval minutes.
3. THE Availability_Service SHALL generate as the last Booking_Slot of a date the latest generated start time that is at or before Close_Time minus Turn_Time, and SHALL generate no Booking_Slot and return an empty Booking_Slot list for a date whose Close_Time minus Turn_Time is earlier than the Open_Time of that date.
4. WHERE the Closed_Flag of the booking date weekday is true, THE Availability_Service SHALL return an empty Booking_Slot list and a closed indicator for that date.
5. THE Availability_Service SHALL treat a Dining_Table as unavailable for a candidate Booking_Slot when an existing Table_Booking on that Dining_Table holds a Blocking_Status and the half-open Occupancy_Window `[start, start + Turn_Time)` of that Table_Booking intersects the half-open Occupancy_Window of the candidate Booking_Slot, so that a candidate Booking_Slot whose start time equals the end of an existing Occupancy_Window is treated as available.
6. THE Availability_Service SHALL include in the Available_Table set of a Booking_Slot every Dining_Table whose Table_State is `active` and which is not unavailable for that Booking_Slot, regardless of its Seat_Capacity relative to the requested Party_Size.
7. WHERE the booking date equals the current date AND Min_Lead_Time is greater than 0, THE Availability_Service SHALL exclude every Booking_Slot whose start time is earlier than the current time plus Min_Lead_Time.
8. WHERE the booking date equals the current date AND Min_Lead_Time is 0, THE Availability_Service SHALL include every Booking_Slot whose start time is at or after the current time.
9. IF the booking date is later than the current date plus Advance_Booking_Window days, THEN THE Availability_Service SHALL return an empty Booking_Slot list and an out-of-window indicator.
10. IF the requested Party_Size is greater than the largest Seat_Capacity among the Tenant's `active` Dining_Tables AND at least one such Dining_Table exists AND the booking date is within Advance_Booking_Window days of the current date, THEN THE Availability_Service SHALL return the Booking_Slots for that date, a multiple-tables indicator, and the unchanged Available_Table set of every returned Booking_Slot, so that the Guest can combine Dining_Tables into a Table_Group.
11. IF the booking date is later than the current date plus Advance_Booking_Window days AND the requested Party_Size is greater than the largest Seat_Capacity among the Tenant's `active` Dining_Tables, THEN THE Availability_Service SHALL return the out-of-window indicator as the single returned indicator.
12. THE Availability_Service SHALL return, for each Booking_Slot, the count of Available_Tables, the summed Seat_Capacity of those Available_Tables, and the total count of `active` Dining_Tables of the Tenant.
13. WHEN two availability requests for the same Tenant, date, and Party_Size are issued with no intervening Table_Booking change, Dining_Table change, or Service_Settings change, THE Availability_Service SHALL return identical Booking_Slots and identical Available_Table sets.
14. THE Availability_Service SHALL evaluate the current time, the current date, and every Booking_Slot start time used in criteria 1 through 11 in the Tenant_Timezone of the Tenant identified by the requested `tenantId`.

### Requirement 6: Visual table booking form for guests

**User Story:** As a guest, I want to see a visual of the restaurant's tables with persons, date, time, and availability, so that I can choose where I sit.

#### Acceptance Criteria

1. WHERE the Business_Profession of the Tenant addressed by `/book/$tenantId` is `Restaurant and dining`, THE Public_Booking_Form SHALL display the fields Guest name, Phone, Email, Party_Size, Booking date, Booking_Slot, Table selection, and Special requests.
2. THE Public_Booking_Form SHALL offer Party_Size values from 1 through Max_Party_Size.
3. THE Public_Booking_Form SHALL set the Table selection default to `Any available table`.
4. WHEN the Guest changes the Party_Size or the booking date, THE Public_Booking_Form SHALL request fresh availability from the Availability_Service, render the returned Booking_Slots within 2000 milliseconds of that change, and discard every availability response whose requested Party_Size or requested booking date differs from the Party_Size and the booking date currently selected.
5. WHEN the Guest selects a Booking_Slot, THE Table_Layout_View SHALL render every `active` Dining_Table of the Tenant grouped by Table_Area, showing for each Dining_Table the Table_Name, the Seat_Capacity, and one Availability_State.
6. THE Table_Layout_View SHALL render Availability_State `Available` for each Available_Table of the selected Booking_Slot and Availability_State `Unavailable` for every other rendered Dining_Table.
7. WHEN the Guest activates a Dining_Table whose Availability_State is `Available`, THE Table_Layout_View SHALL add that Dining_Table to the Table_Group and set its Availability_State to `Selected`; and WHEN the Guest activates a Dining_Table whose Availability_State is `Selected`, THE Table_Layout_View SHALL remove that Dining_Table from the Table_Group and set its Availability_State to `Available`, so that the Table selection holds any number of Available_Tables and imposes no relationship between their summed Seat_Capacity and the Party_Size.
8. WHEN the Guest activates a Dining_Table whose Availability_State is `Unavailable`, THE Table_Layout_View SHALL retain the current Table selection and display the message `This table is already booked for the selected time`.
9. THE Table_Layout_View SHALL convey each Availability_State using a text label in addition to colour, and SHALL expose the Availability_State of each Dining_Table to assistive technology.
10. WHERE the Available_Table count of a Booking_Slot is exactly 0, THE Public_Booking_Form SHALL keep that Booking_Slot selectable and display the message `No table free at this time`.
11. IF the Guest submits the form while Party_Size, booking date, or Booking_Slot is empty, THEN THE Public_Booking_Form SHALL display a field-level validation message for each empty field and send no booking request.
12. WHEN the Availability_Service returns a multiple-tables indicator, THE Public_Booking_Form SHALL display the message `Your party needs more than one table. Select as many tables as you need` and SHALL continue to render the returned Booking_Slots and the Table_Layout_View.
13. WHEN the Guest changes the Party_Size or the booking date while any Dining_Table is selected, THE Public_Booking_Form SHALL set the Table selection to `Any available table` before rendering the fresh availability returned by the Availability_Service.
15. WHERE the Table selection holds one or more Dining_Tables, THE Public_Booking_Form SHALL display the count of selected Dining_Tables and their summed Seat_Capacity.
14. WHEN the Availability_Service returns a closed indicator for the selected booking date, THE Public_Booking_Form SHALL display the message `The restaurant is closed on this date. Please pick another date`, render no Booking_Slot, and render no Table_Layout_View.

### Requirement 7: Table booking creation

**User Story:** As a guest, I want my booking to hold the table I chose, so that the restaurant keeps that table free for me.

#### Acceptance Criteria

1. WHEN the Booking_Service receives a valid restaurant booking request, THE Booking_Service SHALL create one Table_Booking per Dining_Table of the assigned Table_Group, each holding the `tenantId`, Guest name, Guest phone, Guest email, Party_Size, booking date-time, Booking_Slot, its own assigned Dining_Table, the Turn_Time in force at creation time, Booking_Status `Pending`, and SHALL assign all of them one shared Booking_Token and one shared Booking_Group inside the single atomic transaction of criterion 2.
2. THE Booking_Service SHALL set the Booking_Token of a new Table_Booking to the largest Booking_Token already assigned for that Tenant on that calendar date plus 1, and SHALL assign that Booking_Token inside the single atomic transaction that performs the availability check of criterion 4 and persists the Table_Booking.
3. WHERE the booking request carries the Table selection `Any available table`, THE Booking_Service SHALL assign as the Table_Group the single Available_Table with the smallest Seat_Capacity that is greater than or equal to the Party_Size, resolving ties by the lowest Display_Order and then the lowest Table_Name in ascending order; and WHERE no single Available_Table seats the Party_Size, THE Booking_Service SHALL assign the Available_Tables in descending Seat_Capacity order, ties resolved the same way, until their summed Seat_Capacity is at or above the Party_Size or no Available_Table remains; and SHALL return the rejection defined in criterion 4 only where the Available_Table set for the requested Booking_Slot is empty.
4. IF the booking request names any Dining_Table that is not an Available_Table for the requested Booking_Slot at the point the atomic transaction of criterion 2 evaluates availability, THEN THE Booking_Service SHALL reject the request, return the message `That table was just booked. Please pick another table or time`, and create no Table_Booking.
5. THE Booking_Service SHALL NOT reject a booking request on the basis of Seat_Capacity: a Table_Group whose summed Seat_Capacity is less than, equal to, or greater than the requested Party_Size is accepted, and a reassignment onto a Dining_Table whose Seat_Capacity is below the Party_Size is accepted.
6. IF the requested Party_Size falls outside 1 through Max_Party_Size, THEN THE Booking_Service SHALL reject the request and return a message naming the permitted Party_Size range.
7. IF the requested Booking_Slot is absent from the Booking_Slots the Availability_Service returns for the requested date, THEN THE Booking_Service SHALL reject the request and return the message `That time is not available for booking`.
8. THE Booking_Service SHALL hold at most one Table_Booking in a Blocking_Status per Dining_Table per pair of overlapping Occupancy_Windows.
9. WHEN the Booking_Service creates a reservation, THE Booking_Service SHALL return the Booking_Group identifier, the Booking_Token, every assigned Table_Name, the Booking_Slot, and the Party_Size.
10. WHEN the Public_Booking_Form receives a successful booking response, THE Public_Booking_Form SHALL display every assigned Table_Name, the booking date, the Booking_Slot, the Party_Size, and the Booking_Token.
11. WHEN two booking requests whose Table_Groups share a Dining_Table with overlapping Occupancy_Windows are processed concurrently, THE Booking_Service SHALL create the Table_Bookings of exactly one of the two requests and return for the other request the rejection defined in criterion 4; and THE Booking_Service SHALL lock the Dining_Tables of a Table_Group in one ascending identifier order, so that two concurrent Table_Group requests cannot deadlock.
12. IF a booking request submitted through the Public_Booking_Form carries a Guest name whose trimmed length is 0 or greater than 100 characters, carries no Guest phone, or carries a Guest phone whose Normalised_Phone holds fewer than 7 or more than 15 digits, THEN THE Booking_Service SHALL reject the request, return a message naming the offending field and its permitted form, and create no Table_Booking.

### Requirement 8: Booking notifications

**User Story:** As a guest, I want a confirmation message with my table details, so that I know the reservation is recorded.

#### Acceptance Criteria

1. WHERE the WhatsApp alerts feature is available for the Tenant AND the WhatsApp connection state is connected, WHEN the Booking_Service creates a Table_Booking, THE Notification_Service SHALL queue a message addressed to the Guest phone of that Table_Booking containing the restaurant name, the booking date, the Booking_Slot, the Party_Size, every assigned Table_Name of the Booking_Group, and the Booking_Token.
2. IF the Notification_Service fails to queue a message for a created Table_Booking, THEN THE Booking_Service SHALL retain the created Table_Booking and record the failure in the server log.
3. WHERE the WhatsApp alerts feature is unavailable for the Tenant, THE Booking_Service SHALL create the Table_Booking and queue no message.
4. WHEN the Booking_Service creates a Table_Booking, THE Booking_Service SHALL return the booking response defined in Requirement 7 criterion 9 without waiting for the Notification_Service to queue or deliver the message defined in criterion 1.
5. THE Notification_Service SHALL queue the message defined in criterion 1 within 60 seconds of the creation of the Table_Booking.
6. IF a created Table_Booking carries no Guest phone, THEN THE Notification_Service SHALL queue no message for that Table_Booking and record the omission in the server log.

### Requirement 9: Owner-side booking records and management

**User Story:** As a restaurant owner, I want a record of every booking with the table, party size, and status, so that I can run the floor and fix bookings by hand.

#### Acceptance Criteria

1. THE Restaurant_Dashboard SHALL display in the Bookings List one entry per Booking_Group of the Tenant, not one per Table_Booking, showing the Guest name, the Guest phone, the Party_Size, the booking date, the Booking_Slot, every assigned Table_Name of that Booking_Group, the Booking_Status, and the Booking_Token; and SHALL count and paginate the Bookings List over Booking_Groups, so that no Booking_Group is split across a page boundary.
2. THE Restaurant_Dashboard SHALL filter the Bookings List by booking date range, by Booking_Status, by Table_Area, and by Dining_Table.
3. THE Restaurant_Dashboard SHALL search the Bookings List by Guest name and by Guest phone.
4. WHEN an account whose resolved permission for booking management is `operate` sets the Booking_Status of a Table_Booking to one of `Pending`, `Confirmed`, `Seated`, `Completed`, `Cancelled`, or `No Show`, THE Booking_Service SHALL persist the selected Booking_Status for every Table_Booking of that Table_Booking's Booking_Group, so that a reservation changes status as one unit.
5. WHEN the Booking_Status of a Table_Booking changes to a Releasing_Status, THE Availability_Service SHALL treat the Dining_Table of that Table_Booking as free for the Occupancy_Window of that Table_Booking.
6. WHEN the Owner_Account reassigns a Table_Booking to a different Dining_Table, THE Booking_Service SHALL apply the check in Requirement 7 criterion 4 to the target Dining_Table before persisting the reassignment, and SHALL reassign exactly that one Table_Booking rather than its whole Booking_Group.
7. WHEN the Owner_Account submits a walk-in booking from the Restaurant_Dashboard with a Guest name, a Party_Size, a booking date, a Booking_Slot, and a Dining_Table, THE Booking_Service SHALL create a Table_Booking using the same validation rules as Requirement 7 and set the Booking_Status to `Seated`.
8. THE Restaurant_Dashboard SHALL display for a selected date each Booking_Slot together with the count of occupied Dining_Tables and the count of Available_Tables for that Booking_Slot.
9. THE Restaurant_Dashboard SHALL display on the Overview the count of Table_Bookings for the current date in the Tenant_Timezone, the sum of Party_Size across those Table_Bookings, and the occupancy rate for that current date.
10. THE Restaurant_Dashboard SHALL compute the occupancy rate of a date, evaluated in the Tenant_Timezone, as the number of table-slot pairs held by Table_Bookings in a Blocking_Status divided by the product of the count of `active` Dining_Tables and the count of Booking_Slots for that date, expressed as a percentage rounded to the nearest whole number.
11. WHERE the count of Booking_Slots for a date is 0, THE Restaurant_Dashboard SHALL display the occupancy rate of that date as `0%`.
12. THE Restaurant_Dashboard SHALL sort the Bookings List by default by booking date descending, then by Booking_Slot start time ascending, then by Booking_Token ascending, and SHALL display 25 Booking_Groups per page.
13. IF an account whose resolved permission for booking management is not `operate` submits a Booking_Status change or a reassignment of a Table_Booking to a different Dining_Table, THEN THE Booking_Service SHALL reject the submission, return a message stating that the account is not authorised to change bookings, and retain the stored Booking_Status and the stored Dining_Table of that Table_Booking unchanged.

### Requirement 10: Guest records

**User Story:** As a restaurant owner, I want each guest's booking history in one place, so that I recognise regulars and repeat no-shows.

#### Acceptance Criteria

1. WHEN the Booking_Service creates a Table_Booking whose Guest phone has a Normalised_Phone equal to the Normalised_Phone of an existing Guest record of the same Tenant, THE Booking_Service SHALL link the Table_Booking to that Guest record.
2. WHEN the Booking_Service creates a Table_Booking whose Guest phone has a Normalised_Phone equal to the Normalised_Phone of no Guest record of the same Tenant, THE Booking_Service SHALL create a Guest record for that Tenant with a sequential guest number and link the Table_Booking to the created Guest record.
3. THE Restaurant_Dashboard SHALL display for each Guest record the Guest name, the Guest phone, the count of linked Table_Bookings, the most recent booking date, and the count of linked Table_Bookings whose Booking_Status is `No Show`.
4. WHERE a Table_Booking carries no Guest phone, THE Booking_Service SHALL create a Guest record identified by the Guest name for that Tenant.
5. THE Booking_Service SHALL derive the Normalised_Phone of a phone value by removing every space, hyphen, opening bracket, and closing bracket from that value, and SHALL compare two phone values by comparing their Normalised_Phone values.
6. WHEN the Booking_Service creates a Table_Booking whose Guest name differs from the Guest name of the Guest record matched by Normalised_Phone, THE Booking_Service SHALL store the submitted Guest name on that Table_Booking and retain the Guest name of that Guest record unchanged.

### Requirement 11: Tenant isolation and multi-location tables

**User Story:** As a restaurant owner, I want my tables and bookings visible only inside my workspace and split per branch, so that data stays correct across locations.

#### Acceptance Criteria

1. THE Table_Registry SHALL restrict every read and every write to Dining_Tables whose `tenantId` equals the `tenantId` of the requesting session.
2. THE Booking_Service SHALL restrict every read and every write to Table_Bookings whose `tenantId` equals the `tenantId` of the requesting session.
3. IF a request references a Dining_Table whose `tenantId` differs from the `tenantId` of the requesting session, THEN THE Table_Registry SHALL reject the request and return a not-found error.
4. WHERE the multi-location feature is available for the Tenant, THE Table_Registry SHALL associate each Dining_Table with exactly one Location of that Tenant.
5. WHERE the multi-location feature is unavailable for the Tenant, THE Table_Registry SHALL associate each Dining_Table with the Primary_Location of that Tenant.
6. WHERE the Public_Booking_Form has a selected Location, THE Availability_Service SHALL compute Available_Tables from the Dining_Tables associated with that selected Location.
7. WHERE the Public_Booking_Form has no selected Location, THE Availability_Service SHALL compute Available_Tables from the Dining_Tables associated with the Primary_Location of the Tenant.

### Requirement 12: Unchanged behaviour for existing categories

**User Story:** As a product owner, I want the existing five category workspaces to behave exactly as before, so that adding restaurants introduces no regression.

#### Acceptance Criteria

1. WHERE the Business_Profession of a Tenant differs from `Restaurant and dining`, THE Availability_Service SHALL compute the Booking_Slots for a given `tenantId`, date, and staff member from the stored working hours and the stored appointment duration of that staff member, and SHALL use no Operating_Hours, no Service_Settings, and no Dining_Table as an input to that computation.
2. WHERE the Business_Profession of a Tenant differs from `Restaurant and dining`, THE Booking_Service SHALL store an empty value for the Dining_Table reference and for the Party_Size of each created booking.
3. WHERE the Business_Profession of an authenticated account is `Fitness Gym etc`, `Beauty and wellness`, `Professional services like law, consultant, real estate, CA`, or `Education institutions`, WHEN that account opens `/dashboard`, THE Dashboard_Router SHALL navigate that account to `/dashboards/gym`, `/dashboards/beauty`, `/dashboards/professional`, or `/dashboards/education` respectively.
4. THE Feature_Access_Service SHALL resolve the feature availability and the permission of an account from the plan of the Tenant of that account and the role of that account, and SHALL use the Business_Profession of that account as an input to no feature resolution and no permission resolution.
5. WHERE the Business_Profession of an authenticated account is absent, is empty, or holds a value other than `Restaurant and dining`, `Fitness Gym etc`, `Beauty and wellness`, `Professional services like law, consultant, real estate, CA`, and `Education institutions`, WHEN that account opens `/dashboard`, THE Dashboard_Router SHALL navigate that account to `/dashboards/medical`.
