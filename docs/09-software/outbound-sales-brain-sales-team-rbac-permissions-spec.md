# Your AI Department — Sales Team RBAC / Permissions Specification

**Status:** Architecture authority  
**Purpose:** Define who may view, claim, contact, export, edit, suppress, reassign, and administer prospect data inside the Sales Team Access product.  
**Implementation owner:** Claude Code

---

# 1. PRINCIPLE

A salesperson needs enough access to work prospects quickly, but should not receive unrestricted database/admin authority merely because the data is visible in the same system.

Permissions are enforced server-side.

UI hiding is not authorization.

---

# 2. INITIAL ROLES

## SALES_REP

Primary user of Call / Email / Follow-Up queues.

May:

- view Accounts assigned to them or in approved claimable queues;
- view sales-relevant research and evidence;
- view permitted business/contact endpoints;
- claim eligible Accounts;
- release an Account when policy permits;
- log phone/email/field activity;
- create follow-up/callback tasks;
- record dispositions;
- record prospect statements/corrections;
- submit research-refresh requests;
- draft direct follow-up email;
- request/add eligible contact to approved Smartlead cohort where workflow permits;
- honor DNC/opt-out immediately;
- book approved strategy meeting through configured workflow.

May NOT:

- alter canonical scoring rules;
- alter vertical profile definitions;
- alter commercial truth/pricing authority;
- alter compliance policy;
- unsuppress DNC/opt-out;
- bulk-export unrestricted database;
- view secrets/provider credentials;
- enable autonomous calling;
- edit another rep's active Account ownership except through approved release/manager flow;
- mark a booking/transfer/email successful without confirmed action result.

## SALES_MANAGER

Includes SALES_REP rights plus:

- assign/reassign Accounts;
- create sales work packages/cohorts;
- view team queues/workloads;
- view team conversion/follow-up hygiene;
- approve selected exports;
- approve selected Smartlead cohorts under company policy;
- resolve ownership conflicts;
- review/coach call and note quality;
- review promise/proposal readiness where configured;
- pause sales campaigns;
- view campaign economics.

May NOT by default:

- edit canonical safety/compliance rules;
- reveal provider/API secrets;
- unsuppress DNC without privileged policy process;
- enable autonomous calling merely because manager role exists.

## RESEARCH_OPS

May:

- view research queues;
- resolve company identity ambiguity;
- correct domain/location/entity relationships;
- review vertical classification;
- review ad evidence;
- review website/CRM/technology signals;
- review contact/decision-maker evidence;
- trigger/retry research refresh;
- mark evidence stale/superseded according to evidence rules;
- resolve duplicate Accounts through reversible entity-resolution workflow.

May NOT:

- cold-contact prospects unless separately granted sales role;
- change commercial pricing/offers;
- override DNC;
- approve unsupported sales claims;
- invent business facts to make a prospect contactable.

## ADMIN

Privileged operational role.

May:

- manage users/roles;
- manage campaign configuration;
- manage provider configuration references;
- manage system settings permitted by architecture;
- access audit logs;
- perform privileged data administration;
- manage exports under policy;
- configure integration mappings.

Even ADMIN does not automatically bypass:

- provider/source license restrictions;
- compliance rules;
- DNC policy;
- explicit production-dial enablement controls;
- secret-management requirements.

Critical controls may require separate privileged capability rather than one broad ADMIN flag.

---

# 3. CAPABILITY-BASED PERMISSIONS

Implement capabilities independently of role names so roles can evolve.

Suggested capabilities:

- `account.view_sales`
- `account.view_research`
- `account.claim`
- `account.release`
- `account.reassign`
- `contact.view_business_phone`
- `contact.view_direct_phone`
- `contact.view_email`
- `contact.edit_correction`
- `activity.create`
- `disposition.create`
- `followup.create`
- `callback.create`
- `meeting.book`
- `email.draft`
- `email.smartlead_enqueue`
- `export.call_sheet`
- `export.email_sheet`
- `export.combined_worklist`
- `export.bulk_sensitive`
- `suppression.create`
- `suppression.view`
- `suppression.remove_privileged`
- `research.refresh`
- `research.resolve_review`
- `entity.merge_review`
- `campaign.assign`
- `campaign.pause`
- `campaign.configure`
- `commercial_truth.view`
- `commercial_truth.edit_privileged`
- `compliance.view_decision`
- `compliance.edit_policy_privileged`
- `autonomous_dial.enable_privileged`
- `audit.view`

---

# 4. ROW-LEVEL ACCESS

Access must consider both role AND Account relationship.

Examples:

SALES_REP can view:

- Accounts assigned to rep;
- claimable Accounts within approved campaigns/team;
- Accounts involved in meetings/follow-ups owned by rep.

SALES_REP should not automatically browse/export every contact in the company-wide database.

SALES_MANAGER may view Accounts in assigned team/business unit.

ADMIN may have organization-wide visibility, subject to data-source restrictions.

---

# 5. FIELD-LEVEL ACCESS

Not every field visible to backend services belongs in rep UI.

## Normally rep-visible

- company identity;
- location;
- website;
- business phone;
- eligible contact endpoint;
- contact role/name/source/freshness;
- score/tier;
- advertiser evidence summary;
- primary/backup hypotheses;
- Call Pack;
- prior sales activity;
- next action;
- relevant public evidence references.

## Normally hidden/restricted

- provider API credentials;
- raw provider response blobs;
- secret prompt/system instructions;
- internal security configuration;
- unnecessary personal data;
- fields whose provider license prohibits redistribution;
- raw audio/transcript unless role/policy permits;
- privileged compliance-policy internals not required for rep action.

---

# 6. DNC / OPT-OUT AUTHORITY

Creating suppression must be easy.

Any sales rep receiving an explicit DNC/opt-out can record it immediately without manager approval.

Removing suppression is NOT symmetric.

Ordinary SALES_REP and SALES_MANAGER cannot simply click `Undo DNC`.

Any removal process, if company policy permits one, requires:

- privileged capability;
- documented reason;
- audit record;
- applicable policy checks.

---

# 7. EXPORT AUTHORITY

## SALES_REP

May export only assigned/current work within defined row/field limits.

Examples:

- today's 25-call sheet;
- assigned email worklist.

## SALES_MANAGER

May approve larger campaign/team exports under configured limits.

## ADMIN

May perform organization-wide export where source/license/privacy rules permit.

All exports log:

- user;
- time;
- purpose;
- cohort/filter;
- row count;
- fields;
- source/license warnings;
- file/export ID.

Suppressed Accounts cannot appear in ordinary actionable call/email exports.

---

# 8. SMARTLEAD PERMISSIONS

Rep may submit eligible contact for approved Smartlead cohort if granted `email.smartlead_enqueue`.

Rep may NOT:

- bypass opt-out;
- create arbitrary mass campaign outside approved cohort/process;
- overwrite canonical Account state from Smartlead manually;
- expose internal research payloads to Smartlead.

Manager/admin controls campaign approval/configuration depending final implementation.

---

# 9. OWNERSHIP CONFLICTS

If Rep A owns/leases Account:

- Rep B sees `Owned by Rep A` when relevant;
- Rep B cannot cold-contact through ordinary workflow;
- Rep B may request transfer or manager resolution;
- a prospect-initiated inbound message can create a routed task without silently stealing ownership.

Manager reassignment writes audit event.

---

# 10. ACTIVE OPPORTUNITY / CLIENT PROTECTION

Generic cold-outreach permissions are suppressed when Account is:

- active qualified opportunity;
- proposal/decision;
- closed won/client;
- explicit nurture/future timing under an owner;
- DNC/opted out according to policy.

Rep with legitimate opportunity ownership can still perform relationship-specific follow-up.

---

# 11. PRIVILEGED SETTINGS

Keep these outside ordinary sales roles:

- autonomous production dial enablement;
- global kill switch changes;
- compliance policy modifications;
- provider credentials;
- commercial truth/pricing authority edits;
- source-retention policy changes;
- DNC removal;
- audit log deletion/alteration.

---

# 12. AUDIT EVENTS

Required audit events include:

- login/security-relevant session events where appropriate;
- Account claim/release/reassignment;
- contact endpoint edit;
- export;
- DNC/opt-out creation;
- privileged suppression removal;
- campaign assignment;
- Smartlead enqueue;
- research correction;
- role/permission change;
- privileged settings change.

---

# 13. FIRST RBAC ACCEPTANCE

With users:

- Rep A
- Rep B
- Sales Manager
- Research Ops
- Admin

verify:

1. Rep A can work assigned prospects.
2. Rep B cannot work Rep A's leased Account.
3. Manager can reassign.
4. Research Ops can correct research but cannot contact.
5. Rep can create DNC immediately.
6. Rep cannot remove DNC.
7. Rep export is limited to assigned cohort.
8. Manager-approved export is audited.
9. No sales role can expose provider secrets.
10. No ordinary role can enable autonomous production dialing.

---

# 14. CORE RULE

Give the sales team fast access to the information and actions needed to sell. Keep destructive, privileged, compliance, source-license, and system-authority actions explicitly separated.