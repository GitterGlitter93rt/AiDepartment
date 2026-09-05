# Creative 02 - Follow-Up Leak

Status: V2.1 candidate master; major audio failure corrected; minor human-review items remain
Series: YAD Business Problem Series
Updated: 2026-09-05

## Business problem

A company can successfully generate a lead, make the first follow-up attempt, and still lose consistency because the opportunity requires attention repeatedly over time while the sales team continues handling new leads, customers, estimates, meetings, and other legitimate work.

This is not inherently a bad-salesperson problem. It is a capacity and consistency problem.

## Core message

**You already paid for the opportunity. Keep follow-up moving.**

Supporting line:

**More follow-up. Same sales team.**

## V2 generation record

- Seedance job: `WH8eGo7koEYDbeIh7xmH`
- Seed: `870022`
- Reported video cost: `$6.94`
- Additional Seedance generations after V2: `0`
- Final narrator: Kokoro `am_michael`
- Narration duration reported: approximately `29.43s`
- Seedance requested as video-only; final narration is deterministic/local

## V2 visual correction versus V1.1

V1.1 visually read as an inbound call that disconnected. V2 rerolled the raw footage specifically to make the sequence causal and readable:

1. phone is idle on desk
2. actor picks it up
3. actor operates the screen / initiates the call
4. phone rises to ear only after initiation
5. actor waits calmly during ringback
6. no answer
7. actor lowers/ends call naturally
8. actor sets phone down
9. actor types/logs the next step

Dense QC was performed across the call sequence at roughly 350 ms intervals. Human frame review confirmed the outbound direction is materially clearer than V1.1.

## V2 audio failure

The first V2 post mix was rejected by human review because its deterministic office bed sounded like continuous static.

Independent analysis of the uploaded V2 master found:

- `ffmpeg astats` noise floor: approximately `-20.3 dBFS`
- overall RMS: approximately `-21.26 dBFS`
- spectrogram: near-continuous broadband energy curtain across most of the 30-second ad

The problem was not insufficient volume; it was the use of continuous procedurally synthesized shaped noise as room ambience. Matching RMS to another creative did not make the sound perceptually equivalent.

Permanent lesson:

> Do not use continuous procedural white/pink/brown/shaped noise as office ambience. Clean narration plus discrete realistic sound events is preferable to fake room-tone static.

## V2.1 post-only correction

V2.1 reused the existing V2 raw and required `$0` new video generation spend.

Uploaded review file:

`YourAiDepartment_FollowUpLeak_V2_1_MASTER_1080x1920.mp4`

Chat upload was transcoded to approximately `512x910`, so source resolution still must be verified against the local/Dropbox master rather than inferred from the ChatGPT copy.

### V2.1 audio verification

Independent analysis of the uploaded V2.1 master found:

- `ffmpeg astats` noise floor: approximately `-102.56 dBFS`
- overall RMS: approximately `-22.75 dBFS`
- true peak: approximately `-2.2 dBFS`
- integrated loudness: approximately `-19.5 LUFS`
- loudness range: approximately `4.3 LU`
- the continuous broadband static curtain is gone
- quiet windows now approach actual silence

Compared with V2, the measured noise-floor result improved by roughly `82 dB`.

The ringback was also restored from V2's altered `660 + 720 Hz` fundamentals to recognizable North-American-style `440 + 480 Hz`, with low-level harmonic support near `880 + 960 Hz` for mobile audibility.

This is the preferred technical approach:

- preserve recognizable telephone fundamentals
- solve audibility with gain/EQ/compression/subtle harmonics
- human recognition outranks a narrow speaker simulation

## V2.1 frame-by-frame review

### 0-2.5 sec - Opportunity setup

Strong. Actor is working normally, opening thesis is readable, and `Website lead / New lead` clearly establishes the opportunity.

### 2.5-4.5 sec - Outbound initiation

Strong. Actor deliberately handles the smartphone before raising it, so the direction reads as outbound rather than inbound.

### 4.5-6.75 sec - No-answer hold

Core story works, but the raw actor repeatedly holds/touches his free hand around the mouth/nose area while the phone is at his ear. This reads mildly generated/unnatural. It is a raw-footage limitation, not a post-production logic failure.

Do not reroll solely for this unless future human review considers it distracting enough to justify spend.

### 6.75-7.5 sec - `Next task`

Minor timing issue. `Next task` begins while the phone is still at/near the actor's ear, before the call has fully ended. Better timing is after he has lowered the phone and clearly returned to work, approximately around `7.5s` in the uploaded transcode.

### 7.5-11 sec - Work resumes / opportunity pushed aside

Improved. Unsupported `Another lead` and early `Estimate` labels were removed. `Opportunity pushed aside` is understandable while the actor resumes work.

### 11-12.5 sec - Coworker/document interruption

Good. Coworker/document action is visible and `Website lead / No next step` supports the intended business problem.

### 12.5-15.67 sec - Diagnosis

Strong. `Not a bad sales team. A capacity problem.` remains one of the creative's strongest sections.

### 15.67-22.4 sec - Full-screen AI graphics

Improved copy, but the ad still spends approximately `6.73 consecutive seconds` off the actor in full-screen deterministic graphics.

Approximate structure:

- `15.67-19.0s`: `Add an AI follow-up agent.`
- `19.0-22.4s`: progressive AI follow-up workflow

The workflow itself is cleaner:

`Follow-up continues`
→ `Customer responds`
→ `Questions answered`
→ `Appointment booked`

However the first title card still holds longer than necessary for a UGC/business-problem creative. If underlying raw footage is usable, future post-only refinement should shorten the full-screen title and return to human footage sooner. Do not expose unusable raw merely to reduce the number.

### 22.4-26.4 sec - Human return

Good. Actor returns with paperwork and the `More follow-up. Same sales team.` message reads clearly.

### 26.4-30 sec - CTA

Strong. `Add capacity to your sales team.` and `YourAiDepartment.ai` are readable and clean.

## Voice

The `af_bella` V1.1 track was rejected by human review. V2/V2.1 uses the male `am_michael` direction.

The spoken words `salesperson` and `salespeople` remain banned because prior synthesis repeatedly mangled them. Preferred language:

- `sales rep`
- `sales team`
- `your team`

Pitch/frequency measurements may help verify the rendered voice file, but they do not prove that the voice sounds natural. Human listening remains the final gate.

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

## Remaining review gates

1. Human ear: does `am_michael` sound natural enough in the actual V2.1 master?
2. Human ear: does restored `440 + 480 Hz` ringback sound recognizably outbound on a real iPhone speaker?
3. Visual timing: move `Next task` later so it begins after the phone is clearly down.
4. Raw acting limitation: decide whether the free-hand-to-mouth gesture during the call is acceptable.
5. Pacing: decide whether the `6.73s` full-screen AI section is acceptable or should be shortened in a $0 post-only revision.
6. Verify actual local/Dropbox master resolution is truly `1080x1920` because the ChatGPT upload is a transcode.
7. Only after those human gates pass should the asset be designated `FOLLOW-UP LEAK MASTER #1`.
