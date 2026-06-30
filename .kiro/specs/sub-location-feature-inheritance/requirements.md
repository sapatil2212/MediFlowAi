# Requirements Document

## Introduction

This feature ensures that child accounts within a tenant — sub-users (reception, doctor) and sub-locations — can access and use the same plan-gated features as their parent workspace. Today, the parent's `subscriptionPlan` is already inherited by child accounts through session resolution, but many features (for example, WhatsApp alerts) remain hidden or blocked for child accounts purely because of a role check, even when the inherited plan includes the feature.

The objective is to cleanly separate two distinct concepts:

1. **Feature availability** — determined by the parent subscription plan and inherited by every child account.
2. **Action authorization** — determined by the child account's role, which governs whether the account may operate a feature, or only view it.

The first concrete case is WhatsApp alerts, but the rules defined here apply generically to every plan-gated feature (for example, multi-user dashboards, analytics, multi-location management) so that future plan-gated features inherit consistently without role-based suppression.

## Glossary

- **Tenant**: A logical workspace identified by a unique `tenantId`. All accounts that share a `tenantId` belong to the same Tenant.
- **Parent_Account**: The owner account of a Tenant, stored as a `User` row, which holds the `subscriptionPlan`, `subscriptionStatus`, and `subscriptionExpiresAt` for the Tenant. Resolved with `role: "admin"`.
- **Child_Account**: Any account that belongs to a Tenant but is not the Parent_Account. Child_Account types are Sub_User and Sub_Location.
- **Sub_User**: A Child_Account stored in the `SubUser` table with a role of `reception` or `doctor`.
- **Sub_Location**: A Child_Account stored in the `Location` table, resolved with `role: "location"`.
- **Account**: Any Parent_Account or Child_Account.
- **Subscription_Plan**: The plan tier assigned to a Tenant. Permitted values are `Basic`, `Premium`, and `Enterprise`, with legacy aliases `Solo` (equivalent to `Basic`), `Clinic` (equivalent to `Premium`), and `Hospital`/`Custom` (equivalent to `Enterprise`).
- **Subscription_Status**: The activation state of the Tenant subscription (for example `active`, `inactive`, `expired`).
- **Plan_Gated_Feature**: A capability whose availability depends on the Subscription_Plan tier (for example WhatsApp alerts, analytics, multi-user dashboards, multi-location management).
- **Feature_Entitlement**: The set of Plan_Gated_Features that a given Subscription_Plan permits.
- **Effective_Plan**: The Subscription_Plan that applies to a Child_Account, which is always the Subscription_Plan of the Child_Account's Parent_Account.
- **Role_Permission**: The level of interaction a role is granted for an available feature. Permitted values are `operate` (view and act) and `view_only` (view without acting).
- **Feature_Access_Service**: The server-side component that resolves, for a given Account, which Plan_Gated_Features are available and at which Role_Permission level.
- **Dashboard**: The business dashboard UI (medical, beauty, gym, education, professional) that renders navigation tabs and settings sub-tabs based on resolved feature access.
- **Active_Account**: An Account whose `isActive` flag is true (Parent_Accounts are always considered active while their subscription is active).

## Requirements

### Requirement 1: Plan feature inheritance for child accounts

**User Story:** As a tenant owner, I want my sub-users and sub-locations to inherit my subscription plan's features, so that staff and branches can use everything my plan includes without separate upgrades.

#### Acceptance Criteria

1. THE Feature_Access_Service SHALL set the Effective_Plan of each Child_Account equal to the Subscription_Plan of that Child_Account's Parent_Account.
2. WHEN the Feature_Access_Service resolves available features for a Child_Account, THE Feature_Access_Service SHALL return the Feature_Entitlement of the Effective_Plan.
3. THE Feature_Access_Service SHALL resolve the same Feature_Entitlement for a Child_Account as for its Parent_Account when the Subscription_Status is active.
4. WHERE a Subscription_Plan is specified using a legacy alias, THE Feature_Access_Service SHALL resolve the Feature_Entitlement using the canonical tier (`Solo` as `Basic`, `Clinic` as `Premium`, `Hospital` and `Custom` as `Enterprise`).

### Requirement 2: WhatsApp alerts availability for child accounts

**User Story:** As a sub-user or sub-location of a Premium-or-higher tenant, I want access to WhatsApp alerts, so that I can use the messaging capability my parent workspace pays for.

#### Acceptance Criteria

1. WHERE the Effective_Plan includes WhatsApp alerts in its Feature_Entitlement, THE Feature_Access_Service SHALL mark WhatsApp alerts as available for the Child_Account.
2. WHERE the Effective_Plan includes WhatsApp alerts in its Feature_Entitlement, THE Dashboard SHALL display the WhatsApp navigation tab for a Sub_Location.
3. WHERE the Effective_Plan includes WhatsApp alerts in its Feature_Entitlement AND the Role_Permission for WhatsApp alerts is `operate`, THE Dashboard SHALL display the WhatsApp navigation tab for a Sub_User.
4. WHERE the Effective_Plan excludes WhatsApp alerts from its Feature_Entitlement, THE Dashboard SHALL hide the WhatsApp navigation tab for every Account in the Tenant.

### Requirement 3: Separation of feature availability from role authorization

**User Story:** As a tenant owner, I want feature visibility to depend on my plan while specific actions depend on each role, so that staff see the features my plan includes but only act within their responsibilities.

#### Acceptance Criteria

1. THE Feature_Access_Service SHALL determine whether a Plan_Gated_Feature is available using only the Effective_Plan and Subscription_Status.
2. THE Feature_Access_Service SHALL determine the Role_Permission for an available Plan_Gated_Feature using the role of the Account.
3. WHERE a Plan_Gated_Feature is available AND the Role_Permission for the Account is `view_only`, THE Dashboard SHALL display the feature in a read-only state.
4. IF an Account attempts an action on a Plan_Gated_Feature for which the Account's Role_Permission is `view_only`, THEN THE Feature_Access_Service SHALL reject the action and return an authorization error.
5. THE Feature_Access_Service SHALL NOT hide a Plan_Gated_Feature from a Child_Account solely because of the Account role when the Effective_Plan includes that feature and the role's Role_Permission is `operate` or `view_only`.

### Requirement 4: Generic plan-gated feature inheritance

**User Story:** As a product owner, I want every plan-gated feature to follow the same inheritance rules, so that new features behave consistently for child accounts without bespoke logic.

#### Acceptance Criteria

1. THE Feature_Access_Service SHALL resolve availability for every Plan_Gated_Feature using the Effective_Plan and Subscription_Status.
2. WHEN a new Plan_Gated_Feature is added to a Feature_Entitlement, THE Feature_Access_Service SHALL make that feature available to Child_Accounts whose Effective_Plan includes it without additional role-based suppression.
3. THE Feature_Access_Service SHALL expose a single resolved feature-access result that the Dashboard consumes for navigation tabs and settings sub-tabs.

### Requirement 5: Subscription status enforcement

**User Story:** As a tenant owner, I want plan features to switch off for everyone when my subscription is not active, so that access reflects the current billing state across the whole tenant.

#### Acceptance Criteria

1. IF the Subscription_Status of the Parent_Account is not active, THEN THE Feature_Access_Service SHALL mark all Plan_Gated_Features as unavailable for every Account in the Tenant.
2. IF the current date is later than the `subscriptionExpiresAt` of the Parent_Account, THEN THE Feature_Access_Service SHALL treat the Subscription_Status as expired and mark all Plan_Gated_Features as unavailable for every Account in the Tenant.
3. WHEN the Subscription_Status of the Parent_Account returns to active, THE Feature_Access_Service SHALL restore availability of the Plan_Gated_Features included in the Effective_Plan for every Account in the Tenant.

### Requirement 6: Plan change propagation

**User Story:** As a tenant owner, I want plan upgrades and downgrades to apply to my sub-users and sub-locations, so that child access always matches my current plan.

#### Acceptance Criteria

1. WHEN the Subscription_Plan of the Parent_Account changes, THE Feature_Access_Service SHALL resolve each Child_Account's Effective_Plan to the new Subscription_Plan on the next feature-access resolution.
2. WHEN the Subscription_Plan of the Parent_Account is downgraded such that a Plan_Gated_Feature is no longer in the Feature_Entitlement, THE Feature_Access_Service SHALL mark that feature as unavailable for every Account in the Tenant.
3. WHEN the Subscription_Plan of the Parent_Account is upgraded such that a Plan_Gated_Feature is added to the Feature_Entitlement, THE Feature_Access_Service SHALL mark that feature as available for every Account in the Tenant according to each Account's Role_Permission.

### Requirement 7: Deactivated child account access

**User Story:** As a tenant owner, I want deactivated sub-users and sub-locations to lose access, so that disabling an account immediately removes its ability to use features.

#### Acceptance Criteria

1. IF a Child_Account is not an Active_Account, THEN THE Feature_Access_Service SHALL deny access to all Plan_Gated_Features for that Child_Account.
2. IF a Child_Account is not an Active_Account, THEN THE Feature_Access_Service SHALL reject feature actions requested by that Child_Account and return an authorization error.

### Requirement 8: Server-side enforcement of feature access

**User Story:** As a security-conscious tenant owner, I want feature access enforced on the server, so that hiding a tab in the interface is not the only barrier to using a feature.

#### Acceptance Criteria

1. WHEN a server function receives a request for a Plan_Gated_Feature, THE Feature_Access_Service SHALL verify that the requesting Account's Effective_Plan includes the feature before performing the operation.
2. IF the requesting Account's Effective_Plan does not include the requested Plan_Gated_Feature, THEN THE Feature_Access_Service SHALL reject the request and return an authorization error.
3. IF the requesting Account's Role_Permission for the requested Plan_Gated_Feature is `view_only` AND the request performs a state-changing action, THEN THE Feature_Access_Service SHALL reject the request and return an authorization error.
4. THE Feature_Access_Service SHALL scope all Plan_Gated_Feature operations to the `tenantId` of the requesting Account.
```
