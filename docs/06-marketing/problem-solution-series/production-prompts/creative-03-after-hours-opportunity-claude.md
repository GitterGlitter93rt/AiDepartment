# Claude Production Prompt — Creative 03: After-Hours Opportunity

Status: Ready for generation after human approval
Series: YAD Business Problem Series

## Paste into Claude Code

```text
YAD BUSINESS PROBLEM SERIES — CREATIVE #3
AFTER-HOURS OPPORTUNITY V1
COVERAGE GAP → AI AFTER-HOURS CAPACITY

PROJECT ROOT:
~/ai-ad-brain

VIDEO ENGINE:
OpenRouter
bytedance/seedance-2.5

Reuse the CURRENT WORKING production pipeline.
Do NOT rebuild the generation stack.

Before doing anything:
- inspect Front Desk Capacity V3
- inspect Follow-Up Leak V2 and carry forward only proven production improvements
- inspect current Seedance/OpenRouter implementation
- inspect current deterministic post renderer
- inspect current Kokoro am_michael voice path
- inspect current office/phone audio tooling
- inspect YAD logo/typography assets
- inspect current folder/version enforcement and remote Dropbox verification

Do NOT run GitHub Actions.
Do NOT trigger CI.
Do NOT use GitHub-hosted compute.
Work locally on EdgeXpert.
Do not ask unnecessary questions.

==================================================
CREATIVE
==================================================

SERIES:
YAD BUSINESS PROBLEM SERIES

CREATIVE:
AFTER-HOURS OPPORTUNITY V1

PROBLEM:
NEW CUSTOMER DEMAND ARRIVES AFTER THE OFFICE CLOSES.

CORE MESSAGE:
YOUR OFFICE MAY CLOSE.
NEW CUSTOMERS DO NOT ALWAYS WAIT UNTIL MORNING.

This is NOT an employee failure.
It is a COVERAGE GAP.

==================================================
STRATEGIC POSITIONING
==================================================

Do NOT frame the story as:
- employees should work all night
- people are lazy for going home
- voicemail always loses the customer
- AI replaces the receptionist

The employee did the correct thing:
THE WORKDAY ENDED.

The business problem is that customer demand does not always follow office hours.

Your AI Department can ADD AFTER-HOURS RESPONSE CAPACITY to the existing team.

The AI agent may be configured to:
- answer appropriate inbound calls
- capture what the caller needs
- collect contact/context information
- apply business-defined rules
- answer routine questions
- book an appointment where configured
- route/escalate the next step where configured
- create an organized handoff for the human team

Humans retain:
- judgment
- exceptions
- professional decisions
- emergency decisions requiring business rules/human escalation
- relationship-driven conversations
- regulated/professional advice

==================================================
PRIMARY NARRATION
==================================================

Use this as the preferred script:

"Your office may close at five, but new customers do not always call during business hours. When nobody can answer, that opportunity either waits until morning or starts looking somewhere else. Your AI Department can add an after-hours AI agent that answers the call, captures what the customer needs, follows your business rules, and books or routes the next step. Your team comes back to organized opportunities instead of a voicemail pile. Same team. More coverage. Your AI Department."

Before generation:
- calculate exact word count
- test am_michael at natural rate
- target finished narration approximately 28.5–29.5 seconds
- preserve clean CTA tail room
- do NOT silently rewrite approved copy to fit

If the narration does not fit naturally:
STOP and report rather than automatically changing approved wording.

==================================================
VOICE
==================================================

OFF-CAMERA MALE NARRATOR.

Preferred:
Kokoro am_michael

Use a complete narration track.
Do NOT depend on Seedance native speech.

Preferred Seedance request:
generate_audio: false

If video-only mode is not reliable:
generate_audio: true, but discard/strip native narration from final master.

No isolated word patches.
No voice splicing.
No spoken domain.

==================================================
VISUAL STORY
==================================================

This ad should feel cinematic but ordinary and believable.

We need two physically clear worlds:

A. BUSINESS OFFICE AT CLOSING TIME
B. PROSPECT/CUSTOMER AFTER HOURS

The visual action must prove the business logic.

==================================================
0.0–5.0 SEC — OFFICE CLOSES NORMALLY
==================================================

Show a competent front-office employee finishing the day.

Purposeful actions:
- finishes a note / task
- closes or locks workstation naturally
- gathers keys/bag
- switches off a desk lamp or office light if natural
- exits through office door

Do NOT show:
- employee rushing out carelessly
- eye rolling
- dramatic exhaustion
- ignoring a ringing phone while leaving
- phone already ringing before the office is closed

Deterministic overlay:

5:03 PM

Then:

Your office
is closed.

Narrator:
"Your office may close at five..."

==================================================
5.0–10.0 SEC — CUSTOMER NEED APPEARS
==================================================

Cut to a DIFFERENT location.

Use an original fictional customer/prospect at home, in a driveway, or another generic evening setting.

The customer clearly INTENDS to contact a business.

Preferred action:
- looks at smartphone
- taps/searches naturally
- intentionally taps to initiate a phone call
- raises phone to ear

Do NOT rely on generated readable phone-screen text.

Exact text is deterministic post.

Overlay:

After hours

Then:

New customer
calling.

==================================================
CRITICAL CALL LOGIC
==================================================

The customer's call must be visually OUTBOUND from the customer's phone.

Required sequence:

customer looks at phone
→ taps phone
→ raises phone
→ call begins

Do NOT show:
- customer's phone ringing first
- customer answering an inbound call
- random handset behavior
- strange stare at phone

==================================================
10.0–15.0 SEC — COVERAGE GAP
==================================================

Return to the now-empty office.

A desk phone may ring with nobody there.

This is physically/logically correct because:
- office is closed
- employee has already left
- customer is calling inbound to the business

Use audible incoming office ring.

Do NOT imply employee should still be present.

Narrator:
"When nobody can answer, that opportunity either waits until morning or starts looking somewhere else."

Overlays:

No one is there
to answer.

Then:

Wait until morning?

Then optionally:

Keep looking?

Do NOT state the customer definitely leaves.

==================================================
15.0–23.5 SEC — ADD AFTER-HOURS CAPACITY
==================================================

Do NOT generate a humanoid robot.
Do NOT generate floating AR/holographic interfaces.

Use deterministic YAD workflow card.

Header ONCE:

AFTER-HOURS AI AGENT

Progressively reveal:

Answers
↓
Captures need
↓
Applies your rules
↓
Books / routes next step

Causal logic:
- answer first
- capture context
- apply configured rules
- then book or route

Do not imply universal automatic booking.

Narrator:
"Your AI Department can add an after-hours AI agent that answers the call, captures what the customer needs, follows your business rules, and books or routes the next step."

==================================================
23.5–27.5 SEC — MORNING HANDOFF
==================================================

Show the employee returning the next morning.

Purposeful actions:
- arrives normally
- opens workstation
- reviews an organized lead/opportunity card added deterministically
- sees context/next step

Do NOT show a pile of random voicemails unless visual remains believable.

Overlay:

Your team starts
with context.

Supporting deterministic card may show:

AFTER-HOURS OPPORTUNITY
Need captured
Next step organized

No fake PII.

Narrator:
"Your team comes back to organized opportunities instead of a voicemail pile."

==================================================
27.5–30.0 SEC — CTA
==================================================

Premium YAD CTA card.

Large alpha-bounded logo.
No white rectangle.
No microscopic tagline.

Text:

Same team.
More coverage.

YourAiDepartment.ai

Spoken:
"Same team. More coverage. Your AI Department."

No spoken domain.

==================================================
AUDIO STORY
==================================================

Final audio should be rebuilt deterministically.

LAYERS:
1. am_michael narration
2. subtle closing-office ambience
3. evening/home ambience for customer scene
4. customer's outbound call/ringback if needed
5. empty-office incoming ring
6. subtle next-morning office ambience

Narrator must remain foreground.

Phone sounds must still be noticeable on a mobile speaker.

IMPORTANT:
Do not change authentic call tones to obviously nonstandard pitches simply because a narrow measurement excludes their fundamentals.

For ringback/incoming ring:
- preserve recognizable US telephone character
- if phone-speaker audibility is weak, increase level and/or add subtle harmonic content/EQ emphasis
- do not make the tone sound like an alarm, doorbell, or European ring pattern
- human recognition outranks a single band-limited meter

==================================================
SEEDANCE VISUAL PROMPT DIRECTION
==================================================

Create a realistic 30-second vertical commercial about a normal service-business office closing for the evening and a new customer calling after hours.

The first employee is competent and professional. The workday ends normally. They finish a task, gather belongings, and leave. No phone is ringing while they leave. No guilt or employee blame.

Then cut to a different fictional customer in a realistic evening setting. The customer intentionally uses a smartphone to place an outbound call: they look at the phone, tap to initiate the call, then raise it to their ear. Their phone does not ring before they initiate the call.

Then return to the empty closed office where an office phone can visibly ring with nobody there.

Later, show the original employee returning the next morning and productively reviewing work at the computer.

Exact clock graphics, phone labels, lead cards, AI workflow, and CTA are added later in deterministic post.

ABSOLUTELY NO:
- humanoid robot
- holographic AI brain
- floating UI
- AR panels
- readable generated CRM text required for story
- employee guilt
- robotic sighing
- repeated nodding
- vacant staring
- weird phone handling
- scene that implies the office worker should still be at work

Real people.
Real office.
Real customer.
Real phone actions.
Natural evening lighting.
Premium social-commercial realism.

==================================================
DETERMINISTIC OVERLAY MASTER LIST
==================================================

1. 5:03 PM
2. Your office is closed.
3. After hours
4. New customer calling.
5. No one is there to answer.
6. Wait until morning?
7. Keep looking?
8. After-hours AI agent
9. Answers
10. Captures need
11. Applies your rules
12. Books / routes next step
13. Your team starts with context.
14. Same team. More coverage.
15. YourAiDepartment.ai

Do NOT use full conventional subtitles.
Use semantic conversion overlays.

==================================================
SEMANTIC TIMING
==================================================

Word-anchor overlays.
Maximum intentional early reveal:
150 ms.

Anchor examples:

"close at five"
→ 5:03 PM / office closed

"new customers"
→ new customer scene

"nobody can answer"
→ empty office

"after-hours AI agent"
→ workflow header

"answers"
→ Answers

"captures"
→ Captures need

"business rules"
→ Applies your rules

"books or routes"
→ Books / routes next step

"team comes back"
→ morning handoff

==================================================
VERSION / FOLDER RULE
==================================================

This creative gets its OWN folders.

LOCAL:
outputs/problem_solution/after_hours_opportunity_v1/

Required:
RAW/
FINAL/
QC/
META/

DROPBOX:
dropbox:AI-Ad-Brain/Problem-Solution-Series/After-Hours-Opportunity-V1/

Required:
RAW/
FINAL/
QC/
META/

Final:
YourAiDepartment_AfterHoursOpportunity_V1_1080x1920.mp4

Hard fail if any output is directed into Front Desk Capacity or Follow-Up Leak folders.

==================================================
RAW VISUAL QC
==================================================

Create dense contact strips for:

A. closing sequence 0–6s
B. customer call sequence 5–11s
C. empty-office ring sequence 9–16s
D. morning handoff 22–28s

Hard questions:

EMPLOYEE LEAVES NORMALLY:
YES / NO

PHONE RINGS WHILE EMPLOYEE IS LEAVING:
NO / FAIL

CUSTOMER INITIATES OUTBOUND CALL:
YES / NO

CUSTOMER PHONE RINGS BEFORE INITIATION:
NO / FAIL

EMPTY OFFICE RING IS LOGICAL:
YES / NO

EMPLOYEE BLAMED:
NO / FAIL

FLOATING UI ARTIFACT:
ABSENT / FAIL

ROBOTIC ACTING:
NO / FAIL

==================================================
BUSINESS / CLAIMS QA
==================================================

Required:
- no claim every caller converts
- no guaranteed booking
- no guaranteed revenue
- no claim every after-hours caller leaves
- no employee-replacement message
- no implication staff should work 24/7
- business-defined rules explicit
- booking/routing framed as configurable
- professional/regulatory judgment remains human where needed

==================================================
PHONE-SCALE QC
==================================================

Generate 390x693 review frames for:
1. closing time
2. office closed
3. customer initiating call
4. new customer calling
5. empty-office ring
6. coverage gap
7. AI agent header
8. capture/rules
9. book/route
10. morning handoff
11. CTA

==================================================
PAID GENERATION AUTHORIZATION
==================================================

DO NOT GENERATE UNTIL HUMAN EXPLICITLY AUTHORIZES THIS CREATIVE.

Once authorized:
ONE successful Seedance 2.5 generation maximum.

Maximum video spend:
$8.00

No automatic second generation.

Narration:
local Kokoro preferred, $0.

==================================================
UPLOAD VERIFICATION
==================================================

After final export:
- upload full package to the dedicated Dropbox folder
- remote-list exact final file with rclone
- verify non-zero remote size
- compare local and remote size

Do not claim upload success without remote verification.

==================================================
FINAL REPORT
==================================================

Print:

SERIES:
YAD BUSINESS PROBLEM SERIES

CREATIVE:
AFTER-HOURS OPPORTUNITY V1

CORE PROBLEM:
AFTER-HOURS COVERAGE GAP

VIDEO MODEL:
...

JOB ID:
...

VIDEO COST:
...

VOICE:
Kokoro am_michael

OFFICE CLOSES NORMALLY:
PASS / FAIL

CUSTOMER OUTBOUND CALL LOGIC:
PASS / FAIL

EMPTY OFFICE RING:
PASS / FAIL

EMPLOYEE BLAME:
NO / FAIL

AFTER-HOURS AI AGENT:
PASS / FAIL

WORKFLOW:
ANSWER
→ CAPTURE
→ APPLY RULES
→ BOOK / ROUTE

MORNING HANDOFF:
PASS / FAIL

CORE LINE:
SAME TEAM. MORE COVERAGE.

UNSUPPORTED CLAIMS:
NONE / FAIL

FLOATING UI:
ABSENT / FAIL

VISIBLE DOMAIN:
YourAiDepartment.ai

SPOKEN DOMAIN:
NO

FINAL RESOLUTION:
1080x1920 / FAIL

LOCAL PATH:
...

DROPBOX PATH:
...

REMOTE UPLOAD VERIFIED:
YES / NO

Then STOP.
Do not generate Creative #4 automatically.
```

## Notes

This production prompt intentionally carries forward the first two creatives' learned constraints: logical phone choreography, off-camera replaceable narration, no employee blame, deterministic UI, strong mobile audio, separate revision folders, and remote upload verification.
