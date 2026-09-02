import type { KnowledgeEntry } from './types.ts';

/** Shared across every legal specialty. */
export const LEGAL_COMMON: KnowledgeEntry[] = [
  {
    id: 'legal.is_this_advice',
    question: 'a question that would require legal advice to answer',
    triggers: [
      /\b(do i have a (case|claim)|is (that|this|it) legal|can they (do|say|take)|am i (liable|responsible|entitled))\b/i,
      /\bwhat are my (rights|options|chances)\b/i,
      /\bwould you (take|win) (my|this) case\b/i,
      /\bhow much (is|would) (my case|it) (be )?worth\b/i,
    ],
    source: 'refuse',
    guidance:
      'You are not an attorney and must not evaluate a case, estimate its value, or say whether they have a claim — and the hedged version ("it sounds like you might") is still doing it. ' +
      'Say plainly that an attorney needs to look at it, and that getting the details down is what makes that meeting useful. Then keep gathering. ' +
      'Never say a case is strong, weak, worth pursuing, or worth a figure.',
  },
  {
    id: 'legal.confidential',
    question: 'whether what they tell you is confidential',
    triggers: [
      /\b(confidential|privileged|private|between us|attorney.client)\b/i,
      /\bcan i tell you\b/i,
      /\bwho (else )?(sees|hears|reads) this\b/i,
    ],
    source: 'industry_general',
    guidance:
      'Answer honestly and without overclaiming: what they share is used to prepare for the consultation and goes to the firm. ' +
      'Do not assert that attorney-client privilege attaches to an intake call — that is a legal conclusion and it is often wrong before an engagement exists. ' +
      'If they are hesitant, tell them they only need to share enough to get the right attorney on the call.',
  },
];

export const PERSONAL_INJURY_KNOWLEDGE: KnowledgeEntry[] = [
  ...LEGAL_COMMON,
  {
    id: 'pi.case_worth',
    question: 'what their case is worth',
    triggers: [
      /\bhow much (can|will|would|could) i (get|expect|recover|receive)\b/i,
      /\bwhat'?s? (my case|it) worth\b/i,
      /\b(settlement|payout|compensation)\b[^.]{0,25}\b(amount|much|typical|average)\b/i,
    ],
    source: 'refuse',
    guidance:
      'Never name a figure or a range, and never say what cases "like this" typically settle for. It is the question every caller asks and the one that does the most damage when answered — ' +
      'they will anchor to it permanently. Say value depends on injuries, treatment, and the specific facts, which is true, and that the attorney will go through it. Then get the consultation booked.',
  },
  {
    id: 'pi.recorded_statement',
    question: 'whether to give the insurance company a recorded statement',
    triggers: [
      /\brecorded statement\b/i,
      /\b(insurance|adjuster|they)\b[^.]{0,40}\b(keeps? calling|want|asking for|pressuring)\b/i,
      /\bshould i (talk to|sign|accept)\b[^.]{0,30}\b(insurance|adjuster|them|the offer)\b/i,
      /\bthey offered me\b/i,
    ],
    source: 'escalate',
    guidance:
      'Do not advise them whether to give a statement, sign anything, or accept an offer — that is legal advice with real consequences. ' +
      'But treat it as urgent: an adjuster actively pressuring someone means the firm wants to speak to them today, not next week. ' +
      'Flag it, capture the carrier and what they are being asked to do, and push hard for the soonest possible contact.',
  },
  {
    id: 'pi.fees',
    question: 'what it costs to hire the firm',
    triggers: [
      /\b(cost|charge|fee|pay|afford|upfront|retainer)\b/i,
      /\bcontingency\b/i,
      /\bonly (if|when) (you|we) win\b/i,
      /\bfree consultation\b/i,
    ],
    source: 'business_config',
    requires: ['pricing'],
    guidance:
      'Do NOT assume a contingency arrangement or say "no fee unless we win" — it is common in this field but it is a specific promise about a specific firm and you have not been told it. ' +
      'If pricing is configured, answer from it. If not, say fee arrangements will be explained at the consultation. Do not quote a percentage.',
  },
  {
    id: 'pi.time_limit',
    question: 'whether it is too late to bring a claim',
    triggers: [
      /\b(too late|still (file|sue|do anything)|deadline|statute of limitations|how long do i have)\b/i,
      /\bit (happened|was) (last|a) (year|month|while)\b/i,
      /\b(two|three|four|\d+) years ago\b/i,
    ],
    source: 'escalate',
    guidance:
      'Deadlines are real, vary by state and claim type, and you must not state one or tell them whether theirs has passed. Getting that wrong could cost someone their claim entirely. ' +
      'Capture the date of the incident precisely — it is the most important fact on this call — and mark it urgent so an attorney can assess timing quickly.',
  },
  {
    id: 'pi.medical_treatment',
    question: 'about their injuries or medical treatment',
    triggers: [
      /\b(hurt|injur\w+|pain|hospital|doctor|er|emergency room|ambulance|surgery|mri|x.?ray|chiropract\w+)\b/i,
      /\bshould i (see|go to) (a )?(doctor|hospital)\b/i,
      /\bmy (neck|back|head|knee|shoulder|arm|leg)\b/i,
    ],
    source: 'needs_more_info',
    guidance:
      'Ask whether they have been seen by a doctor and whether they are still treating — that is standard, necessary intake and the attorney needs it. ' +
      'Do not give medical advice, do not tell them what their injury is, and do not tell them which doctor or clinic to use. ' +
      'If they describe something acute happening right now, tell them to seek care and treat the call as urgent.',
  },
];

export const CRIMINAL_DEFENSE_KNOWLEDGE: KnowledgeEntry[] = [
  ...LEGAL_COMMON,
  {
    id: 'crim.what_will_happen',
    question: 'what sentence or outcome they are facing',
    triggers: [
      /\b(jail|prison|time|sentence|convicted|record|deported|lose my (license|licence|job))\b/i,
      /\bwill i go to jail\b/i,
      /\bhow much trouble\b/i,
      /\bwhat (do|am) i (get|facing|looking at)\b/i,
    ],
    source: 'refuse',
    guidance:
      'Do not predict penalties, describe typical sentences, or reassure them it will probably be fine. You do not know the charge, the jurisdiction, or their record, and a wrong answer here is genuinely harmful. ' +
      'Say an attorney needs to review the specific charge, and focus on getting them seen fast — this is one of the most time-critical intakes there is.',
  },
  {
    id: 'crim.should_i_talk',
    question: 'whether to talk to police or investigators',
    triggers: [
      /\b(should i|do i have to|can i)\b[^.]{0,35}\b(talk|speak|answer|call (them )?back|go in|turn myself in)\b/i,
      /\bthey want to (talk|interview|question)\b/i,
      /\bdetective (called|wants)\b/i,
      /\bwarrant\b/i,
    ],
    source: 'escalate',
    guidance:
      'Do not advise them on this either way. It is one of the highest-stakes decisions in a criminal matter and it belongs to an attorney, immediately. ' +
      'Treat any active police contact, pending interview, or outstanding warrant as urgent: get their name and number and push for a person to call them straight back. ' +
      'Do not ask them to explain what they are accused of doing, and do not record an admission.',
  },
  {
    id: 'crim.court_date',
    question: 'about an upcoming court date',
    triggers: [
      /\b(court|arraign\w+|hearing)\b[^.]{0,35}\b(tomorrow|today|monday|tuesday|wednesday|thursday|friday|next week|the \d+)\b/i,
      /\bi have court\b/i,
      /\bmiss(ed)? (my )?court\b/i,
      /\bfailure to appear\b/i,
    ],
    source: 'escalate',
    guidance:
      'A court date within days is the single most urgent thing this firm can hear. Get the exact date, the county or court, and the charge if they know it. ' +
      'Do not tell them whether it can be continued, whether they must attend, or what happens if they miss it. Escalate immediately — this cannot wait for a callback tomorrow.',
  },
  {
    id: 'crim.bail',
    question: 'about bail, bond, or getting someone out',
    triggers: [
      /\b(bail|bond|get (him|her|them) out|still in (jail|custody)|posted)\b/i,
      /\bbondsman\b/i,
      /\bhow much (is|was) (the )?(bail|bond)\b/i,
    ],
    source: 'needs_more_info',
    guidance:
      'Do not quote bail amounts or explain how to post bond — amounts are set by a court and vary entirely. ' +
      'Someone in custody is time-critical: get the name, where they are held, the charge if known, and the caller\'s relationship to them, then escalate. ' +
      'Do not recommend a specific bail bondsman.',
  },
];

export const PROBATE_KNOWLEDGE: KnowledgeEntry[] = [
  ...LEGAL_COMMON,
  {
    id: 'probate.do_we_need_probate',
    question: 'whether the estate has to go through probate',
    triggers: [
      /\bdo (we|i) (have to|need to) (go through )?probate\b/i,
      /\bcan we avoid probate\b/i,
      /\bis probate (required|necessary)\b/i,
      /\bthere'?s? (a|no) will\b/i,
    ],
    source: 'industry_general',
    guidance:
      'General process is fine: whether probate is required commonly depends on how assets were titled, whether there is a will, and the size of the estate — ' +
      'assets held jointly or with a named beneficiary often pass outside it. Say "generally" and mean it. ' +
      'Do not tell them their estate does or does not need probate. Capture what assets exist and how they are held; that is what the attorney will want.',
  },
  {
    id: 'probate.wont_show_will',
    question: 'about a family member withholding a will or estate information',
    triggers: [
      /\bwon'?t (show|give|tell) (me|us)\b[^.]{0,25}\b(will|anything|account|estate)\b/i,
      /\b(my|our) (brother|sister|sibling|stepmother|stepfather|aunt|uncle)\b[^.]{0,40}\b(took|hiding|won'?t|refuses|controlling)\b/i,
      /\bcut (me|us) out\b/i,
      /\bcontest\w*/i,
    ],
    source: 'needs_more_info',
    guidance:
      'These calls are emotionally loaded and the family conflict is usually the real subject. Do not take sides, do not agree that someone is stealing, and do not tell them whether they can contest anything. ' +
      'Establish the practical facts: who died and when, whether a will exists, whether probate has been opened, and whether anyone is acting as executor. ' +
      'Do not ask them to litigate the family history to you.',
  },
  {
    id: 'probate.how_long',
    question: 'how long probate takes',
    triggers: [
      /\bhow long does (probate|it|this) take\b/i,
      /\bwhen (do|will) (we|i) get\b/i,
      /\bhow soon can we sell\b/i,
    ],
    source: 'industry_general',
    guidance:
      'Generally: simple estates often take several months, contested or complex ones considerably longer, and it varies by state and court. That much is safe. ' +
      'Do not give a timeline for their estate, and do not tell them when they can sell property or distribute anything.',
  },
  {
    id: 'probate.bereavement',
    question: 'about a recent death in the family',
    triggers: [
      /\b(passed away|died|death|funeral|lost (my|our))\b/i,
      /\brecently lost\b/i,
    ],
    source: 'industry_general',
    guidance:
      'Say you are sorry, once, and mean it — then be useful, because most people calling a probate line want competence more than sympathy. ' +
      'Do not rush into a questionnaire, and do not ask for a death certificate number in the same breath as condolences. ' +
      'Let them tell it in their own order and pick up the facts as they go.',
  },
];
