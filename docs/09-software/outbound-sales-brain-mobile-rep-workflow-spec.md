# YAD Sales Brain — Mobile Rep Workflow Specification

**Status:** Product/design authority  
**Implementation owner:** Claude Code  
**Purpose:** Make the rep portal genuinely usable from a phone in the field, not merely responsive enough to avoid breaking.

---

# 1. PRIMARY MOBILE JOBS

A rep on a phone should be able to:

1. search a ZIP/city/market;
2. filter to unclaimed quality prospects;
3. claim one or several Accounts;
4. open an Account;
5. tap to call;
6. copy/open email;
7. see why YAD ranked it;
8. see the first question / do-not-claim warnings;
9. disposition attempt;
10. schedule callback;
11. mark wrong number;
12. add DNC;
13. see positive replies/follow-ups;
14. navigate to next claimed Account.

---

# 2. MOBILE NAVIGATION

Recommended bottom navigation:

- Home
- Find
- Mine/Markets
- Follow-Up
- More

`My Prospects` can be directly accessible from Home and More, or replace Mine depending on usability testing.

Primary actions should remain thumb-accessible.

---

# 3. FIND PROSPECTS MOBILE

Avoid desktop table squeezed onto screen.

Use stacked result cards/list rows.

Each card should show:

- company
- city
- Tier
- advertiser badges
- contact availability
- one-line Why It Fits
- owner state
- Claim/View action

Example:

**ABC Air**  
Jacksonville · `A · 13`  
`Google` `LSA` `Phone+Email`  
24/7 paid emergency demand  
**Unclaimed**  
[Claim]

Filters open in bottom sheet/full-screen panel.

---

# 4. BULK CLAIM MOBILE

Long-press or checkbox selection mode.

Sticky bottom action:

`Claim 6`

Confirmation should be lightweight.

After success:

> 5 claimed · 1 already owned

Do not force reps to open each Account individually.

---

# 5. ACCOUNT MOBILE VIEW

Above fold:

- company
- Tier
- owner
- phone
- email
- Call button
- Email button
- disposition shortcut

Then:

## Why Reach Out

2–4 sentences max.

## First Question

prominent card.

## Do Not Claim

compact warning.

## Signals

collapsible.

## Timeline

collapsible/scroll.

Deep evidence belongs lower on page.

---

# 6. CALL WORKFLOW

Tapping Call may launch device dialer in V1.

Before launch, system should have Account context loaded.

After rep returns to portal, make disposition easy:

- No Answer
- Voicemail
- Gatekeeper
- DM Reached
- Callback
- Opportunity
- Wrong Number
- DNC

The UI should not assume that opening `tel:` means call connected.

---

# 7. EMAIL WORKFLOW

V1 options:

- copy email
- open mail client
- add to approved Smartlead workflow

The product should clearly distinguish a generated personalization suggestion from an email already sent.

Do not mark `emailed` merely because rep copied the address.

---

# 8. CALLBACK

Callback creation should take seconds:

- date
- time
- timezone inferred/displayed
- optional note

Quick choices:

- Later today
- Tomorrow morning
- Tomorrow afternoon
- Pick date/time

If prospect requested an exact time, store exact time.

---

# 9. FIELD ROUTE FUTURE COMPATIBILITY

Mobile architecture should leave room for:

- nearby claimed Accounts
- map route
- in-person disposition
- door/gatekeeper notes

Do not require map work in first Sales Portal MVP.

---

# 10. OFFLINE / POOR CONNECTION

V1 may require internet, but avoid destructive behavior on flaky mobile networks.

Actions such as DNC/claim/disposition should:

- show pending/failed state clearly;
- never pretend success before server commit;
- use idempotency to avoid duplicate actions on retry.

Do not silently queue DNC indefinitely without telling rep.

---

# 11. MOBILE PERFORMANCE

Prioritize:

- fast list rendering;
- small payloads for prospect browse;
- lazy-load deep evidence;
- cached shell/auth where appropriate;
- no giant background images/video;
- no unnecessary animation.

A rep in a parking lot on cellular service should still be able to work.

---

# 12. ACCESSIBILITY

- minimum touch target sizes;
- readable contrast;
- no tiny metadata as only status cue;
- buttons labeled clearly;
- destructive actions require confirmation;
- DNC visually distinct.

---

# 13. ACCEPTANCE SCENARIO

On iPhone-sized viewport, rep can:

1. log in;
2. search `Roofing + 32092`;
3. filter `Unclaimed + Tier B+ + Phone`;
4. claim 3 Accounts;
5. open one;
6. tap phone;
7. return and mark `Callback Requested` for tomorrow 10am;
8. see Account in My Prospects/Follow-Ups;
9. mark another prospect DNC;
10. confirm it disappears from actionable inventory.

No desktop computer required.