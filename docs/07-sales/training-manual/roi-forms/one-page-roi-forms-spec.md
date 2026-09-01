# Your AI Department One-Page ROI Forms

Status: Active Internal Sales Asset Specification
Version: 2.0 - One-Page Field Edition

## Design decision

Each ROI worksheet must fit on exactly one US Letter page and be usable both digitally and in print.

The forms are intentionally compact. A salesperson should select only the form that matches the business problem being diagnosed rather than forcing a prospect through every calculator.

The combined field packet is 14 pages total: one standalone calculator per page, with no cover or instruction pages required in the field version.

## Required structure on every page

1. Your AI Department branded header
2. Short `When to Use` statement
3. Company / Date / Salesperson fields
4. Inputs
5. Source code for inputs
6. Core calculation logic
7. Outputs / discussed scenario
8. Missing-data / verification field
9. Recommended next-action field
10. YAD claim-discipline reminder

## Input source codes

- `V` - Verified client data
- `C` - Client-provided estimate
- `B` - External benchmark
- `A` - Illustrative planning assumption

Salespeople must know what kind of number they are using. An illustrative assumption may not be presented as verified company data or an industry fact.

## Permanent financial rules

- Separate theoretical exposure from realistically recoverable opportunity.
- Do not present scenario values as guaranteed revenue, savings, or ROI.
- Prefer the smallest defensible estimate over the largest possible number.
- Revenue is not automatically profit.
- Faster collections are working-capital improvement, not new revenue.
- Suspected advertising inefficiency should be called `spend worth auditing` until an actual audit proves waste.
- Employee time recovered is capacity value unless an actual cost reduction is documented.
- Never position a calculator as a justification to fire or replace staff.
- Keep human oversight where legal, medical, financial, safety, regulatory, or other high-impact judgment is required.

## Forms

### 01 - Missed Call ROI
Inputs: monthly inbound calls; unanswered/missed percentage; legitimate new-business percentage; scenario capture/close percentage; average customer revenue; optional gross margin.

Outputs: unanswered calls; theoretical revenue exposure; qualified missed opportunities; scenario customers; monthly recoverable scenario; annual recoverable scenario.

Core logic: `Calls x missed % -> qualified % -> scenario close % -> customer value`.

### 02 - Lead Response ROI
Inputs: monthly inbound leads; current conversion; scenario conversion; average customer revenue; current response time; desired response workflow.

Outputs: current customers/month; scenario customers/month; additional scenario customers; monthly revenue scenario; annual revenue scenario.

### 03 - Unsold Estimate / Follow-Up ROI
Inputs: estimates/proposals per month; unsold percentage; legitimate recoverable percentage; scenario recovery/close percentage; average sold job/contract revenue.

Outputs: unsold estimates; theoretical exposure; qualified recoverable estimates; scenario recovered customers; monthly recoverable scenario; annual recoverable scenario.

### 04 - Lead Reactivation ROI
Inputs: inactive leads/contacts; contactable percentage; response-rate scenario; qualification/appointment rate; close rate; average customer value.

Outputs: contactable leads; responses; qualified/appointments; scenario customers; potential revenue scenario.

### 05 - No-Show ROI
Inputs: appointments per month; current no-show percentage; scenario no-show percentage; immediate appointment value; optional downstream value.

Outputs: current no-shows; scenario no-shows; recovered appointments; monthly revenue represented; annual revenue represented.

### 06 - Employee Capacity ROI
Inputs: employees affected; repetitive hours per employee/week; loaded hourly labor cost; addressable percentage; productive weeks/year.

Outputs: annual repetitive hours; addressable hours; potential annual capacity value.

Core rule: capacity value is not automatic payroll savings and is never presented as a staff-replacement calculation.

### 07 - Sales Administration Capacity
Inputs: salespeople affected; administrative hours per salesperson/week; loaded hourly labor cost; addressable percentage; productive weeks/year.

Outputs: annual sales-admin hours; recovered selling-hour scenario; potential annual capacity value.

### 08 - Overtime Reduction
Inputs: employees receiving overtime; OT hours per employee/week; overtime hourly cost; percentage tied to addressable workflow; scenario reduction percentage; productive weeks/year.

Outputs: annual OT cost tied to workflow; potential annual overtime value.

### 09 - Reporting / Administrative Work ROI
Inputs: employees involved; hours per cycle; cycles per year; loaded hourly labor cost; addressable percentage.

Outputs: annual manual hours; addressable hours; potential annual capacity value.

### 10 - Document Processing ROI
Inputs: documents per month; minutes per document; loaded hourly labor cost; processing-time reduction scenario.

Outputs: current monthly processing hours; addressable monthly hours; potential annual capacity value.

### 11 - Advertising Efficiency
Inputs: monthly ad spend; monthly leads; qualified leads; customers acquired; average customer revenue; scenario cost per qualified lead.

Outputs: current CPL; current cost per qualified lead; current customer acquisition cost; scenario qualified leads at same spend; additional qualified lead scenario.

### 12 - Hiring Deferral / Capacity Planning
Inputs: planned role/function; annual compensation; loaded-cost/burden estimate; recruiting/onboarding cost; workload driving the hire; addressable workload percentage.

Outputs: estimated first-year loaded hiring cost; potential portion tied to addressable work; capacity/deferral scenario.

Core rule: this does not mean `replace a future employee`; it evaluates whether better workflows can allow the current team to handle additional volume before overhead must increase.

### 13 - Accounts Receivable Efficiency
Inputs: employees involved; AR follow-up hours/week; loaded hourly labor cost; addressable percentage; outstanding receivables; current DSO; scenario DSO.

Outputs: annual AR labor hours; potential annual capacity value; potential working-capital improvement.

### 14 - Final ROI / Payback
Inputs: conservative annual value; expected annual value; aggressive annual value; implementation cost; monthly ongoing cost; annual ongoing cost if applicable.

Outputs: first-year investment; conservative net value/ROI; expected net value/ROI; aggressive net value/ROI; estimated payback period.

## Distribution model

- Keep one combined 14-page packet for reps.
- Each page must remain standalone so a single page can be printed or emailed when appropriate.
- The master training manual should teach when each calculator applies.
- The field playbook should surface only the most common calculators instead of displaying all fourteen at once.
- Industry field cards should point reps to the calculators most relevant to that vertical.

## Visual direction

Follow `docs/01-brand/visual-identity.md`.

Use the approved navy / slate / electric blue / signal cyan / cloud white / emerald visual system. The forms should look like serious business-intelligence worksheets, not generic AI marketing collateral.

Avoid robot imagery, AI brains, sci-fi visuals, or automation-hype language.
