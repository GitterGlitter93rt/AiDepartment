// Questions every business gets, regardless of trade.
//
// Merged into every industry's bank so twenty-nine files do not each
// reinvent "are you a robot" and "let me talk to a person".

import type { KnowledgeEntry } from './types.ts';

export const UNIVERSAL_KNOWLEDGE: KnowledgeEntry[] = [
  // ---------- identity ----------
  {
    id: 'universal.are_you_ai',
    question: 'whether they are talking to a real person',
    triggers: [
      /\bare you (a )?(real )?(person|human|robot|bot|machine|ai|a\.?i\.?)\b/i,
      /\bis this (a )?(real person|human|robot|bot|recording|machine|ai)\b/i,
      /\bam i talking to (a )?(person|human|robot|computer|machine)\b/i,
      /\byou'?re? (a )?(robot|bot|computer|ai|machine)\b/i,
      /\bthis is a recording\b/i,
    ],
    source: 'industry_general',
    guidance:
      'Tell the truth immediately and without drama: you are an AI assistant handling the first part of the call and scheduling. ' +
      'One sentence, then carry straight on with what you were doing — do not apologise for it, do not explain how you work, ' +
      'and do not ask permission to continue. If they would rather speak to a person, offer that.',
  },

  // ---------- human ----------
  {
    id: 'universal.human_request',
    question: 'to speak to a person',
    triggers: [
      /\b(speak|talk) (to|with) (a |an )?(real )?(person|human|someone|somebody|agent|representative|attorney|lawyer|manager|owner)\b/i,
      /\b(get|give) me (a|an) (real )?(person|human|someone|somebody)\b/i,
      /\btransfer me\b/i, /\bput me through\b/i,
      /\bi don'?t (want|wanna) (to )?(talk|speak)( to)?( an?)? (ai|robot|bot|computer|machine)\b/i,
      /\bis (there )?(anyone|somebody|someone) else\b/i,
      /\breal person\b/i,
    ],
    source: 'escalate',
    guidance:
      'Do not argue, do not try one more question first, and do not ask them to explain why. ' +
      'If a transfer is available, say you will connect them and use the transfer tool. ' +
      'If it is not, say so plainly and take a name and number so someone can call them back — ' +
      'and never claim a transfer happened unless the tool confirmed it.',
  },

  // ---------- unwilling ----------
  {
    id: 'universal.wont_give_info',
    question: 'why you need a piece of information, or refusing to give it',
    triggers: [
      /\bwhy (do you|would you) need (my|that)\b/i,
      /\bi (don'?t|do not) (want|wanna) (to )?(give|share|provide)\b/i,
      /\bi'?ll (give|tell) that to the (lawyer|attorney|technician|agent|person)\b/i,
      /\brather not (say|give|share)\b/i,
      /\bnone of your business\b/i,
      /\bwhy (are you|do you) ask\w*\b/i,
      /\bdo i have to\b/i,
    ],
    source: 'industry_general',
    guidance:
      'Never push back twice. Give the real one-line reason you asked, then let it go and move on: ' +
      '"Totally fine — I just use it to make sure the right person calls you back." ' +
      'Required items are the exception: if you genuinely cannot proceed without it, say what it blocks and offer the alternative. ' +
      'Everything else stays unknown, and the call continues.',
  },

  // ---------- existing customer ----------
  {
    id: 'universal.existing_customer',
    question: 'about work already done or an account they already have',
    triggers: [
      /\byou (guys )?(did|fixed|repaired|installed|came out|were out|serviced)\b/i,
      /\b(last|this) (week|month|year)\b[^.]{0,40}\b(you|your (guys|team|crew))\b/i,
      /\bi'?m (already )?a (customer|client)\b/i,
      /\bmy (account|invoice|bill|file|case|order|policy)\b/i,
      /\bi (already )?have an appointment\b/i,
      /\bcalling about (my|the) (invoice|bill|estimate|quote|job|repair)\b/i,
    ],
    source: 'escalate',
    guidance:
      'You have no access to customer records and must not pretend otherwise — never confirm an account, a balance, a booking or a job status. ' +
      'Say you can get them to the right person, take their name, the number on the account, and one line about what it concerns, ' +
      'then offer a transfer or a callback. Do not run new-lead intake on an existing customer; it is the fastest way to annoy one.',
  },

  // ---------- complaint ----------
  {
    id: 'universal.complaint',
    question: 'to complain about something that went wrong',
    triggers: [
      /\b(unacceptable|ridiculous|terrible|awful|horrible|worst)\b/i,
      /\bnobody (called|showed|came|got back)\b/i,
      /\bstill (waiting|haven'?t heard)\b/i,
      /\bi'?ve called (three|four|five|\d+) times\b/i,
      /\b(complaint|complain|frustrated|fed up|sick of)\b/i,
      /\bmade it worse\b/i,
    ],
    source: 'escalate',
    guidance:
      'Acknowledge it once, specifically and without grovelling — "That is not how it should have gone" — and do not become defensive. ' +
      'Do not explain, excuse, or offer a theory about what happened. Get their name, number and the short version, ' +
      'and get it to a person quickly. A complaint handled by a form is a complaint that becomes a review.',
  },

  // ---------- wrong number / out of scope ----------
  {
    id: 'universal.wrong_business',
    question: 'something this business does not do',
    triggers: [
      /\bdo you (also |guys )?(do|handle|work on|offer|sell)\b/i,
      /\bis this\b[^.]{0,25}\b(the )?(right )?(place|number|company)\b/i,
      /\bwrong (number|department|place)\b/i,
      /\bwho do i call for\b/i,
    ],
    source: 'needs_more_info',
    guidance:
      'Find out what they actually need before answering. If it is clearly outside this trade, say so simply and, if you can, name the kind of business that does handle it — ' +
      'do not recommend a specific company you cannot vouch for. If it is arguably adjacent, do not rule it out; take the details and let a person decide.',
  },

  // ---------- pricing, the universal version ----------
  {
    id: 'universal.price_pressure',
    question: 'a price, after you have already said you do not have one',
    triggers: [
      /\bjust (give|gimme) me a (ballpark|range|rough|number|estimate|idea)\b/i,
      /\broughly how much\b/i, /\bballpark\b/i,
      /\bwhat do you (usually|normally|typically) charge\b/i,
      /\bcome on\b[^.]{0,25}\bprice\b/i,
    ],
    source: 'business_config',
    requires: ['pricing'],
    guidance:
      'Hold the line without sounding evasive. You genuinely do not have their pricing in front of you, and a number you invent will be contradicted by the first person they speak to. ' +
      'Say that honestly, once, and immediately give them the thing that does move it forward — ' +
      '"What I can do is get someone out to look and give you a real number." Do not repeat the refusal a third time; book or take details.',
  },

  // ---------- availability ----------
  {
    id: 'universal.charge_to_come_out',
    question: 'whether it costs anything just to come out and look',
    triggers: [
      /\bdo you charge\b/i,
      /\b(is|are)\b[^.]{0,20}\b(the )?(estimate|quote|inspection|visit|consultation)s?\b[^.]{0,20}\bfree\b/i,
      /\bfree\b[^.]{0,25}\b(estimate|quote|inspection|consultation|visit)\b/i,
      /\b(cost|charge|fee)\b[^.]{0,30}\b(come out|look at it|take a look|stop by)\b/i,
      /\bwhat(?:'s| is) it (going to )?cost\b/i,
      /\bhow much (do you|would it|does it)\b/i,
    ],
    source: 'business_config',
    requires: ['pricing'],
    guidance:
      'They are asking this to decide whether to book, so answer it and then book. ' +
      'If pricing is configured, say it plainly. If not, do not guess and do not say it is "usually free" — ' +
      'say you do not have the fee in front of you and it will be confirmed when the appointment is set.',
  },
  {
    id: 'universal.hours',
    question: 'what hours the business keeps',
    triggers: [
      /\bwhat (time|hours) (are|do) you (open|close|work)\b/i,
      /\bare you open (on |this )?(saturday|sunday|weekend|late|today|now)\b/i,
      /\bdo you work (weekends|saturdays|sundays|nights|after hours)\b/i,
      /\bhow late are you (open|there)\b/i,
    ],
    source: 'business_config',
    requires: ['hours'],
    guidance:
      'If hours are configured, state them plainly. If not, say you do not have the schedule in front of you and offer to find them a time — ' +
      'checking availability answers the real question underneath, which is "can someone come when I need them".',
  },
  {
    id: 'universal.service_area',
    question: 'whether the business covers their location',
    triggers: [
      /\bdo you (come out to|service|cover|work in|go (out )?to)\b/i,
      /\bare you in\b[^.]{0,20}\barea\b/i,
      /\bhow far (do you|will you) (go|travel|come)\b/i,
      /\bam i (in|inside) your (service )?area\b/i,
    ],
    source: 'business_config',
    requires: ['serviceArea'],
    guidance:
      'If the service area is configured, check their town against it and answer directly. ' +
      'If it is not, do not guess — take the address and say someone will confirm coverage when they call back. ' +
      'Telling a caller you cover them when you do not wastes a truck roll and a customer.',
  },

  // ---------- credentials ----------
  {
    id: 'universal.licensed_insured',
    question: 'whether the business is licensed, insured, or experienced',
    triggers: [
      /\bare you (licensed|insured|bonded|certified|accredited)\b/i,
      /\bhow long have you (been|guys been)\b/i,
      /\byears (of experience|in business)\b/i,
      /\bcan i see your (licence|license|insurance)\b/i,
      /\bbbb\b/i, /\bcheck your (reviews|rating)\b/i,
    ],
    source: 'business_config',
    requires: ['licensing'],
    guidance:
      'This is a trust question and it deserves a straight answer, not a dodge. ' +
      'If licensing details are configured, give them. If not, say you do not have those specifics in front of you and that whoever calls back can provide them — ' +
      'and never assert a licence, a bond, an insurance policy, or a number of years in business that you were not given. Claiming a licence you do not hold is not a small error.',
  },
  {
    id: 'universal.warranty',
    question: 'whether the work is guaranteed',
    triggers: [
      /\b(warranty|guarantee|guaranteed|warrantied)\b/i,
      /\bwhat if it (breaks|fails|goes wrong) again\b/i,
      /\bdo you stand behind\b/i,
    ],
    source: 'business_config',
    requires: ['warranty'],
    guidance:
      'State the warranty only if it is configured. Otherwise say you do not have the warranty terms in front of you and someone will go through them — ' +
      'a promised guarantee that turns out not to exist is a dispute, not a sale.',
  },
  {
    id: 'universal.financing',
    question: 'about payment plans or financing',
    triggers: [
      /\b(financ\w+|payment plan|monthly payments|pay over time|installments?)\b/i,
      /\bcan i pay (it )?(off|later|monthly)\b/i,
      /\bdo you take (cards|credit|checks?|cash)\b/i,
    ],
    source: 'business_config',
    requires: ['financing'],
    guidance:
      'Answer from the profile if financing is configured. If not, say you do not have the payment options in front of you but will note that they asked, so the person who follows up leads with it. ' +
      'Someone asking about financing is telling you the price matters — capture that, do not brush past it.',
  },

  // ---------- scheduling changes ----------
  {
    id: 'universal.reschedule',
    question: 'to move or cancel an existing appointment',
    triggers: [
      /\b(reschedul\w+|move|change|push (back|out)|cancel)\b[^.]{0,30}\b(appointment|booking|visit|time|slot|consultation)\b/i,
      /\b(appointment|booking|visit)\b[^.]{0,30}\b(reschedul\w+|cancel|move|change)\w*/i,
      /\bcan'?t make (it|the appointment)\b/i,
      /\bneed to (push|move) (it|that)\b/i,
    ],
    source: 'escalate',
    guidance:
      'You cannot see existing bookings, so do not confirm one exists, do not state its time, and above all do not say it has been changed or cancelled. ' +
      'Take their name, number, and what they want to happen, then get it to a person or offer to book a fresh time. ' +
      'Telling someone their appointment is cancelled when you have not cancelled anything is how a customer sits at home waiting.',
    },
  {
    id: 'universal.how_soon',
    question: 'how soon someone can come out',
    triggers: [
      /\bhow (soon|quickly|fast|long)\b[^.]{0,35}\b(come|get|be) (out|here|there)\b/i,
      /\bwhen can (you|someone|somebody)\b/i,
      /\bcan (you|somebody|someone) come (out )?(today|tomorrow|now)\b/i,
      /\bearliest\b/i,
      /\bsame day\b/i,
    ],
    source: 'schedule',
    guidance:
      'Do not answer this from imagination — check the calendar and offer real times. ' +
      'Never promise a window like "within the hour" that nobody has committed to. ' +
      'If the situation is urgent, say it will be treated as urgent and get a person on it, rather than inventing an arrival time.',
  },
];
