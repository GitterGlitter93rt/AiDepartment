# Creative 02 - Follow-Up Leak

Status: V2 candidate master complete; human review pending
Series: YAD Business Problem Series
Updated: 2026-09-04

## Business problem

A company can successfully generate a lead, make the first follow-up attempt, and still lose consistency because the opportunity requires attention repeatedly over time while the sales team continues handling new leads, customers, estimates, meetings, and other legitimate work.

This is not inherently a bad-salesperson problem. It is a capacity and consistency problem.

## Core message

**You already paid for the opportunity. Keep follow-up moving.**

Supporting line:

**More follow-up. Same sales team.**

## V2 production record

- Seedance job: `WH8eGo7koEYDbeIh7xmH`
- Seed: `870022`
- Reported video cost: `$6.94`
- Additional generations after V2: `0`
- QC reported by production pipeline: `124 checks, 0 failed`
- Final narrator: Kokoro `am_michael`
- Narration duration: approximately `29.43s`
- ASR WER: `0.0000`
- Voice F0 median reported: `117.9 Hz`
- Seedance requested as video-only; final narration is deterministic/local
- Dropbox upload reported and remotely verified

## V2 corrections versus V1.1

### Outbound-call logic

V1.1 visually read as an inbound call that disconnected. V2 was rerolled specifically to make the sequence causal and readable:

1. phone is idle on desk
2. actor picks it up
3. actor operates the screen / initiates the call
4. phone rises to ear only after initiation
5. actor waits calmly during ringback
6. no answer
7. actor lowers/ends call naturally
8. actor sets phone down
9. actor types/logs the next step

Dense QC was performed across the call sequence at roughly 350ms intervals.

### Voice

The `af_bella` V1.1 track was rejected by human review. V2 uses the previously accepted male direction with `am_michael`.

The spoken words `salesperson` and `salespeople` remain banned because prior synthesis repeatedly mangled them. Preferred language is `sales rep`, `sales team`, and `your team`.

### Office audio

V1.1 ambience and phone activity were too quiet. V2 rebuilt the sound bed with deterministic office ambience, outbound ringback, and later incoming office rings.

Production reported:

- ambience RMS approximately `0.034`
- approved Front Desk V3 reference approximately `0.02293`
- outbound ringback about `+10.0 dB` over bed
- busy incoming rings about `+7.3 dB` over bed
- calmer rings about `+4.5 dB` over bed

Human review is still required for perceived naturalness and phone-speaker balance. Numeric measurements do not replace listening judgment.

### Ringback note

Production changed ringback fundamentals from conventional US `440 + 480 Hz` to `660 + 720 Hz` to improve phone-speaker audibility. This must be judged by ear. Recognizable US ringback character is more important than maximizing a narrow band-limited audibility metric. Future production should prefer gain, EQ, compression, or subtle harmonic support before changing the fundamental identity of a familiar telephone sound.

### Visual-artifact control

V2 explicitly required only physical objects in the room and prohibited floating AR/HUD/interface elements. Production reported the floating-UI artifact from V1.1 as absent in V2.

### Semantic overlays

One unsupported label was removed because the footage showed a colleague rather than a current customer. This establishes a permanent rule: a semantic label must not describe action that is not actually visible.

The semantic timing gate also caught an `Estimate` overlay being clamped 160ms early. The hard maximum early reveal of 150ms overrode the dwell heuristic and the build was corrected.

## Intended workflow graphic

`AI FOLLOW-UP AGENT`

`Follow-up continues`
→ `Customer responds`
→ `Routine questions answered`
→ `Appointment booked`

Customer response must always appear before booking.

## Human + AI positioning

Humans retain:

- relationships
- judgment
- meaningful sales conversations
- negotiation
- closing
- exceptions

AI may add:

- follow-up consistency
- configured outreach
- routine question handling
- qualification where configured
- booking
- handoff
- workflow updates where configured

Do not frame sales or follow-up as low-value work.

## Human review gates still open

1. Does `am_michael` sound natural enough in the final master?
2. Does the early ringback sound recognizably like an outbound US call on a real phone speaker?
3. Are the later office rings/ambience audible enough without fighting the narrator?
4. Does the full visual sequence read correctly at normal viewing speed, not just in contact strips?
5. Is the final master strong enough to designate `FOLLOW-UP LEAK MASTER #1`?

Until those are reviewed by a human, treat V2 as a **candidate master**, not a locked master.