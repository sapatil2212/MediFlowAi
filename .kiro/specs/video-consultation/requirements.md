# Requirements Document

## Introduction

This feature adds a first-party video consultation capability to BookMyTime so that a doctor can hold a remote appointment with a patient directly inside the product. A doctor starts the consultation from the medical dashboard; the patient joins from a browser using a tokenized link that requires no login; the doctor admits the patient from a waiting room; the two parties then exchange audio and video for the duration of the appointment.

The capability is built entirely on infrastructure the Tenant already controls. The following are hard constraints on the whole feature and are restated as verifiable acceptance criteria in Requirement 11:

- **No third-party video vendor.** Twilio Video, Daily, Agora, 100ms, LiveKit, Jitsi (hosted or as an embedded service), Zoom, and any equivalent Video_Platform_Vendor are excluded. Signalling, room lifecycle, admission control, and media negotiation are implemented in this codebase.
- **No third-party STUN or TURN**, including public STUN endpoints such as Google's. NAT traversal uses a Self_Hosted_TURN_Service (coturn) deployed on infrastructure the operator controls, addressed through environment configuration so that local development can run without it.
- **WebRTC itself is in scope and permitted**, because it is a browser standard rather than a vendor service.

Architecture direction already agreed and treated here as given: native WebRTC 1:1 peer-to-peer media between exactly one Doctor_Participant and exactly one Patient_Participant; first-party signalling persisted in the application database and read by the browser through polled HTTP server functions during call setup only, with no WebSocket infrastructure assumed; short-lived HMAC TURN credentials minted server-side rather than static secrets shipped to the browser.

Scope boundaries: multi-party consultations (for example adding a specialist or an interpreter) and any SFU/MCU media server are out of scope for this release, though the data model must not preclude adding them later. Call recording is out of scope and is not enabled. The capability is offered only to Healthcare_Tenant workspaces, which introduces profession as a new gating dimension alongside the existing plan and role gating.

## Glossary

- **Tenant**: A logical workspace identified by a unique `tenantId`. All accounts that share a `tenantId` belong to the same Tenant.
- **Parent_Account**: The owner account of a Tenant, stored as a `User` row, which holds the `profession`, `subscriptionPlan`, `subscriptionStatus`, and `subscriptionExpiresAt` for the Tenant. Resolved with `role: "admin"`.
- **Sub_User**: A child account stored in the `SubUser` table with a role of `reception` or `doctor`.
- **Doctor_Account**: A Sub_User whose role is `doctor`, or a Parent_Account acting on behalf of a Doctor record.
- **Reception_Account**: A Sub_User whose role is `reception`.
- **Sub_Location**: A child account stored in the `Location` table, resolved with `role: "location"`.
- **Account**: Any Parent_Account, Sub_User, or Sub_Location.
- **Profession**: The business type of a Tenant, stored as `User.profession` on the Parent_Account.
- **Healthcare_Tenant**: A Tenant whose Profession is `Healthcare and medical`.
- **Subscription_Plan**: The plan tier assigned to a Tenant, with permitted values `Basic`, `Premium`, and `Enterprise` and their legacy aliases.
- **Plan_Gated_Feature**: A capability whose availability depends on the Subscription_Plan tier.
- **Video_Consultation_Feature**: The Plan_Gated_Feature that represents this capability in the Feature_Access_Service maps.
- **Feature_Access_Service**: The server-side component that resolves, for a given Account, which Plan_Gated_Features are available and at which Role_Permission level.
- **Role_Permission**: The level of interaction a role is granted for an available feature, with permitted values `operate`, `view_only`, and `none`.
- **Appointment**: A booking record in the `Appointment` table for a named patient with a Doctor, date, and time slot.
- **Clinical_Appointment_Type**: The existing `Appointment.appointmentType` value (for example `First Time`, `OPD`), which classifies the clinical nature of the visit.
- **Consultation_Mode**: The delivery channel of an Appointment, with permitted values `in_person` and `video`, stored separately from Clinical_Appointment_Type.
- **Video_Consultation**: An Appointment whose Consultation_Mode is `video`.
- **Video_Room**: The server-side record that represents one Video_Consultation session, linked one-to-one with an Appointment, and holding the Room_State, participant presence, and timing fields.
- **Room_State**: The lifecycle state of a Video_Room, with permitted values `scheduled`, `waiting`, `active`, `ended`, `expired`, and `cancelled`.
- **Doctor_Participant**: The authenticated Doctor_Account participant of a Video_Room.
- **Patient_Participant**: The unauthenticated browser participant of a Video_Room that presents a valid Join_Token.
- **Participant**: A Doctor_Participant or a Patient_Participant.
- **Waiting_Room**: The state in which a Patient_Participant has requested entry to a Video_Room and awaits an admission decision from the Doctor_Participant.
- **Join_Token**: The single-purpose, high-entropy secret that authorizes exactly one Patient_Participant to request entry to exactly one Video_Room.
- **Patient_Join_Link**: The public URL that carries a Join_Token and opens the patient-facing consultation page without login.
- **Join_Window**: The time interval, relative to the Appointment `dateTime`, during which a Join_Token is accepted.
- **Signalling_Service**: The first-party server-side component that stores and delivers Signal_Messages between the two Participants of a Video_Room.
- **Signal_Message**: One durable signalling payload exchanged during call setup, of kind `offer`, `answer`, `ice_candidate`, or `renegotiate`.
- **Peer_Connection**: The browser `RTCPeerConnection` established between the two Participants of a Video_Room.
- **Media_Stream**: The real-time audio and video data carried by a Peer_Connection.
- **ICE_Configuration**: The set of STUN and TURN server entries and credentials supplied to a Participant browser for NAT traversal.
- **Self_Hosted_TURN_Service**: The operator-controlled coturn deployment that provides STUN and TURN for NAT traversal, addressed through environment configuration.
- **Ephemeral_TURN_Credential**: A time-limited username and HMAC-derived password pair minted server-side for a single Participant.
- **Video_Platform_Vendor**: Any externally operated video, signalling, STUN, or TURN service not controlled by the operator (for example Twilio Video, Daily, Agora, 100ms, LiveKit, hosted Jitsi, Zoom, public STUN endpoints).
- **Consent_Record**: The stored acknowledgement that a Patient_Participant accepted the teleconsultation notice before entering a Video_Room.
- **Call_Audit_Record**: The persisted, non-media summary of a Video_Consultation, including participant join and leave times, connected duration, end reason, and Room_State transitions.
- **Notification_Service**: The existing appointment notification component that composes and sends WhatsApp messages for appointment events, plus the existing email sender.
- **Clinical_Documentation**: The `SoapNote` and `Prescription` records associated with an Appointment.
- **Medical_Dashboard**: The Profession-specific dashboard UI served for a Healthcare_Tenant.

## Requirements

### Requirement 1: Healthcare-only availability

**User Story:** As a product owner, I want video consultation offered only to healthcare tenants, so that clinical remote-care functionality does not appear in gyms, salons, or other non-medical workspaces.

#### Acceptance Criteria

1. WHERE the Tenant is a Healthcare_Tenant, THE Feature_Access_Service SHALL treat the Video_Consultation_Feature as eligible for the Tenant.
2. WHERE the Profession of the Parent_Account is a value other than `Healthcare and medical`, THE Feature_Access_Service SHALL resolve the Video_Consultation_Feature as unavailable for every Account in the Tenant.
3. WHEN the Feature_Access_Service resolves feature access for a Sub_User or a Sub_Location, THE Feature_Access_Service SHALL require both that the Account's Tenant is a Healthcare_Tenant and that the Profession of that Account's Parent_Account is `Healthcare and medical`.
4. WHERE the Video_Consultation_Feature is unavailable for a Tenant, THE Medical_Dashboard SHALL omit every video consultation control from the rendered interface.
5. WHERE the Video_Consultation_Feature is available for a Tenant AND the Role_Permission of the signed-in Account is `operate`, THE Medical_Dashboard SHALL render the video consultation controls.
6. IF an Account whose Tenant is not a Healthcare_Tenant sends a request to any video consultation server function, THEN THE Feature_Access_Service SHALL reject the request and return an authorization error.
7. THE Feature_Access_Service SHALL evaluate Profession eligibility on the server for every video consultation server function, independently of the state of the rendered interface.

### Requirement 2: Plan and role entitlement

**User Story:** As a tenant owner, I want video consultation governed by my subscription plan and by staff roles, so that the capability is sold with the right tier and operated only by clinical staff.

#### Acceptance Criteria

1. THE Feature_Access_Service SHALL expose the Video_Consultation_Feature as a Plan_Gated_Feature with an entry in the plan entitlement map for every Subscription_Plan tier and an entry in the role permission map for every Account role.
2. WHERE the Subscription_Plan of the Parent_Account includes the Video_Consultation_Feature AND the Tenant is a Healthcare_Tenant AND the subscription is active, THE Feature_Access_Service SHALL resolve the Video_Consultation_Feature as available for the Tenant.
3. THE Feature_Access_Service SHALL resolve the Role_Permission for the Video_Consultation_Feature as `operate` for a Doctor_Account and for a Parent_Account.
4. THE Feature_Access_Service SHALL resolve the Role_Permission for the Video_Consultation_Feature as `none` for a Reception_Account and for a Sub_Location.
5. IF the subscription of the Parent_Account is inactive or expired, THEN THE Feature_Access_Service SHALL resolve the Video_Consultation_Feature as unavailable for every Account in the Tenant.
6. IF an Account whose Role_Permission for the Video_Consultation_Feature is `view_only` sends a state-changing video consultation request, THEN THE Feature_Access_Service SHALL reject the request and return an authorization error.
7. IF an Account whose Role_Permission for the Video_Consultation_Feature is `none` sends any video consultation request, including a request that reads data without changing state, THEN THE Feature_Access_Service SHALL reject the request and return an authorization error.
8. THE Feature_Access_Service SHALL keep the existing resolution behaviour of all other Plan_Gated_Features unchanged when the Video_Consultation_Feature is added.

### Requirement 3: Scheduling an appointment as a video consultation

**User Story:** As reception staff or a patient booking online, I want to choose video as the delivery mode of an appointment, so that the consultation is set up remotely from the moment it is booked.

#### Acceptance Criteria

1. THE Appointment SHALL carry a Consultation_Mode value that is independent of its Clinical_Appointment_Type.
2. WHEN an Appointment is created without an explicit Consultation_Mode, THE Appointment SHALL be assigned the Consultation_Mode `in_person`.
3. WHEN an Appointment is created with the Consultation_Mode `video` for a Healthcare_Tenant whose Video_Consultation_Feature is available, THE Video_Consultation_Feature SHALL create exactly one Video_Room linked to that Appointment.
4. IF an Appointment create or update request is received with the Consultation_Mode `video` while the Video_Consultation_Feature is unavailable for the Tenant, THEN THE Video_Consultation_Feature SHALL reject that request at submission time and return an error that names the unavailable capability.
5. IF an Appointment is submitted with a Consultation_Mode value outside `in_person` and `video`, THEN THE Video_Consultation_Feature SHALL reject the request and return a validation error.
6. WHEN the Consultation_Mode of an existing Appointment is changed from `in_person` to `video`, THE Video_Consultation_Feature SHALL create a Video_Room for that Appointment if no Video_Room exists for it.
7. WHEN the Consultation_Mode of an existing Appointment is changed from `video` to `in_person`, THE Video_Consultation_Feature SHALL set the Room_State of the linked Video_Room to `cancelled` and revoke its Join_Token.
8. WHEN an Appointment with the Consultation_Mode `video` is cancelled, THE Video_Consultation_Feature SHALL set the Room_State of the linked Video_Room to `cancelled` and revoke its Join_Token.
9. THE Video_Consultation_Feature SHALL preserve the existing Clinical_Appointment_Type value of an Appointment when the Consultation_Mode of that Appointment is set or changed.

### Requirement 4: Video room lifecycle

**User Story:** As a doctor, I want each video appointment to have a clearly tracked session state, so that I know whether a consultation is upcoming, waiting, live, or finished.

#### Acceptance Criteria

1. WHEN a Video_Room is created, THE Video_Consultation_Feature SHALL set the Room_State to `scheduled`.
2. THE Video_Consultation_Feature SHALL maintain exactly one Video_Room per Appointment.
3. WHEN a Patient_Participant presents a valid Join_Token to a Video_Room whose Room_State is `scheduled`, THE Video_Consultation_Feature SHALL set the Room_State to `waiting`.
4. WHEN the Doctor_Participant admits a Patient_Participant from the Waiting_Room, THE Video_Consultation_Feature SHALL set the Room_State to `active`.
5. WHEN a Participant ends the session for a Video_Room whose Room_State is `active`, THE Video_Consultation_Feature SHALL set the Room_State to `ended` and record the end reason in the Call_Audit_Record.
6. WHEN the current time passes the end of the Join_Window of a Video_Room whose Room_State is `scheduled` or `waiting`, THE Video_Consultation_Feature SHALL set the Room_State to `expired`.
7. IF a state transition is requested that is not permitted from the current Room_State, THEN THE Video_Consultation_Feature SHALL reject the request, return an error, and leave the Room_State unchanged.
8. THE Video_Consultation_Feature SHALL treat `ended`, `expired`, and `cancelled` as terminal Room_States and SHALL reject every further transition request for a Video_Room in a terminal Room_State.
9. THE Video_Room SHALL store the `tenantId`, `appointmentId`, and `doctorId` of the Appointment it is linked to.
10. THE Video_Room SHALL represent participant presence as a set of Participant records with a role field, so that a future release can associate more than two Participants with one Video_Room.

### Requirement 5: Doctor-controlled start and waiting room

**User Story:** As a doctor, I want to see who is waiting and admit the patient myself, so that no one enters my consultation before I am ready.

#### Acceptance Criteria

1. WHEN a Doctor_Account with the Role_Permission `operate` opens a Video_Room for an Appointment assigned to that Doctor_Account, THE Video_Consultation_Feature SHALL present the Waiting_Room status and the list of Patient_Participants awaiting admission.
2. WHILE the Room_State is `waiting`, THE Video_Consultation_Feature SHALL withhold the ICE_Configuration and all Signal_Messages from the Patient_Participant until an admission decision is recorded.
3. WHEN the Doctor_Participant admits a Patient_Participant, THE Video_Consultation_Feature SHALL record the admission, permit Signal_Message exchange between the two Participants, and issue the ICE_Configuration to both Participants.
4. WHEN the Doctor_Participant declines a Patient_Participant, THE Video_Consultation_Feature SHALL record the decline and return a declined status to the Patient_Participant on the next poll.
5. WHILE a Patient_Participant is in the Waiting_Room, THE Video_Consultation_Feature SHALL display the current waiting status to that Patient_Participant.
6. IF an Account other than the Doctor_Account assigned to the Appointment or the Parent_Account requests an admission decision for a Video_Room, THEN THE Video_Consultation_Feature SHALL reject the request and return an authorization error.
7. WHEN the Doctor_Participant removes an admitted Patient_Participant from an `active` Video_Room, THE Video_Consultation_Feature SHALL end that Patient_Participant's Peer_Connection and record the removal in the Call_Audit_Record.
8. THE Video_Consultation_Feature SHALL admit at most one Patient_Participant to an `active` Video_Room at a time.

### Requirement 6: Patient join without login

**User Story:** As a patient, I want to join my video appointment by opening a link, so that I do not need an account or a password to see my doctor.

#### Acceptance Criteria

1. WHEN a Video_Room is created, THE Video_Consultation_Feature SHALL generate a Join_Token with at least 128 bits of cryptographic entropy.
2. THE Video_Consultation_Feature SHALL bind each Join_Token to exactly one Video_Room and to the Patient_Participant role only.
3. WHEN a browser opens a Patient_Join_Link carrying a valid Join_Token within the Join_Window, THE Video_Consultation_Feature SHALL present the patient consultation page without requiring authentication.
4. THE Video_Consultation_Feature SHALL accept a Join_Token from 30 minutes before the Appointment `dateTime` until 120 minutes after the Appointment `dateTime`, with both bounds configurable through environment configuration.
5. IF a Join_Token is presented outside its Join_Window, THEN THE Video_Consultation_Feature SHALL reject the request and return an expired-link status.
6. IF an unknown, malformed, or revoked Join_Token is presented, THEN THE Video_Consultation_Feature SHALL reject the request and return an invalid-link status that discloses no Appointment, Patient, or Tenant detail.
7. THE Video_Consultation_Feature SHALL persist a Join_Token as a one-way hash and SHALL return the plain Join_Token value only in the Patient_Join_Link at the moment it is generated.
8. WHEN a Doctor_Account with the Role_Permission `operate` requests regeneration of the Join_Token for a Video_Room, THE Video_Consultation_Feature SHALL revoke the previous Join_Token and issue a new Join_Token with a new Patient_Join_Link.
9. WHEN a Video_Room reaches a terminal Room_State, THE Video_Consultation_Feature SHALL revoke the Join_Token of that Video_Room.
10. THE Video_Consultation_Feature SHALL restrict the authority of a Join_Token to the Video_Room it is bound to and SHALL reject its use for any other Video_Room, Appointment, or Tenant resource.
11. THE Video_Consultation_Feature SHALL disclose to a Patient_Participant only the clinic name, the Doctor name, the Appointment date and time, and the session status.
12. IF more than 10 join attempts using invalid Join_Tokens arrive from the same client within 60 seconds, THEN THE Video_Consultation_Feature SHALL reject further attempts from that client and return a rate-limited status.

### Requirement 7: First-party signalling

**User Story:** As an engineer, I want signalling handled by our own server functions and database, so that call setup works without WebSocket infrastructure and without any external signalling service.

#### Acceptance Criteria

1. THE Signalling_Service SHALL persist every Signal_Message in the application database with the Video_Room identifier, sender Participant role, message kind, payload, and creation timestamp.
2. THE Signalling_Service SHALL expose Signal_Message publication and retrieval as HTTP server functions that a Participant browser polls.
3. WHEN a Participant polls for Signal_Messages, THE Signalling_Service SHALL return only Signal_Messages for that Participant's Video_Room that were created after the sequence position supplied by that Participant.
4. THE Signalling_Service SHALL return Signal_Messages for a Video_Room in the order in which they were persisted.
5. THE Signalling_Service SHALL scope every Signal_Message query to the `tenantId` of the Video_Room and SHALL reject a request whose caller resolves to a different `tenantId`.
6. IF a Participant publishes a Signal_Message to a Video_Room that the Participant is not a Participant of, THEN THE Signalling_Service SHALL reject the request and return an authorization error.
7. WHILE the Room_State is `waiting` or `active`, THE Signalling_Service SHALL accept polling requests at an interval of at most 2 seconds per Participant.
8. WHEN the Room_State becomes `active` AND both Participants report a connected Peer_Connection state, THE Signalling_Service SHALL instruct the Participant browsers to stop polling for Signal_Messages.
9. WHILE either Participant reports a Peer_Connection state other than connected AND the Room_State is `waiting` or `active`, THE Signalling_Service SHALL continue to accept polling requests from both Participants regardless of the elapsed time.
10. WHEN a Video_Room reaches a terminal Room_State, THE Signalling_Service SHALL delete the Signal_Messages of that Video_Room.
11. IF a Signal_Message payload larger than 64 kilobytes is submitted, THEN THE Signalling_Service SHALL return a validation error and persist no Signal_Message for that submission.

### Requirement 8: NAT traversal with self-hosted TURN

**User Story:** As an operator, I want NAT traversal served by our own coturn deployment with short-lived credentials, so that connections succeed on restrictive networks without trusting an external service or leaking a static secret.

#### Acceptance Criteria

1. WHEN a Participant is authorized to connect to a Video_Room, THE Video_Consultation_Feature SHALL issue an ICE_Configuration containing only the STUN and TURN endpoints of the Self_Hosted_TURN_Service.
2. THE Video_Consultation_Feature SHALL derive each Ephemeral_TURN_Credential server-side using an HMAC of the credential username and the shared secret of the Self_Hosted_TURN_Service.
3. THE Video_Consultation_Feature SHALL set the lifetime of each Ephemeral_TURN_Credential to at most 3600 seconds.
4. THE Video_Consultation_Feature SHALL keep the shared secret of the Self_Hosted_TURN_Service on the server and SHALL include only the derived username and password in the ICE_Configuration returned to a browser.
5. THE Video_Consultation_Feature SHALL read the Self_Hosted_TURN_Service endpoints, realm, and shared secret from environment configuration.
6. WHERE the Self_Hosted_TURN_Service is not configured, THE Video_Consultation_Feature SHALL return an ICE_Configuration with an empty server list and SHALL allow a Peer_Connection to proceed using host and server-reflexive candidates alone.
7. WHERE the Self_Hosted_TURN_Service is not configured, THE Video_Consultation_Feature SHALL display a notice to the Doctor_Participant stating that connections across restrictive networks may fail.
8. IF the issuance of an Ephemeral_TURN_Credential fails, THEN THE Video_Consultation_Feature SHALL return an error to the requesting Participant and record the failure in the Call_Audit_Record.
9. WHEN an Ephemeral_TURN_Credential expires while the Room_State is `active`, THE Video_Consultation_Feature SHALL issue a replacement Ephemeral_TURN_Credential on request from a Participant.

### Requirement 9: Peer-to-peer media session and in-call controls

**User Story:** As a doctor and a patient, I want reliable audio and video with basic controls, so that we can hold a usable consultation.

#### Acceptance Criteria

1. WHEN both Participants of an `active` Video_Room have completed Signal_Message exchange, THE Video_Consultation_Feature SHALL establish one Peer_Connection that carries audio and video directly between the two Participant browsers.
2. THE Video_Consultation_Feature SHALL display the local Media_Stream preview and the remote Media_Stream to each Participant.
3. WHEN a Participant toggles the microphone control, THE Video_Consultation_Feature SHALL enable or disable the outbound audio track of that Participant and SHALL show the resulting microphone state to both Participants.
4. WHEN a Participant toggles the camera control, THE Video_Consultation_Feature SHALL enable or disable the outbound video track of that Participant and SHALL show the resulting camera state to both Participants.
5. WHERE more than one microphone, camera, or speaker device is available, THE Video_Consultation_Feature SHALL allow the Participant to select the device used for that role and SHALL apply the selection to the Peer_Connection without ending the session.
6. WHEN a Participant activates the end-call control, THE Video_Consultation_Feature SHALL close the Peer_Connection, release the local camera and microphone, and report the session end to the other Participant.
7. THE Video_Consultation_Feature SHALL support exactly one Doctor_Participant and one Patient_Participant per Peer_Connection in this release.

### Requirement 10: Connection quality and recovery

**User Story:** As a patient on a weak connection, I want the call to tell me what is happening and try to recover, so that a brief network drop does not force me to rebook.

#### Acceptance Criteria

1. WHILE the Room_State is `active`, THE Video_Consultation_Feature SHALL sample Peer_Connection statistics at an interval of at most 5 seconds and SHALL display a connection-quality indicator with the levels `good`, `fair`, and `poor` to each Participant.
2. WHEN the Peer_Connection state becomes `disconnected`, THE Video_Consultation_Feature SHALL display a reconnecting status to both Participants and SHALL attempt ICE restart.
3. WHEN an ICE restart succeeds, THE Video_Consultation_Feature SHALL restore the Media_Stream display and clear the reconnecting status while keeping the Room_State `active`.
4. WHILE the Peer_Connection state is `disconnected` AND the Room_State is `active`, THE Video_Consultation_Feature SHALL repeat ICE restart attempts and SHALL keep the reconnecting status displayed to both Participants.
5. IF the Peer_Connection remains disconnected for more than 60 seconds in total, THEN THE Video_Consultation_Feature SHALL set the Room_State to `ended` and record the end reason `connection_lost` in the Call_Audit_Record, irrespective of the number of ICE restart attempts made during that interval.
6. WHEN a Participant reloads the consultation page while the Room_State is `active` and the Join_Window is open, THE Video_Consultation_Feature SHALL allow that Participant to rejoin the same Video_Room.
7. IF a Peer_Connection cannot be established within 45 seconds of admission, THEN THE Video_Consultation_Feature SHALL report a connection-failure status to both Participants and SHALL record the failure in the Call_Audit_Record.

### Requirement 11: First-party infrastructure only

**User Story:** As a tenant owner handling patient data, I want the media path and every supporting service under our own control, so that no external provider can observe a consultation.

#### Acceptance Criteria

1. THE Video_Consultation_Feature SHALL route Media_Stream data only between the Participant browsers, relayed when necessary through the Self_Hosted_TURN_Service alone.
2. THE Video_Consultation_Feature SHALL implement signalling, room lifecycle, admission control, and token issuance within this codebase using the application database and its own server functions.
3. THE Video_Consultation_Feature SHALL populate ICE_Configuration server entries exclusively from environment configuration that identifies the Self_Hosted_TURN_Service.
4. THE Video_Consultation_Feature SHALL depend on no Video_Platform_Vendor package, script, endpoint, or credential at build time or at run time.
5. THE Video_Consultation_Feature SHALL use only browser-native WebRTC interfaces for media capture, negotiation, and transport.
6. WHERE a Peer_Connection requires relaying, THE Video_Consultation_Feature SHALL relay through the Self_Hosted_TURN_Service configured for the deployment.
7. IF a Peer_Connection requires relaying AND the configured Self_Hosted_TURN_Service is unreachable, THEN THE Video_Consultation_Feature SHALL report a connection-failure status to both Participants and SHALL relay through no other service.

### Requirement 12: Consent and privacy posture

**User Story:** As a patient, I want to be told how the consultation works before I join, so that I can consent to a remote clinical session.

#### Acceptance Criteria

1. WHEN a Patient_Participant opens a Patient_Join_Link with a valid Join_Token, THE Video_Consultation_Feature SHALL present a teleconsultation notice and SHALL require an explicit acknowledgement before requesting camera or microphone access.
2. WHEN a Patient_Participant acknowledges the teleconsultation notice, THE Video_Consultation_Feature SHALL store a Consent_Record containing the Video_Room identifier, the acknowledgement timestamp, and the notice version.
3. IF a Patient_Participant has no Consent_Record for a Video_Room, THEN THE Video_Consultation_Feature SHALL withhold entry to the Waiting_Room for that Video_Room.
4. WHERE a Consent_Record exists for a Patient_Participant and the presented Join_Token is valid, THE Video_Consultation_Feature SHALL admit that Patient_Participant to the Waiting_Room without further verification.
5. WHEN the Room_State becomes `ended` while a Peer_Connection remains open, THE Video_Consultation_Feature SHALL close that Peer_Connection and SHALL discard Media_Stream data once the Peer_Connection is closed.
6. THE Video_Consultation_Feature SHALL retain only Call_Audit_Record and Consent_Record data after a Video_Consultation.
7. THE Video_Consultation_Feature SHALL present the recording state of a Video_Room as `not recorded` to both Participants.
8. THE Video_Consultation_Feature SHALL serve the patient consultation page over HTTPS in every deployment other than `localhost`.
9. THE Video_Consultation_Feature SHALL scope every Video_Room, Signal_Message, Join_Token, Consent_Record, and Call_Audit_Record query to the `tenantId` of the requesting Account.

### Requirement 13: Notification of the join link

**User Story:** As a patient, I want to receive my consultation link ahead of the appointment, so that I can join on time from my phone or computer.

#### Acceptance Criteria

1. WHEN a Video_Room is created for an Appointment, THE Notification_Service SHALL send a message containing the Patient_Join_Link, the clinic name, the Doctor name, and the Appointment date and time to the patient contact recorded on the Appointment.
2. WHEN a Join_Token is regenerated for a Video_Room, THE Notification_Service SHALL send a message containing the new Patient_Join_Link to the patient contact recorded on the Appointment.
3. WHERE an Appointment has the Consultation_Mode `video`, THE Notification_Service SHALL include the Patient_Join_Link in each appointment reminder message sent for that Appointment.
4. IF the WhatsApp session of the Tenant is not connected, THEN THE Notification_Service SHALL skip the WhatsApp message, record the skipped delivery, and complete the calling operation successfully.
5. WHERE an email address is recorded on the Appointment, THE Notification_Service SHALL send the Patient_Join_Link by email in addition to the WhatsApp message.
6. IF the delivery of a Patient_Join_Link message fails, THEN THE Notification_Service SHALL record the failure and complete the calling operation successfully.
7. THE Notification_Service SHALL compose every video consultation message through the existing appointment message builder so that clinic branding and formatting stay consistent.

### Requirement 14: Clinical documentation during and after the consultation

**User Story:** As a doctor, I want to write notes and prescriptions for a video consultation the same way I do in person, so that the remote visit produces a complete clinical record.

#### Acceptance Criteria

1. WHILE the Room_State is `active`, THE Video_Consultation_Feature SHALL allow the Doctor_Participant to create or edit the Clinical_Documentation of the linked Appointment without ending the session.
2. WHEN Clinical_Documentation is saved during an `active` Video_Room, THE Video_Consultation_Feature SHALL associate that Clinical_Documentation with the `appointmentId` and `patientId` of the linked Appointment.
3. IF the association of saved Clinical_Documentation with the linked Appointment fails, THEN THE Video_Consultation_Feature SHALL roll back the save operation, persist no Clinical_Documentation, and return an error to the Doctor_Participant.
4. WHEN the Room_State becomes `ended`, THE Video_Consultation_Feature SHALL present the Clinical_Documentation entry point for the linked Appointment to the Doctor_Account immediately upon that transition.
5. THE Video_Consultation_Feature SHALL apply the same Clinical_Documentation validation and authorization rules to a Video_Consultation as to an Appointment whose Consultation_Mode is `in_person`.
6. WHERE Clinical_Documentation exists for an Appointment whose Consultation_Mode is `video`, THE Medical_Dashboard SHALL indicate the Consultation_Mode on that Appointment record.

### Requirement 15: Call records, no-shows, and abandoned calls

**User Story:** As a clinic owner, I want a record of what happened in each video appointment, so that I can bill correctly and follow up on patients who never joined.

#### Acceptance Criteria

1. WHEN a Participant joins or leaves a Video_Room, THE Video_Consultation_Feature SHALL append the Participant role, the event kind, and the event timestamp to the Call_Audit_Record.
2. WHEN the Room_State becomes `ended`, THE Video_Consultation_Feature SHALL store the total connected duration in seconds and the end reason in the Call_Audit_Record.
3. WHEN a Video_Room reaches the Room_State `expired` and no Patient_Participant was admitted, THE Video_Consultation_Feature SHALL record the outcome `patient_no_show` in the Call_Audit_Record.
4. WHEN a Video_Room reaches the Room_State `expired` while a Patient_Participant waited without an admission decision, THE Video_Consultation_Feature SHALL record the outcome `doctor_no_show` in the Call_Audit_Record.
5. WHEN a Video_Room reaches the Room_State `ended` with a connected duration of 0 seconds AND no expiration-based outcome has been recorded for that Video_Room, THE Video_Consultation_Feature SHALL record the outcome `abandoned` in the Call_Audit_Record.
6. WHERE an expiration-based outcome of `patient_no_show` or `doctor_no_show` has been recorded for a Video_Room, THE Video_Consultation_Feature SHALL retain that outcome as the final outcome of the Video_Room.
7. WHEN a Doctor_Account with the Role_Permission `operate` requests the Call_Audit_Record of an Appointment in the Tenant, THE Video_Consultation_Feature SHALL return the join and leave events, connected duration, end reason, and outcome for that Appointment.
8. THE Call_Audit_Record SHALL contain no Media_Stream content and no Signal_Message payload.
9. WHEN a Video_Consultation ends with a connected duration greater than 0 seconds, THE Video_Consultation_Feature SHALL make the completed status of the linked Appointment available to the existing appointment status workflow.

### Requirement 16: Graceful degradation and error reporting

**User Story:** As a patient with a blocked camera or an unsupported browser, I want a clear explanation and a fallback, so that I know what to do instead of staring at a blank screen.

#### Acceptance Criteria

1. IF a Participant browser denies camera or microphone permission, THEN THE Video_Consultation_Feature SHALL display the denied device, the steps to grant permission, and a retry control.
2. WHERE only a microphone is available to a Participant, THE Video_Consultation_Feature SHALL establish an audio-only Peer_Connection and SHALL show the audio-only state to both Participants.
3. IF the Participant browser provides no WebRTC support, THEN THE Video_Consultation_Feature SHALL display an unsupported-browser message listing the supported browsers.
4. IF no camera and no microphone device is present on a Participant device, THEN THE Video_Consultation_Feature SHALL display a no-device message and SHALL leave the Room_State unchanged.
5. WHEN a video consultation server function rejects a request, THE Video_Consultation_Feature SHALL surface a message that states the reason and the next action available to the Participant.
6. IF a video consultation server function fails unexpectedly, THEN THE Video_Consultation_Feature SHALL return an error, leave the Room_State unchanged, and keep the linked Appointment record intact.
7. WHILE a Peer_Connection is established AND a video consultation server function is unavailable, THE Video_Consultation_Feature SHALL keep the Peer_Connection open so that the Participants continue to exchange audio and video.
8. THE Video_Consultation_Feature SHALL run in a local development environment with no Self_Hosted_TURN_Service configured and SHALL establish a Peer_Connection between two browsers on the same network.
