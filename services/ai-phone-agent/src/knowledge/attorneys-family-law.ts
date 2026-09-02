import type { KnowledgeEntry } from './types.ts';

/**
 * Family law intake.
 *
 * The hardest line in the whole system runs through this file: general
 * process information is helpful and legitimate; legal advice is not
 * ours to give. "Divorce usually starts with a petition" is process.
 * "You will probably get the house" is advice, and it is also a
 * prediction the caller will remember and repeat.
 */
export const FAMILY_LAW_KNOWLEDGE: KnowledgeEntry[] = [
  // ---------- the advice line ----------
  {
    id: 'family.predict_outcome',
    question: 'you to predict how their case will turn out',
    triggers: [
      /\b(do you think|will i|would i|am i (going to|gonna)|what are my chances|my odds)\b[^.]{0,45}\b(get|win|lose|keep|custody|house|support|alimony)\b/i,
      /\bwho (usually |normally )?(gets|wins)\b/i,
      /\bcan (she|he|they) (really |actually )?(take|get)\b/i,
      /\bis that fair\b/i,
      /\bwhat (would|should) i (get|expect)\b/i,
    ],
    source: 'refuse',
    guidance:
      'Do not predict, do not hedge into a prediction ("often the mother..."), and do not say what usually happens in cases like theirs — ' +
      'they will hear it as a promise and repeat it to the attorney. Say honestly that outcomes turn on specifics only an attorney can weigh, ' +
      'and that getting them in front of one is exactly what you are here to do. Then keep gathering. ' +
      'Answer the fear underneath rather than the question: taking their situation down carefully IS the reassurance.',
  },
  {
    id: 'family.what_should_i_do',
    question: 'what they should do next, legally',
    triggers: [
      /\bshould i (file|leave|move out|stay|sign|agree|take|hire|respond|answer)\b/i,
      /\bwhat should i do\b/i,
      /\bdo i (have to|need to) (respond|answer|file|show up|sign)\b/i,
      /\bcan i (just )?(take|keep|move|leave with) the (kids|children|car|money)\b/i,
    ],
    source: 'refuse',
    guidance:
      'This is legal advice and you do not give it, however sympathetic the question. Do not tell them to move out, stay put, sign, refuse to sign, or take the children anywhere. ' +
      'What you CAN do is flag urgency: if they mention a deadline, a hearing, or having been served, say that timing matters and press to get them seen quickly. ' +
      'If they are asking because they are frightened rather than strategising, treat it as a safety question instead.',
  },
  {
    id: 'family.hide_assets',
    question: 'help doing something improper',
    triggers: [
      /\b(hide|move|empty|drain|transfer|conceal)\b[^.]{0,35}\b(money|account|assets?|cash|funds)\b/i,
      /\bbefore (she|he|they) finds? out\b/i,
      /\bcan i (take|withdraw) (it |the money )?(all )?out\b/i,
      /\bkeep (it |this )?off the (paperwork|record)\b/i,
      /\bnot (report|disclose|mention)\b/i,
    ],
    source: 'refuse',
    guidance:
      'Do not help, do not suggest how, and do not explore it with them. Say simply that anything to do with accounts and disclosure needs to come from the attorney directly, ' +
      'and move the conversation on without lecturing them about it. Do not accuse them of anything and do not record a judgement about their intent — ' +
      'people ask this out of panic as often as calculation.',
  },
  {
    id: 'family.general_process',
    question: 'how the divorce process generally works',
    triggers: [
      /\bhow (does|do) (this|it|divorce|custody|the process)\b[^.]{0,25}\bwork\b/i,
      /\bwhat happens (next|first|now|after)\b/i,
      /\bhow long does (a )?divorce take\b/i,
      /\bwhat'?s? the (process|first step)\b/i,
    ],
    source: 'industry_general',
    guidance:
      'General process is fine and genuinely calming, as long as it stays general and you say so. ' +
      'A case typically starts with a petition, the other side is served and has a window to respond, temporary arrangements can be addressed early where they are needed, ' +
      'and uncontested matters resolve far faster than contested ones. Timelines vary by state and by court. ' +
      'Say "generally" and mean it, then bring it back to the consultation, where their actual situation gets addressed.',
  },

  // ---------- safety ----------
  {
    id: 'family.safety',
    question: 'about their safety or the children\'s safety',
    triggers: [
      /\b(hit|hurt|threatened|threw|choked|punched|slapped|attacked|shoved)\b[^.]{0,25}\b(me|us|the kids|my son|my daughter)\b/i,
      /\b(afraid|scared|terrified|frightened)\b[^.]{0,30}\b(of him|of her|of them|for my|to go home)\b/i,
      /\b(protective|restraining) order\b/i,
      /\bdomestic violence\b/i,
      /\bhas a gun\b/i,
      /\bnot safe\b/i,
    ],
    source: 'escalate',
    guidance:
      'Stop the intake. This stops being a legal call and becomes a safety call, and everything else can wait. ' +
      'Ask one question — whether they are safe right now — and listen to the answer. If they are in immediate danger, tell them to hang up and call 911. ' +
      'You can mention that the National Domestic Violence Hotline is 1-800-799-7233 and available around the clock. ' +
      'Do not ask them to describe what happened in detail, do not ask what they did to cause it, and do not offer any opinion on what they should do. ' +
      'Flag the matter as urgent and get a person involved. Do not go back to the questionnaire as though nothing was said.',
  },
  {
    id: 'family.kids_taken',
    question: 'their children having been taken or withheld',
    triggers: [
      /\b(took|taken|has|kept|won'?t (let me see|give back|bring back))\b[^.]{0,35}\b(the kids|the children|my son|my daughter|them)\b/i,
      /\bhaven'?t seen (my|the) (kids|children|son|daughter)\b/i,
      /\bleft with the (kids|children)\b/i,
      /\bwon'?t (let me|allow me)\b/i,
    ],
    source: 'needs_more_info',
    guidance:
      'Treat this as time-sensitive without alarming them further. Find out whether any court order already exists, how long it has been, and whether the children are believed to be safe — ' +
      'that last one changes the call entirely and may make it a safety matter. ' +
      'Do not tell them whether it is legal, whether it counts as anything, or what to do about it. Do not suggest they go and collect the children. Push for the soonest consultation.',
  },

  // ---------- money ----------
  {
    id: 'family.consultation_cost',
    question: 'what a consultation costs',
    triggers: [
      /\b(consultation|consult|first (visit|meeting|appointment))\b[^.]{0,30}\b(cost|charge|free|price|fee|much)\b/i,
      /\bhow much\b[^.]{0,30}\b(consult|meet|talk to (a|an) (lawyer|attorney))\b/i,
      /\bis (the )?(first )?(consult\w*|meeting) free\b/i,
    ],
    source: 'business_config',
    requires: ['pricing'],
    guidance:
      'Never guess at this, and never say "usually free" — a caller who was told free and then charged is a complaint, and one told it costs when it does not may hang up. ' +
      'If pricing is configured, answer directly. If not, say you do not have the fee structure in front of you and it will be confirmed when they book. Then get them booked.',
  },
  {
    id: 'family.retainer_cost',
    question: 'what the whole case will cost, or the retainer',
    triggers: [
      /\b(retainer|how much (will|would) (this|the whole thing|a divorce) cost|total cost|end up costing)\b/i,
      /\bcan i afford\b/i,
      /\bpayment plan\b/i,
      /\bcheaper (way|option)\b/i,
    ],
    source: 'business_config',
    requires: ['pricing'],
    guidance:
      'Cost depends on whether it is contested, what is disputed, and how the other side behaves — that much is safe to say, and it is genuinely why nobody can quote it by phone. ' +
      'Do not name a figure or a range. If they are worried about affording it, note that they raised it so the attorney leads with it, and mention that uncontested matters generally cost less than contested ones. ' +
      'That last point is process, not a quote.',
  },

  // ---------- practicalities ----------
  {
    id: 'family.been_served',
    question: 'about having been served with papers',
    triggers: [
      /\b(served|got served|serve[d]? me|papers were served)\b/i,
      /\bgot (divorce )?papers\b/i,
      /\bhave to respond by\b/i,
      /\b(twenty|20|thirty|30) days\b/i,
    ],
    source: 'needs_more_info',
    guidance:
      'Being served starts a clock, and that is the single most important thing to establish. Find out what date they were served and whether the papers state a deadline — ask them to read it if they have it to hand. ' +
      'Do not tell them what happens if they miss it, do not tell them what to file, and do not interpret the document. Mark it urgent and get them the earliest consultation.',
  },
  {
    id: 'family.already_has_lawyer',
    question: 'about switching attorneys or already having one',
    triggers: [
      /\bi (already )?have (a|an) (lawyer|attorney)\b/i,
      /\bmy (current |other )?(lawyer|attorney)\b/i,
      /\bfire (my|the) (lawyer|attorney)\b/i,
      /\bsecond opinion\b/i,
      /\bswitch(ing)? (lawyers|attorneys|firms)\b/i,
    ],
    source: 'needs_more_info',
    guidance:
      'Note it and keep going — it is a normal reason to call. Find out whether they are still represented, since that affects whether and how the firm can speak with them. ' +
      'Do not criticise the other attorney, do not agree that they are being badly handled, and do not advise them to fire anyone. If the other side is represented, capture opposing counsel\'s name.',
  },
  {
    id: 'family.hearing_soon',
    question: 'about an upcoming court date',
    triggers: [
      /\b(court|hearing|trial|mediation)\b[^.]{0,30}\b(tomorrow|monday|tuesday|wednesday|thursday|friday|next week|on the \d+|this week)\b/i,
      /\bi have court\b/i,
      /\bhearing (is )?(coming up|scheduled)\b/i,
    ],
    source: 'escalate',
    guidance:
      'A hearing within days changes everything about how fast this needs to move, and may mean the firm cannot take it in time. ' +
      'Get the exact date and what kind of hearing it is. Do not promise anyone will appear, do not say it can be postponed, and do not reassure them it will be fine. ' +
      'Mark it urgent and get a person on it today.',
  },
  {
    id: 'family.jurisdiction',
    question: 'about which state or county the case belongs in',
    triggers: [
      /\b(what|which) (state|county|court)\b/i,
      /\bwe (live|moved) (in|to) different\b/i,
      /\bi moved (here|to)\b/i,
      /\bshe (lives|moved) (in|to)\b/i,
      /\bfile (it )?(here|there|in)\b/i,
    ],
    source: 'needs_more_info',
    guidance:
      'Where each spouse lives and how long they have lived there genuinely matters, and the firm needs it early because it decides whether they can take the case at all. ' +
      'Capture both locations and roughly how long. Do not tell them which court has jurisdiction or where they should file.',
  },
  {
    id: 'family.uncontested',
    question: 'whether they can do a simple or uncontested divorce',
    triggers: [
      /\b(uncontested|amicable|we (both )?agree|no (fighting|dispute)|simple divorce|friendly)\b/i,
      /\bjust need the paperwork\b/i,
      /\bdo it ourselves\b/i,
      /\bcheap(est)? (way|option)\b/i,
    ],
    source: 'industry_general',
    guidance:
      'Fine to explain generally that where both people agree on everything the process is usually simpler and faster than a contested case. ' +
      'Do not confirm that theirs qualifies, and do not tell them they do not need an attorney. Worth capturing gently: whether they agree on the children, the house, and the money specifically — ' +
      'callers frequently say "we agree on everything" and then list three things they do not agree on.',
  },
];
