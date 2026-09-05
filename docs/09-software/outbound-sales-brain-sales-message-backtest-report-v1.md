# Your AI Department — Sales Message Backtest Report V1

**Status:** Offline release review  
**Date:** 2026-09-03  
**Scope:** opener framing, short YAD positioning, objection micro-responses and 15-minute close  
**Important:** qualitative/synthetic design review, not live conversion data

---

# 1. WHY THIS EXISTS

The hook question is only one component of the first call.

A call can fail even with a strong hook because:

- the first five seconds sound scripted;
- the YAD explanation is too long;
- the agent over-handles a brush-off;
- the transition to Michael feels forced;
- the meeting close sounds like a generic demo pitch.

Therefore release validation separates:

1. **frame** — first five seconds;
2. **reason** — why this prospect/context;
3. **hook question** — what the AI asks;
4. **reflection/probe** — whether it listens;
5. **positioning** — what YAD does, only when needed;
6. **next-step close** — why 15 minutes with Michael makes sense.

---

# 2. OPENING FRAME TEST

The process question should remain constant while testing frame variants.

## F1 — explicit quick cold call

> Hey [Name], [identity] with Your AI Department. Quick cold call — I'll keep it short.

Then relevance + question.

### Offline assessment

**Score: 47/50**

Strengths:

- transparent;
- concise;
- sounds comfortable with cold outreach;
- immediately lowers expectation of a long pitch;
- consistent with current Sales Manual doctrine.

Risk:

- some prospects may reflexively reject at the phrase `cold call` before hearing relevance.

**Release recommendation:** primary framing candidate.

---

## F2 — out-of-nowhere permission frame

> Hey [Name], [identity] with Your AI Department. I know I'm calling you out of nowhere — one quick question.

Then relevance/question.

### Offline assessment

**Score: 46/50**

Strengths:

- transparent without the trigger phrase `cold call`;
- natural spoken cadence;
- communicates brevity;
- good for skeptical/busy owners.

Risk:

- slightly longer than F1.

**Release recommendation:** primary A/B framing candidate.

---

## F3 — direct identity + relevance

> Hey [Name], [identity] with Your AI Department. I came across you guys while looking at [claim-safe context], and I had one quick question.

### Offline assessment

**Score: 44/50**

Strengths:

- fastest route to relevance;
- no fake familiarity;
- clean natural cadence.

Risk:

- less explicit that this is unsolicited outreach;
- can sound more like a normal sales pitch if delivery is polished/over-produced.

**Recommendation:** acceptable but not first release comparison unless F1/F2 create avoidable resistance.

---

## F4 — permission-heavy opener

> Did I catch you at a bad time? Can I have 30 seconds to tell you why I'm calling?

### Offline assessment

**Score: 34/50**

Weaknesses:

- asks permission before relevance;
- gives prospect an easy automatic `yes, bad time` exit;
- spends opening seconds negotiating for attention rather than asking a useful business question.

**Recommendation:** reject as default.

---

# 3. TOMORROW FRAME EXPERIMENT

Do not test frame and hook simultaneously when possible.

Recommended controlled comparison:

- `F1 + HVAC_AH_A1`
- `F2 + HVAC_AH_A1`

Same:

- market/vertical quality;
- TTS voice;
- model;
- Call Pack quality;
- qualification gate;
- booking flow.

This lets YAD learn whether explicit `cold call` language itself changes early engagement.

Do not declare a winner from one or two calls.

---

# 4. YAD POSITIONING BACKTEST

Positioning is used **after** prospect asks what YAD does or after a supported problem appears.

It is not the default opener.

## P1 — workflow-first short

> That's the kind of workflow we help businesses tighten up — lead handling, follow-up and the systems around it. I don't want to guess at a solution on a cold call.

**Offline score: 48/50**

Why strong:

- directly connects to what prospect said;
- no AI jargon;
- sets up the next step;
- does not prescribe product;
- brief.

**Recommendation:** default after supported workflow problem.

---

## P2 — broader YAD explanation

> We look at how the business handles leads, customers, follow-up and admin work, then figure out whether AI, automation, better software or process changes can actually improve it.

**Offline score: 44/50**

Why useful:

- accurate high-level company explanation;
- broader than one product;
- employee-safe.

Risk:

- longer;
- less specific to the current conversation.

**Recommendation:** use when prospect explicitly asks `what exactly do you guys do?`, not automatically after every pain signal.

---

## P3 — product-first phone-agent pitch

> We build AI receptionists that answer every call and automate your follow-up.

**Offline score: 24/50 — reject as default**

Weaknesses:

- narrows YAD to one product;
- may imply unsupported `every call` performance;
- prescribes before diagnosing;
- creates employee-replacement fear.

---

# 5. STRATEGY-CALL CLOSE BACKTEST

The meeting close should answer:

1. Why is a deeper conversation justified?
2. Who is Michael?
3. How much time does it require?
4. What is the easy next action?

---

## C1 — rationale-first close

> Based on what you just told me, I think this is worth looking at properly instead of guessing on a cold call. Michael handles these strategy conversations for us, and it's only 15 minutes. Want me to see what he has open?

**Offline score: 49/50**

Strengths:

- explicitly bases next step on prospect's own information;
- avoids fake urgency;
- explains why the AI is not trying to solve everything now;
- introduces Michael naturally;
- low-commitment 15 minutes;
- asks permission before calendar lookup.

Risk:

- slightly long for a rushed owner.

**Recommendation:** default when a real workflow problem has been articulated.

---

## C2 — compressed close

> That sounds worth a proper look. Michael handles the strategy side for us — it's 15 minutes. Want me to check his calendar?

**Offline score: 47/50**

Strengths:

- shorter;
- natural;
- strong for an engaged/busy prospect;
- easy transition to Cal.com.

Risk:

- less explicit about why the meeting is justified.

**Recommendation:** use when prospect is clearly engaged or time-constrained and reasoning is already obvious in context.

---

## C3 — generic demo close

> Would you like to schedule a demo?

**Offline score: 27/50 — reject as default**

Weaknesses:

- turns YAD into a software demo company;
- no explanation of value;
- unclear what is being demonstrated;
- easy to reject.

---

## C4 — aggressive urgency close

> I only have two openings tomorrow, so let's get you on the calendar now.

**HARD FAIL when scarcity is not real**

Never use fake urgency/scarcity.

---

# 6. SEND-ME-EMAIL BACKTEST

## E1 — professional relevance clarification

> Sure — I'll keep it short. What should I make it about so it's actually useful: lead handling, follow-up, operations, or marketing?

**Offline score: 47/50**

Recommendation: default when prospect is willing to specify.

## E2 — informal `generic AI garbage`

> Sure. So I don't send you generic AI garbage, what's actually relevant — leads, follow-up, operations, or marketing?

**Offline score: 42/50**

Strength:

- human/informal;
- pattern interrupt.

Risk:

- too casual for some law/health/professional-service contacts;
- profanity-adjacent tone may be inconsistent with certain prospects.

Recommendation:

- optional style variant only when conversational tone supports it;
- not universal default.

## E3 — generic brochure promise

> Sure, I'll send you our information packet.

**Offline score: 29/50**

Weak because it learns nothing and usually creates a low-value dead end.

---

# 7. NOT-INTERESTED BACKTEST

Rule: one clarification maximum, then exit.

## N1 — process vs timing

> Understood. Is the process already handled pretty well, or is now just a bad time?

**Offline score: 48/50**

Strong because either answer is useful:

- handled well -> no-sale;
- bad timing -> callback only if prospect wants one.

## N2 — caught-you-cold

> Totally fair — is that because this isn't a problem for you, or just because I caught you cold?

**Offline score: 44/50**

Good but slightly more sales-y.

Recommendation: N1 default.

## N3 — rebuttal loop

> I understand, but let me tell you why this is different...

**Offline score: 20/50 — reject**

Creates telemarketer behavior and ignores stated resistance.

---

# 8. GATEKEEPER BACKTEST

## G1 — role ownership

> Maybe you can point me in the right direction. Who normally owns your [lead handling / sales follow-up / operations] process?

**Offline score: 49/50**

Strengths:

- respectful;
- gives gatekeeper a useful role;
- learns routing intelligence;
- does not treat receptionist as obstacle.

## G2 — generic owner request

> Can I speak to the owner?

**Offline score: 31/50**

Weaknesses:

- obvious generic sales pattern;
- may target wrong stakeholder;
- wastes the research advantage.

## G3 — deceptive bypass

Any claim to be a customer, friend, referral, returning call or existing vendor without truth.

**HARD FAIL**.

---

# 9. `ARE YOU AI?` BACKTEST

Correct pattern:

1. answer truthfully under current disclosure policy;
2. do not pretend human;
3. do not turn it into a 60-second AI demo;
4. if prospect remains engaged, return to business question.

Strong response shape:

> Yes — I'm an AI calling for Your AI Department. The reason I called you specifically is [claim-safe context]. I had one question about [process].

This is a transparency moment and may itself create curiosity, but curiosity alone is not strategy-call qualification.

---

# 10. `HOW DID YOU GET MY NUMBER?` BACKTEST

Response must be built from actual endpoint provenance.

Examples:

If public official business line:

> It's the business number we found on your public company listing/site.

If licensed provider business contact:

> It came from a business contact-data provider we use for prospect research.

If imported prior YAD source:

> It was in our business prospecting data from [source class, if safe/appropriate].

Do not say `publicly available` unless that is actually true for the endpoint.

Do not evade the question.

---

# 11. RELEASE PACKAGE RECOMMENDATION

Initial preferred message stack:

- Frame: F1 or F2;
- Hook: context-selected A1/A2/B1/estimate/nurture/intake;
- Reflection: specific prospect wording;
- Position: P1 if supported problem; P2 if prospect asks broad YAD question;
- Not interested: N1 once, then exit;
- Email: E1 default;
- Gatekeeper: G1;
- Meeting close: C1 default, C2 for time-constrained/obviously engaged prospect.

Avoid:

- generic AI pitch;
- demo close;
- product-first receptionist pitch;
- aggressive rebuttals;
- fake urgency;
- generic owner request when a role route is known.

---

# 12. TOMORROW EXPERIMENT SEQUENCING

Do **not** create a combinatorial explosion.

Recommended order:

### Stage 1

Hold hook constant at `HVAC_AH_A1` and compare F1 vs F2 only after voice baseline passes.

### Stage 2

Use better-performing/acceptable frame and compare `HVAC_AH_A1` vs `HVAC_OVERFLOW_A2` on comparable Accounts.

### Stage 3

Keep winning frame/hook and inspect whether C1 vs C2 should be selected contextually rather than randomly A/B tested.

Close selection should primarily depend on conversation state:

- enough context + normal pace -> C1;
- enough context + prospect rushed -> C2.

### Stage 4

Expand to Plumbing, then Roofing estimate hook.

---

# 13. CORE CONCLUSION

The strongest release message is not a clever AI pitch.

It is:

**transparent frame + truthful reason + one easy business-process question + evidence that the AI listened + a short rationale for 15 minutes with Michael when a real reason exists.**
