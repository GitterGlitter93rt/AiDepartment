# YAD Sales Brain — Rep Portal Visual System

**Status:** UI implementation authority  
**Source:** Existing YAD design tokens in `src/styles/tokens.css`  
**Purpose:** Keep `sales.youraidepartment.ai` visually consistent with Your AI Department while making the internal portal feel like a premium SaaS product.

---

# 1. EXISTING BRAND TOKENS ARE AUTHORITATIVE

Do not invent a separate sales-app brand.

Current YAD tokens include:

- Midnight Navy: `#08111F`
- Deep Slate: `#111C2E`
- Dark Secondary: `#0D1728`
- Electric Blue: `#2563EB`
- Electric Blue Hover: `#1D4ED8`
- Signal Cyan: `#22D3EE`
- Cloud White: `#F7F9FC`
- Pure White: `#FFFFFF`
- Near Black: `#111827`
- Slate Gray: `#64748B`
- Dark Muted Text: `#94A3B8`
- Emerald: `#10B981`
- Amber: `#F59E0B`

Existing fonts:

- Heading: Manrope / Inter fallback
- Body: Inter

Existing radii:

- button: 8px
- card: 14px
- panel: 18px
- pill: full

Existing gradient:

`linear-gradient(135deg, #2563EB, #22D3EE)`

Claude should reuse/import these tokens if the sales portal shares the same styling package, or mirror them through one explicit shared design-system package if the portal becomes a separate app.

---

# 2. RECOMMENDED PORTAL SURFACE MODEL

Use a restrained dark-navigation + light-workspace composition.

## Left navigation

- Midnight Navy / Deep Slate background
- white primary labels
- muted slate secondary labels
- Electric Blue or Blue->Cyan selected state

## Main workspace

- Cloud White page background
- Pure White cards/tables
- Near Black primary text
- Slate Gray secondary text
- light borders

This gives the internal app a recognizable YAD identity without turning every table cell dark.

---

# 3. PRIMARY ACTIONS

Primary CTA such as:

- Search
- Claim to Me
- Save Follow-Up
- Research More

Use Electric Blue.

Hover/focus uses Electric Blue Hover.

Use the Blue->Cyan gradient sparingly for:

- brand mark/accent
- selected/highlighted premium surfaces
- hero/search focus moments

Do not use gradient on every button.

---

# 4. SEMANTIC COLORS

## Success / healthy / active

Emerald.

Examples:

- verified contact
- active market
- successful claim
- completed research

## Warning / needs attention

Amber.

Examples:

- research stale
- contact quality uncertain
- callback due soon
- incomplete market coverage

## Destructive / DNC

The existing public token set does not define a destructive red.

Claude may add one design-system token centrally rather than hard-coding one-off reds in components.

Use it only for:

- DNC/suppression
- destructive account actions
- critical failed security/policy states

Document any new token in the shared design system.

---

# 5. TIER BADGES

Avoid using unrelated bright colors for every Tier.

Suggested approach:

- Tier A: Electric Blue / premium accent
- Tier B: Signal Cyan or subdued blue-cyan
- Tier C: neutral slate
- Tier D: muted neutral

Do not use Tier colors to imply certainty that does not exist.

Manual score text remains visible, e.g. `A · 13`.

---

# 6. ADVERTISING BADGES

Use compact neutral/brand pills:

- Google Ads
- LSA
- Meta

The badge indicates evidence exists; it should not imply spend level.

Stale advertising evidence receives a muted/stale treatment rather than the same current badge.

---

# 7. TYPOGRAPHY

Use Manrope for:

- page headings
- major section labels
- large KPI numbers where appropriate.

Use Inter for:

- tables
- forms
- body copy
- Account details
- filters.

Do not use oversized marketing-site H1 typography inside dense operational screens.

Suggested application hierarchy:

- Page title: 24–30px equivalent
- Section title: 18–22px
- Card title: 15–18px
- Body/table: 14–16px
- metadata: 12–13px

Respect existing token scale where practical.

---

# 8. TABLE STYLE

The prospect table is an operational centerpiece.

Use:

- white surface
- subtle light border
- sticky header
- 44–52px row height depending on density
- clear row hover
- checkbox selection
- minimal vertical dividers
- aligned badges
- truncated one-line `Why It Fits` with tooltip/drawer expansion.

Avoid:

- spreadsheet gridlines everywhere
- tiny text
- 20 visible columns
- rainbow status coloring
- heavy drop shadows.

---

# 9. ACCOUNT DRAWER

Use a 420–560px right drawer on desktop.

Structure:

1. identity / Tier / owner
2. contact actions
3. why reach out
4. primary hypothesis
5. suggested first question
6. signal badges
7. do-not-claim warnings
8. latest timeline events.

Use panels/cards only where grouping improves scanability.

---

# 10. SEARCH EXPERIENCE

The Find Prospects search row should be a visual hero for the internal product.

Use one elevated white panel with:

- vertical selector
- geography input
- mining-mode selector
- Search button.

Below it, filter pills.

This should visually communicate:

> Tell the Sales Brain where you want to prospect.

Do not make the rep start inside a 30-field filter form.

---

# 11. MOTION

Use existing fast/base transition tokens.

Good uses:

- row hover
- drawer open
- claim success state
- filter chip selection
- toast.

Avoid:

- decorative parallax
- long page transitions
- spinning AI animations while normal database queries run.

---

# 12. MOBILE

Dark top bar / compact navigation can preserve the YAD brand while the working area remains light.

Prospect rows become cards:

- company + Tier
- city
- ad badges
- contactability
- one-line reason
- owner
- Claim/Open action.

Primary action buttons must be thumb-friendly.

---

# 13. DESIGN REVIEW CHECKLIST

Before accepting the first UI:

- does it reuse YAD tokens?
- does it look purpose-built rather than generic admin UI?
- can five prospects be scanned quickly?
- is Claim to Me obvious?
- is ownership obvious?
- are current vs stale signals distinguishable?
- is unknown visually distinct from no?
- are DNC/destructive actions unmistakable?
- does mobile avoid horizontal table dependency?
- is the page still restrained when 50 prospects are visible?

The target is a polished internal product that a salesperson is happy to keep open all day.