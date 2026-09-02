import type { KnowledgeEntry } from './types.ts';

export const ROOFING_KNOWLEDGE: KnowledgeEntry[] = [
  {
    id: 'roofing.insurance_will_cover',
    question: 'whether insurance will pay for the roof',
    triggers: [
      /\b(insurance|policy|claim|adjuster)\b[^.]{0,45}\b(cover|pay|approve|covered|paid)\b/i,
      /\bwill (my )?insurance\b/i,
      /\bdo you think (they|insurance) will\b/i,
      /\bis (this|it) covered\b/i,
    ],
    source: 'industry_general',
    guidance:
      'Never predict a coverage decision or say a claim will be approved — the adjuster decides, and a roofer who promises coverage creates a furious customer. ' +
      'What is safe and useful: storm and hail damage is commonly claimed while age and wear generally are not, and carriers usually want it reported reasonably promptly. ' +
      'Practical help they will actually value: photograph everything before any repair, keep any pieces that came off, and note the date of the storm. Then get the inspection booked.',
  },
  {
    id: 'roofing.denied_claim',
    question: 'about a claim that was denied or underpaid',
    triggers: [
      /\b(denied|rejected|turned down|underpaid|lowball\w*|not enough)\b[^.]{0,35}\b(claim|insurance|adjuster)\b/i,
      /\bclaim (was )?denied\b/i,
      /\bthey only (gave|offered|paid)\b/i,
      /\bfight the (claim|insurance)\b/i,
    ],
    source: 'needs_more_info',
    guidance:
      'A denial is not necessarily the end and it is fair to say so, but do not promise it can be overturned, do not call the adjuster wrong, and do not advise them to hire a public adjuster or a lawyer. ' +
      'Get the carrier, the claim number if they have it, the date of loss, and the stated reason for denial. This is a call a person should return quickly — it is a real opportunity and it is time-sensitive.',
  },
  {
    id: 'roofing.ceiling_stain',
    question: 'what a brown spot or stain on the ceiling means',
    triggers: [
      /\b(brown|dark|yellow|water) (spot|stain|mark|patch|ring)\b/i,
      /\bceiling (is )?(turning|going) (brown|dark|yellow)\b/i,
      /\bsagging ceiling\b/i,
      /\bbubbl\w+\b[^.]{0,25}\b(paint|ceiling)\b/i,
    ],
    source: 'needs_more_info',
    guidance:
      'Do not assume it is the roof. Water travels, and the same stain comes from a roof leak, a burst supply line upstairs, an AC condensate drain backing up, or a bathroom above. ' +
      'Ask the questions that actually separate them: did it appear during or right after rain, is there a bathroom or an air handler above it, and is it still spreading. ' +
      'A stain that appears in dry weather is very often not the roof. Say a spreading or sagging patch should be looked at soon, and keep anyone from standing under it.',
  },
  {
    id: 'roofing.roof_age',
    question: 'whether the roof needs replacing or can be repaired',
    triggers: [
      /\b(repair|patch|fix) (it|the roof)\b[^.]{0,25}\b(or|instead of|rather than)\b/i,
      /\bdo i need a (whole |full |complete )?new roof\b/i,
      /\bhow long (do|should) (a )?roofs? last\b/i,
      /\b(worth|better) (repairing|replacing)\b/i,
    ],
    source: 'needs_more_info',
    guidance:
      'General life expectancy is fine to give: architectural shingle commonly runs twenty to thirty years, three-tab less, metal and tile considerably longer, and heat and storms shorten all of it. ' +
      'Do not tell them theirs needs replacing sight unseen. Ask the age, the material, and whether the damage is in one area or spread across the roof — ' +
      'localised damage on a young roof usually repairs, widespread damage on an old one usually does not. Then book the inspection.',
  },
  {
    id: 'roofing.tarp_emergency',
    question: 'what to do right now about water coming in',
    triggers: [
      /\b(tarp|cover it|stop the water|what do i do)\b/i,
      /\bwater (is )?(pouring|coming) in\b/i,
      /\bbuckets?\b/i,
      /\bcan you come (out )?(tonight|now|today)\b/i,
    ],
    source: 'industry_general',
    guidance:
      'Sensible immediate steps are worth giving: move what can be moved out of the way, put something down to catch it, and if a ceiling is bulging with trapped water, ' +
      'stay clear of it rather than standing underneath. Never suggest anyone climb onto a wet or storm-damaged roof, and do not talk them through tarping it themselves — ' +
      'people die falling off roofs after storms. Treat active water intrusion as urgent and get someone dispatched.',
  },
  {
    id: 'roofing.free_inspection',
    question: 'whether the inspection or estimate costs anything',
    triggers: [
      /\b(free|cost|charge|fee)\b[^.]{0,30}\b(inspection|estimate|quote|come out|look)\b/i,
      /\bdo you charge (just )?to (look|come out|inspect)\b/i,
    ],
    source: 'business_config',
    requires: ['pricing'],
    guidance:
      'Do not assume it is free just because roofing inspections often are. If pricing is configured, answer from it; otherwise say you will have that confirmed when they book. ' +
      'Then move straight to scheduling, because they are asking this in order to decide whether to book.',
  },
  {
    id: 'roofing.materials',
    question: 'whether the business works on their roof type',
    triggers: [
      /\b(metal|tile|slate|flat|tpo|epdm|modified bitumen|cedar|shake|clay|concrete tile)\b[^.]{0,25}\broof\b/i,
      /\bdo you (do|work on|handle)\b[^.]{0,25}\b(metal|tile|flat|commercial|slate)\b/i,
    ],
    source: 'business_config',
    requires: ['services'],
    guidance:
      'Roof types genuinely split the trade — plenty of shingle roofers do not touch tile or flat commercial systems. Do not assume coverage. ' +
      'Answer from the service list if configured, otherwise take the roof type and confirm later. Capturing the material is useful regardless, since it determines who gets sent.',
  },
  {
    id: 'roofing.commercial_roof',
    question: 'about a commercial or flat roof',
    triggers: [
      /\b(commercial|business|warehouse|office building|strip mall|apartment|flat roof)\b/i,
      /\bour building\b/i,
    ],
    source: 'business_config',
    requires: ['services'],
    guidance:
      'Commercial is often a separate crew and separate licensing. Do not assume. Capture the building type, the roof system if they know it, the approximate square footage, ' +
      'and whether the leak is currently affecting operations or tenants — that sets urgency more than anything else on a commercial job.',
  },
  {
    id: 'roofing.how_long_job',
    question: 'how long the roof work will take',
    triggers: [
      /\bhow long (does|will|would) (it|the (job|work|roof))\b/i,
      /\bhow many days\b/i,
      /\bwhen (would|could) you (start|finish)\b/i,
    ],
    source: 'industry_general',
    guidance:
      'A typical residential re-roof is often a day or two of actual work, weather permitting, while repairs are usually much shorter — that much is general and fine. ' +
      'Do not commit to a start date, a finish date, or a crew size. Scheduling depends on their calendar, the weather, and materials, and the person following up owns that.',
  },
];
