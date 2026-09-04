# Your AI Department — Phone / Contact Action UI Specification

**Status:** Product/design authority addendum  
**Date:** 2026-09-03  
**Surface:** `sales.youraidepartment.ai`  
**Implementation owner:** Claude Code  

---

# 1. PURPOSE

Make phone/contact information immediately understandable to a rep without turning the Account page into a compliance dashboard.

The rep should be able to distinguish at a glance:

- actual named decision-maker direct number;
- named decision-maker reached through company main line;
- role-only main-line route;
- generic location/main number;
- endpoint that needs review;
- endpoint that must not be called;
- whether human manual calling and AI voice have different eligibility.

The UI should remain sleek and premium.

---

# 2. CORE VISUAL RULE

Do not show a phone number as one undifferentiated green clickable string.

Each phone/contact card communicates three independent things:

1. **Who/what does this reach?**
2. **How strong is the endpoint evidence?**
3. **What actions are currently allowed?**

---

# 3. CONTACT CARD HIERARCHY

Example — direct decision-maker:

```text
Sarah Jones
Operations Manager

Direct business line
(904) 555-0188
Provider-asserted · checked 3 days ago

[ Human Call ]   AI Voice: Review
```

Example — named person via main line:

```text
Sarah Jones
Operations Manager

Reach through company main line
(904) 555-0100
Official website · seen today
Ask for Sarah Jones

[ Human Call ]   AI Voice: Review
```

Example — role route only:

```text
Target: Operations / General Manager

Company main line
(904) 555-0100
Official website · seen today
Ask who oversees new lead handling

[ Human Call ]   Contact research available
```

Example — blocked:

```text
Company main line
(904) •••-••••

Do Not Call
Phone outreach is suppressed for this Account

[ Email ]
```

Do not present main-line routes as direct contacts.

---

# 4. PRIMARY CONTACT LABELS

Use plain-language contact-route labels:

- `Direct business line`
- `Company main line`
- `Location line`
- `Extension`
- `Business mobile — provider asserted`
- `Call-tracking business line`
- `Main line — ask for [Name]`
- `Main line — ask for [Role]`
- `Phone research needed`

Avoid internal enum names in rep UI.

---

# 5. EVIDENCE LABELS

Secondary muted text:

- `Official website · seen today`
- `Business listing · checked 2 days ago`
- `Gatekeeper provided · today`
- `Provider asserted · checked 3 days ago`
- `Public business source · checked 12 days ago`
- `Stale · refresh recommended`

A rep should understand why the system trusts the endpoint without opening research logs.

---

# 6. ACTION BADGES

Use channel-specific action/status chips:

- `Human Call Allowed`
- `AI Voice Allowed`
- `Human Call Review`
- `AI Voice Review`
- `Email Available`
- `Email Only`
- `Phone Research Needed`
- `Do Not Call`

Do not show both `CALL READY` and a separate contradictory AI status without explaining the distinction.

---

# 7. PRIMARY ACTION SELECTION

The card's main button depends on current state.

## Human ALLOW

Primary:

`Start Human Call`

Secondary:

- Email
- Add Follow-Up
- More

## Human BLOCK, Email eligible

Primary:

`Email`

Status:

`Email Only`

No active phone/tel action.

## Human REVIEW_REQUIRED

Primary:

`Request Phone Review`

No active tel action.

## No direct endpoint but main-line route allowed

Primary:

`Call Main Line`

Subtext:

`Ask for Sarah Jones — Operations Manager`

## DNC

No call control.

Use clear muted/red suppression banner rather than a giant alarm UI.

---

# 8. START HUMAN CALL INTERACTION

Button does not immediately open `tel:` from stale page state.

Interaction:

```text
Tap Start Human Call
-> compact loading state: Checking call eligibility…
-> server preflight
-> ALLOW
-> ContactAttempt created
-> Phone app opens
```

Expected delay should be minimal when current screening can be reused.

If state changed:

> Phone outreach is no longer available for this Account.

Refresh card state.

---

# 9. RETURN FROM PHONE APP

When the rep returns to the portal, show a sticky bottom sheet/card:

```text
How did the call go?
ABC Air · Sarah Jones

[ No Answer ] [ Voicemail ] [ Gatekeeper ]
[ DM Reached ] [ Callback ] [ Opportunity ]
[ Wrong Number ] [ Do Not Call ]

Add note…
```

Do not make the rep hunt for the Account again.

Dismissal without disposition leaves an unresolved ContactAttempt that appears in `Finish Calls` / activity cleanup.

---

# 10. DIRECT VS MAIN-LINE VISUAL WEIGHT

Direct business contact receives stronger contact-path emphasis, not stronger prospect-fit emphasis.

Example:

`DIRECT`

is a contact route badge.

It does not imply:

- higher YAD Tier;
- higher purchase intent;
- permission for AI voice;
- current decision-maker accuracy beyond the supporting role evidence.

---

# 11. NAMED CONTACT CONFIDENCE

When name/role is strong but endpoint is main line:

> Sarah Jones · Operations Manager
> **Call company main line — ask for Sarah**

When role is strong but person unknown:

> **Target role: Operations / GM**
> Call company main line and ask who oversees inbound lead handling.

When contact is stale:

> Sarah Jones · Operations Manager
> Role last verified 67 days ago
> `Contact refresh recommended`

Do not display stale contact with same confidence as a current one.

---

# 12. MULTIPLE CONTACTS

Default shows one recommended route.

Collapsed:

`3 alternate contacts`

Opening reveals:

- person/role
- route type
- endpoint quality
- current channel status

Do not show 12 names and numbers at once.

The primary contact is selected by current business hypothesis, not simply highest title.

---

# 13. SEARCH RESULTS CONTACT COLUMN

Keep search table compact.

Suggested summaries:

- `Sarah Jones · Direct`
- `Sarah Jones · Main line`
- `Ops / GM · Main line`
- `Main business line`
- `Email only`
- `Research needed`

Small status icons/chips may indicate:

- phone
- email
- named DM

Opening the Account reveals detailed source/eligibility.

---

# 14. CLAIM FLOW

Claiming stays separate from contact permission.

After `Claim to Me`, the rep may see:

> Claimed to you
> Human Call: Allowed
> AI Voice: Review

or:

> Claimed to you
> Phone research needed
> Email available

Do not automatically expose an ineligible phone simply because the Account is now owned.

---

# 15. DNC UX

`Do Not Call` should be fast and clear.

During disposition:

Tap `Do Not Call`

Confirmation:

> Stop phone outreach to this number/account?
> This will block future YAD phone outreach according to the selected scope.

Default scope should follow current company policy; do not make reps interpret legal terminology.

On confirm:

- server writes suppression;
- card immediately changes to blocked state;
- phone action disappears;
- timeline event appears.

Ordinary rep gets no `Undo` button.

---

# 16. WRONG NUMBER UX

`Wrong Number` is not DNC.

On confirm:

- specific endpoint disabled;
- Account retained;
- alternate endpoint promoted if available;
- `Research another number` option when appropriate.

Show:

> Number marked wrong. Company remains in your prospects.

---

# 17. PHONE REVIEW UX

If human phone action is `REVIEW_REQUIRED`:

Show only what rep needs:

> Phone review required
> This endpoint needs an eligibility check before calling.

Action:

`Request Review`

Do not expose raw registry/provider policy details to ordinary reps.

---

# 18. AI VOICE STATUS FOR HUMAN REPS

Ordinary reps do not need full AI compliance internals.

When useful, show secondary small chip:

- `AI Voice Eligible`
- `AI Voice Review`
- `AI Voice Off`

This explains why an Account may be manually callable but not in the automated pilot.

Do not let ordinary reps launch autonomous AI calls unless the product/role explicitly supports controlled pilot actions.

---

# 19. MANAGER VIEW

Manager may see aggregate channel supply:

- Human-call eligible
- AI-voice eligible
- Email only
- Phone review
- Contact research needed
- DNC/suppressed count

Useful filter examples:

- `Named DM + Human Call Allowed`
- `Direct DM + Human Call Allowed`
- `Human Allowed / AI Review`
- `Email Only`

Do not put raw DNC registry contents into management analytics.

---

# 20. MOBILE DESIGN

The Contact/Call area should fit above the fold after company header/Why Reach Out summary.

Recommended order:

1. Contact name/role
2. route label
3. phone display
4. source/freshness
5. human-call action
6. secondary email/follow-up
7. AI voice status small

Use thumb-friendly buttons.

No tiny icon-only call controls.

---

# 21. VISUAL TONE

Keep consistent with existing YAD portal direction:

- restrained premium SaaS;
- strong typography;
- soft neutral surfaces;
- one primary brand accent;
- status colors only when meaningful;
- compact pill badges;
- no rainbow dashboard;
- no giant compliance warning blocks except actual destructive confirmation;
- subtle motion for state transitions.

The contact card should look like a polished sales tool, not a telecom admin console.

---

# 22. ACCEPTANCE TESTS

1. Named DM direct number -> clearly `Direct business line`.
2. Named DM + main line -> clearly `Call main line — ask for [Name]`.
3. Role only + main line -> clearly role route, no invented person.
4. Human ALLOW / AI REVIEW -> both states visible without contradiction.
5. DNC -> no active call/copy/tel action for ordinary rep.
6. Human preflight changes from ALLOW to BLOCK -> phone app does not open.
7. Manual call -> return disposition bottom sheet appears.
8. Wrong number -> endpoint disabled, Account retained.
9. DNC -> suppression persists and no Undo for rep.
10. Mobile screen supports claim -> call -> disposition without horizontal scrolling.
11. Search result contact summary distinguishes Direct vs Main line.
12. Claiming Account does not change phone eligibility.

---

# 23. CORE RULE

**Make the right contact path obvious, the allowed action effortless, and the blocked action unavailable — without making salespeople read telecom/compliance internals.**