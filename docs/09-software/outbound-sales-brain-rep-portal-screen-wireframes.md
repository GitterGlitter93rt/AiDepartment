# YAD Sales Brain — Rep Portal Screen Wireframes

**Status:** Product/design authority  
**Implementation owner:** Claude Code  
**Surface:** `sales.youraidepartment.ai`  
**Purpose:** Translate the UI/UX specification into concrete screen structure without prescribing a brittle component library.

---

# 1. VISUAL CHARACTER

Use the existing YAD visual language:

- Midnight Navy foundation
- Electric Blue primary action
- Signal Cyan sparingly for active intelligence/status
- Cloud White/light surfaces where appropriate
- Manrope headings
- Inter body
- restrained radius/shadow system

The portal should feel like a premium intelligence workspace, not a spreadsheet skin.

Use whitespace and typography hierarchy to make dense information readable.

---

# 2. DESKTOP APP SHELL

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ YAD Sales                                  Search…        🔔   Brent ▾      │
├──────────────┬─────────────────────────────────────────────────────────────┤
│ Overview     │                                                             │
│ Find         │                       PAGE CONTENT                           │
│ Markets      │                                                             │
│ My Prospects │                                                             │
│ Follow-Ups   │                                                             │
│ Replies      │                                                             │
│ Opportunities│                                                             │
│              │                                                             │
│ Team         │                                                             │
│ Mining       │                                                             │
│ Settings     │                                                             │
└──────────────┴─────────────────────────────────────────────────────────────┘
```

Left navigation can collapse on smaller laptop widths.

Use one dominant content canvas; avoid nesting five bordered cards inside each other.

---

# 3. OVERVIEW

```text
Good morning, Brent                                  [Find Prospects]

┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐
│ 42 Active  │ │ 3 Due      │ │ 2 Replies  │ │ 4 Meetings │
│ Prospects  │ │ Follow-Ups │ │ Need Action│ │ This Week   │
└────────────┘ └────────────┘ └────────────┘ └────────────┘

FOLLOW-UPS DUE
┌───────────────────────────────────────────────────────────────┐
│ 10:00  ABC Air       Callback requested     [Open]            │
│ 14:30  Smith Roofing Send requested info    [Open]            │
└───────────────────────────────────────────────────────────────┘

SAVED MARKETS
┌────────────────────────┐ ┌────────────────────────┐
│ Jacksonville HVAC      │ │ St Johns Roofing      │
│ 72 unclaimed           │ │ 44 unclaimed          │
│ 38 Tier A              │ │ 19 Tier A              │
│ refreshed 2h ago       │ │ refreshed 5h ago       │
│ [Browse]               │ │ [Browse]               │
└────────────────────────┘ └────────────────────────┘
```

Home should emphasize work requiring attention and easy entry into discovery.

---

# 4. FIND PROSPECTS

Hero search area:

```text
Find Prospects
Search the markets YAD has already researched, or request deeper research.

┌───────────────┬──────────────────────┬───────────────────────┬──────────┐
│ HVAC        ▾ │ ZIP, city or market │ Advertiser First    ▾ │ Search   │
└───────────────┴──────────────────────┴───────────────────────┴──────────┘

[Unclaimed] [Tier A] [Tier B+] [Google Ads] [LSA] [Phone+Email]
[Decision Maker] [Fresh ≤7d]                              [More Filters]

47 researched prospects · coverage GOOD · refreshed 2h ago     [Research More]
```

Then desktop table:

```text
☐  Company          Fit     Ads          Contact       Why it fits      Owner
─────────────────────────────────────────────────────────────────────────────
☐  ABC Air          A·13    G + LSA      Phone+Email   24/7 paid...     Claim
☐  Cool Breeze      A·11    Google       Phone         Emerg. + form    Claim
☐  First Coast HVAC B·8     Google       Phone+Email   Replacement...   Brent
```

Row click opens Account drawer; Claim button does not require opening drawer.

Bulk selection creates sticky footer:

```text
6 selected                         [Claim Selected] [Save View] [More ▾]
```

---

# 5. ACCOUNT DRAWER

Desktop right-side drawer should allow quick research without losing list context.

```text
┌───────────────────────────────────────┐
│ ABC Air                               │
│ Jacksonville · HVAC       A · 13      │
│ Unclaimed                    [Claim]  │
│                                       │
│ [Call] [Email] [Open Full Account]    │
│                                       │
│ WHY REACH OUT                         │
│ Observed advertising emergency AC... │
│                                       │
│ PRIMARY HYPOTHESIS                    │
│ After-hours paid lead handling        │
│                                       │
│ FIRST QUESTION                        │
│ “When one of those emergency calls...”│
│                                       │
│ DO NOT CLAIM                          │
│ • ad spend                            │
│ • missed-call percentage              │
│ • ServiceTitan follow-up is broken    │
│                                       │
│ CONTACT                               │
│ John Smith · Owner                    │
│ john@...  Verified/provider           │
│ 904-...    Official business line     │
│                                       │
│ SIGNALS                               │
│ [Google] [LSA] [24/7] [Financing]    │
│ [CallRail] [ServiceTitan signal]      │
│                                       │
│ SCORE                                 │
│ +4 Google  +2 economics ...           │
└───────────────────────────────────────┘
```

Drawer should scroll independently.

---

# 6. MARKETS

```text
Markets                                        [Create Saved Market]

[All] [HVAC] [Roofing] [Law] [My Markets]

┌──────────────────────────────┐
│ Jacksonville HVAC           │   ACTIVE
│ Advertiser First            │
│                              │
│ 186 researched              │
│ 72 unclaimed                │
│ 41 phone + email            │
│ 38 Tier A                   │
│ refreshed 2h ago            │
│                              │
│ [Browse Prospects]           │
│ Research healthy             │
└──────────────────────────────┘
```

Managers can expand operational details; reps should not see provider task IDs.

---

# 7. MY PROSPECTS

```text
My Prospects

[All 42] [New 11] [Not Contacted 9] [Callbacks 3] [Replies 2] [Opportunity 4]

Search...                              Sort: Highest Priority ▾

ABC Air               A·13     Callback Fri 10:00      [Open]
Smith Roofing         A·10     Not contacted           [Open]
Jones Plumbing        B·8      Positive email reply    [Open]
```

Use clear relationship status stronger than decorative score.

---

# 8. FULL ACCOUNT PAGE

Structure:

```text
ABC Air                                        Owner: Brent
Jacksonville · HVAC       Tier A · 13          [Call] [Email] [Disposition]
────────────────────────────────────────────────────────────────────────────

OVERVIEW | RESEARCH | CONTACTS | TIMELINE | OPPORTUNITY

Why Reach Out
[concise summary]

Primary Hypothesis                First Question
[card]                            [card]

Paid Demand Funnel
Google Search → /ac-repair → Call + Schedule → Backend unknown

Signals
[Google Ads] [LSA] [24/7] [Financing] [CallRail] [ServiceTitan signal]

Contact
John Smith — Owner
...

Score Breakdown
...

Research Completeness
Known / Missing

Do Not Claim
...
```

Use tabs for deeper data, but keep sales essentials on Overview.

---

# 9. FOLLOW-UPS

```text
Follow-Ups

TODAY
10:00  ABC Air      Requested callback      Brent     [Open] [Done]
14:30  Smith Roof   Send information        Brent     [Open] [Done]

OVERDUE
Yesterday  Jones Plumbing  Call office manager     [Open]
```

Requested commitments should visually outrank generic tasks.

---

# 10. REPLIES

```text
Replies

[Needs Response 2] [Positive] [Neutral] [Negative] [Unsubscribe]

ABC Air
John: “Sure, call me tomorrow morning.”
Campaign: Jacksonville HVAC Advertisers
Owner: Brent
                                               [Open] [Create Callback]
```

No email-inbox clone required; this is sales-action triage.

---

# 11. MANAGER TEAM VIEW

```text
Team

Brent
42 active · 9 untouched · 3 callbacks · 2 replies · 4 opps
[View Portfolio]

Sarah
38 active · 4 untouched · 1 callback · 0 replies · 3 opps
[View Portfolio]

Needs Attention
- 17 claimed Accounts with no activity > threshold
- 2 callbacks overdue
- 1 positive reply not handled
```

Avoid ranking reps by raw dials as the main visual.

---

# 12. MOBILE FIND

```text
Find
[HVAC ▾] [32256              ]
[Advertiser First ▾] [Search]

[Unclaimed] [B+] [Google] [Phone+Email]

47 prospects

┌──────────────────────────────┐
│ ABC Air                 A·13 │
│ Jacksonville                 │
│ Google · LSA · Phone+Email   │
│ 24/7 paid emergency demand   │
│ Unclaimed                    │
│                    [Claim]   │
└──────────────────────────────┘
```

No tiny desktop table.

---

# 13. MOBILE ACCOUNT

Above fold:

```text
ABC Air                    A·13
Jacksonville · HVAC
Owned by You

[ CALL ] [ EMAIL ]

Why Reach Out
Observed advertising emergency AC...

First Question
“When one of those emergency calls...”

Do Not Claim
Ad spend · missed-call rate
```

Disposition button should remain easy to reach after call.

---

# 14. STATES

Every primary surface needs explicit:

- loading
- no results
- partial coverage
- stale research
- research running
- provider degraded
- claim conflict
- permission denied
- network error
- suppressed Account

Do not use generic `Something went wrong` when business meaning is known.

---

# 15. MICROINTERACTIONS

Use subtle motion only where it communicates state:

- Claim success updates owner badge
- drawer slides in
- filter chips animate lightly
- toast for saved callback
- research-running indicator

Avoid flashy gradients, confetti, bouncing cards or consumer-app gimmicks.

---

# 16. DENSITY

Desktop may be information-dense, but enforce hierarchy:

1. relationship/action
2. company/contact
3. reason to reach out
4. score/evidence
5. deep research

Do not give raw source metadata equal visual weight to the Call button.

---

# 17. CORE DESIGN RULE

The portal should feel like **YAD built a proprietary sales intelligence product for its own team** — fast enough for daily prospecting, polished enough to inspire trust, and disciplined enough that the rep always knows what is fact, what is hypothesis, who owns the Account, and what action comes next.