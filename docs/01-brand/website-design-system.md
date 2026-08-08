# Website Design System

Status: V1 Approved Direction
Version: 1.0

---

# PURPOSE

This document defines the implementation-level design system for the Your AI Department website.

The approved visual direction is:

Dark-dominant hybrid.

The site should feel:

- Executive
- Premium
- Technical
- Modern
- Trustworthy
- Business-focused

The site should NOT feel:

- Cyberpunk
- Crypto
- Gaming
- Cheap SaaS
- Generic agency
- Science fiction

---

# CORE VISUAL STRATEGY

Use dark sections for:

- Hero
- Assessment visualization
- Method sections
- Managed AI Department
- Enterprise
- Final CTA
- Footer

Use light sections for:

- Explanation
- Industries
- Service comparison
- Long-form readability
- Trust-building sections

The experience should alternate intentionally.

Do not make every section dark.

Do not make every section light.

---

# BRAND COLORS

## Midnight Navy

#08111F

Primary dark background.

---

## Deep Slate

#111C2E

Secondary dark panels and cards.

---

## Electric Blue

#2563EB

Primary CTA color.

---

## Signal Cyan

#22D3EE

Technical accent.

Use sparingly.

---

## Cloud White

#F7F9FC

Primary light section background.

---

## Pure White

#FFFFFF

Cards and high-contrast content.

---

## Near Black

#111827

Primary text on light backgrounds.

---

## Slate Gray

#64748B

Secondary text on light backgrounds.

---

## Dark Muted Text

Suggested:

#94A3B8

Secondary text on dark backgrounds.

---

## Emerald

#10B981

Positive indicators and success states.

---

## Warning / Opportunity Amber

Suggested:

#F59E0B

Use for medium opportunity indicators and caution states.

Do not overuse.

---

# PRIMARY GRADIENT

Electric Blue to Signal Cyan.

Suggested:

linear-gradient(
  135deg,
  #2563EB,
  #22D3EE
)

Use only for:

- Score rings
- Data accents
- Active progress
- Small highlight elements
- Selected assessment states

Do not use the gradient as the entire background of large page sections.

---

# TYPOGRAPHY

## Heading Font

Manrope

Fallback:

Inter, system-ui, sans-serif

Preferred weights:

600
700
800

---

## Body Font

Inter

Fallback:

system-ui, sans-serif

Preferred weights:

400
500
600
700

---

# DESKTOP TYPE SCALE

Suggested starting scale.

H1:

clamp(3rem, 5vw, 5.25rem)

Font weight:

700-800

Line height:

0.98-1.08

H2:

clamp(2.2rem, 3.5vw, 3.6rem)

H3:

1.5rem-2rem

Body Large:

1.125rem-1.25rem

Body:

1rem

Small:

0.875rem

Micro / labels:

0.75rem-0.8rem

Claude may adjust slightly for responsive quality.

Do not materially reduce headline presence.

---

# CONTENT WIDTH

Main maximum page width:

1280px

Acceptable range:

1200-1360px

Long-form text width:

640-760px

Do not allow long paragraphs to span the full page width.

---

# SECTION SPACING

Desktop:

Approximately 96-144px vertical padding for major sections.

Tablet:

72-96px.

Mobile:

56-80px.

Use consistent spacing rhythm.

Avoid cramped sections.

---

# GRID

Preferred desktop content grid:

12-column conceptual grid.

Common layouts:

50 / 50

40 / 60

60 / 40

3-card

4-card

6-industry card grid

Assessment may use:

Sidebar / Main / Results panel

---

# BORDER RADIUS

Buttons:

8-10px

Standard cards:

12-16px

Large panels:

16-20px

Do not use excessive pill-shaped UI except for:

- Tags
- Status indicators
- Small labels

---

# BORDERS

Dark cards:

Subtle blue-gray border.

Suggested:

rgba(148, 163, 184, 0.18)

Light cards:

#E2E8F0

Selected assessment card:

#2563EB

or blue/cyan accent treatment.

---

# SHADOWS

Use restrained shadows.

Light cards may use subtle soft shadow.

Dark cards should rely more on:

- Border
- Contrast
- Background depth

Avoid exaggerated floating shadows.

---

# PRIMARY BUTTON

Background:

#2563EB

Text:

#FFFFFF

Hover:

Slightly brighter or deeper blue.

Suggested hover:

#1D4ED8

Padding:

Approximately 14px 24px

Desktop large CTA:

16px 28px

Font weight:

600-700

Radius:

8px

Transition:

150-200ms

---

# SECONDARY BUTTON ON DARK

Background:

Transparent

Border:

rgba(34, 211, 238, 0.55)

Text:

White

Hover:

Subtle blue/cyan background.

---

# SECONDARY BUTTON ON LIGHT

Background:

#08111F

Text:

White

or

Transparent with dark border.

Choose based on hierarchy.

---

# LINKS

Use blue accent for interactive text.

Hover should be clear but understated.

Avoid underlining every navigation link.

Standard body links should remain visibly recognizable.

---

# HEADER

Desktop target height:

72-84px.

Style:

Dark.

Background:

#08111F or very close.

Possible subtle transparency only if readability remains excellent.

Navigation:

Solutions
Services
Industries
Enterprise
About
Resources

Primary CTA:

Get Your AI Department Score

Header behavior:

Sticky.

On scroll:

May reduce slightly in height and add subtle background opacity/border.

---

# LOGO

Wordmark:

YOUR AI DEPARTMENT

"AI" may use cyan or blue emphasis.

Supporting tagline may appear in desktop hero/header where appropriate:

PRACTICAL AI. REAL BUSINESS VALUE.

Do not make tagline mandatory on mobile.

---

# HERO

Approved direction:

Dark premium hero.

Desktop layout:

Left:
- Eyebrow
- H1
- Supporting copy
- Primary CTA
- Secondary CTA
- Small trust/support text

Right:
- AI Department Score visualization

Suggested background:

#08111F

May include:

- Subtle dot grid
- Extremely restrained network lines
- Soft radial blue glow

Avoid large decorative noise.

---

# HOMEPAGE HERO HEADLINE

Approved conceptual structure:

Find Out Where AI Can
Actually Improve
Your Business.

The exact final copy should follow approved homepage content.

Emphasized phrase may use Electric Blue.

Do not create rainbow gradient text.

---

# SCORE VISUALIZATION

Core homepage visual.

Should resemble a legitimate business diagnostic dashboard.

Elements:

- Circular overall score
- Score number
- Status / stage
- Category bars
- Category labels
- Subtle icons
- Results message

Example categories:

Strategy
Marketing
Sales
Operations
Employees
Technology
Automation

Actual labels must follow assessment logic.

---

# SCORE RING

Use SVG or CSS.

Do not use a heavy charting dependency solely for a donut chart.

Base ring:

Dark blue-gray.

Progress:

Blue-to-cyan gradient.

Center:

Large score.

---

# BUSINESS OUTCOME STRIP

Below hero.

Dark panel.

Four outcomes:

More Revenue

Lower Costs

Happier Teams

Stronger Systems

Use:

Simple line icons.

Short copy.

Avoid oversized feature cards.

---

# LIGHT BUSINESS SECTION

Approved headline concept:

AI Isn't the Strategy.
Improving the Business Is.

Background:

#F7F9FC

Text:

#111827

Visual:

Department / business network.

Center node:

YOUR BUSINESS

Connected nodes may include:

Strategy

Marketing

Sales

Operations

Employees

Technology

Automation

---

# METHOD SECTION

Dark background.

Heading:

The AI Department Method

Display six stages:

Assess

Discover

Prioritize

Implement

Adopt

Optimize

Desktop:

Horizontal process.

Mobile:

Vertical or two-column process.

Use simple icons and connecting line.

---

# INDUSTRY SECTION

Light background.

Use six launch industries:

Collision Repair

Law Firms

Roofing

HVAC

Construction

Professional Services

Cards should contain:

- Icon
- Industry name
- One-line outcome
- Learn More

Avoid fake photography if high-quality imagery is unavailable.

---

# MANAGED AI DEPARTMENT SECTION

Dark premium section.

Purpose:

Sell the ongoing retainer relationship.

Suggested layout:

Left:
- Icon / visual
- Heading
- Short explanation

Middle:
- Capability bullets

Right:
- CTA

Capabilities may include:

- Opportunity discovery
- Strategy
- Implementation oversight
- Training
- Governance
- Reporting
- Technology/vendor management
- Growth systems

---

# ENTERPRISE DESIGN

Enterprise page should use the premium end of the system.

Use:

- More whitespace
- Larger headings
- Restrained number of cards
- Executive diagrams
- Department network graphics
- Governance / transformation visuals

Avoid:

- Quiz appearance
- Excessive gamification
- Loud icons
- Repetitive CTA buttons

---

# CARDS

Dark card background:

#111C2E

Light card background:

#FFFFFF

Padding:

24-32px

Large cards:

32-40px

Cards should have:

- Small icon or label
- Strong title
- Concise text

Avoid excessive decorative content.

---

# ICONS

Style:

Line-based.

Stroke:

Consistent.

Color:

Blue/cyan on dark.

Blue on light.

Potential library:

Lucide

or similar lightweight SVG icon library.

Do not use emoji as production icons.

---

# FORM DESIGN

Inputs should be:

- Large
- Clear
- High contrast
- Accessible

Minimum input height:

48px

Preferred:

52-56px

Dark form background:

#111C2E

Input background:

Slightly lighter/darker than panel.

Selected/focused state:

Blue accent border.

---

# ASSESSMENT DESIGN

Assessment should feel like:

A diagnostic application.

Not:

A consumer personality quiz.

Desktop layout may include:

Left sidebar:
Sections

Center:
Question

Right:
Score / explanation / progress

Mobile:

Single-column step-by-step experience.

Do not force desktop three-column layout onto small screens.

---

# ASSESSMENT OPTION CARDS

Each option should be a full clickable/tappable card.

Include:

- Radio / checkbox indicator
- Main answer
- Optional supporting explanation

Minimum tap height:

56px.

Selected state:

- Blue border
- Slight blue background tint
- Clear selection marker

Do not rely only on color.

---

# ASSESSMENT PROGRESS

Show:

Current section

Overall progress

Question count where helpful

Do not show so much progress metadata that it creates anxiety.

---

# RESULTS DESIGN

Results should feel more valuable than the assessment itself.

Possible layout:

Overall Score

↓

Category Scores

↓

Top Opportunities

↓

Business Impact

↓

Recommended Priorities

↓

CTA

Use strong data visualization.

Avoid giving users a wall of text.

---

# DATA VISUALIZATION

Use CSS/SVG where practical.

Do not introduce large visualization frameworks unless needed.

Approved visual types:

- Score ring
- Horizontal bars
- Priority badges
- Progress bars
- Simple radar only if it improves clarity
- Opportunity matrix

Avoid gimmicky charts.

---

# DARK SECTION BACKGROUNDS

Primary:

#08111F

Secondary:

#0D1728

Card:

#111C2E

May use slight tonal variation between adjacent dark sections.

---

# LIGHT SECTION BACKGROUNDS

Primary:

#F7F9FC

Alternative:

#FFFFFF

Do not use gray-on-gray combinations that reduce contrast.

---

# MOBILE

Primary breakpoint direction:

Mobile-first.

Suggested breakpoints:

640px

768px

1024px

1280px

Exact framework configuration may vary.

Mobile requirements:

- Single-column hero
- Score dashboard below hero copy
- Collapsed navigation
- Large CTA
- Readable assessment
- No tiny charts
- No horizontal scrolling
- Industry cards stacked or 2-column where appropriate

---

# TABLET

Tablet should not simply use the desktop layout compressed.

Allow:

- 2-column layouts
- Stacked dashboard
- Simplified process visualization

---

# MOTION

Allowed:

- Hero dashboard fade/slide
- Score animation
- Progress transitions
- Subtle card hover
- Button hover
- Network line pulse very sparingly

Duration:

Approximately 150-400ms.

Do not delay content visibility.

Respect:

prefers-reduced-motion.

---

# BACKGROUND DECORATION

Allowed:

- Subtle dot grid
- Soft radial glows
- Faint connected-node patterns
- Light technical grid

Opacity should remain low.

Never compromise text readability.

---

# PHOTOGRAPHY

Photography is optional.

If used, prefer:

- Executives
- Real workplaces
- Teams
- Real business environments

Avoid:

- Generic smiling call-center stock
- Fake handshake imagery
- Robots
- Futuristic VR imagery

---

# TRUST

Until legitimate proof exists, do not show:

- Fake logos
- Fake testimonials
- Fake case studies
- Fake metrics

Use:

- Clear methodology
- Strong design
- Specific capabilities
- Transparent process
- Industry knowledge

to establish trust.

---

# FOOTER

Dark.

Background:

#08111F

Use clear columns.

Include:

Solutions

Services

Industries

Company

Legal

Primary assessment CTA may appear directly above footer.

---

# VISUAL QUALITY BAR

The website should feel credible for:

- $5,000 strategy engagements
- $25,000 implementation projects
- Significant monthly retainers
- Enterprise conversations

The design must work equally well for:

- Small growing businesses
- Mid-market companies
- Enterprise leadership

---

# APPROVED GENERAL DIRECTION

The approved homepage concept is:

Dark premium hero

↓

Dark business outcome strip

↓

Light business-first explanation

↓

Dark AI Department Method

↓

Light industries

↓

Dark Managed AI Department

↓

Dark final assessment CTA

↓

Dark footer

Claude should follow this structure unless the approved page copy requires a justified adjustment.

