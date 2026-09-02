import type { KnowledgeEntry } from './types.ts';

/**
 * Exterior cleaning.
 *
 * The defining feature of these calls is that the caller almost never
 * knows the vocabulary. They do not say "soft wash" or "organic
 * growth"; they say the side of their house has green stuff on it. The
 * knowledge here is mostly about understanding what they mean.
 */
export const PRESSURE_WASHING_KNOWLEDGE: KnowledgeEntry[] = [
  {
    id: 'pw.green_stuff',
    question: 'about green, black, or dirty growth on a surface',
    triggers: [
      /\b(green|black|dark|grey|gray)\b[^.]{0,25}\b(stuff|crap|junk|gunk|stains?|streaks?|film|slime)\b/i,
      /\b(mold|mould|mildew|algae|moss|lichen)\b/i,
      /\b(dirty|filthy|nasty|disgusting|gross|awful)\b[^.]{0,30}\b(house|siding|driveway|roof|deck|patio|fence)\b/i,
      /\blooks (terrible|awful|bad|horrible)\b/i,
    ],
    source: 'industry_general',
    guidance:
      'This is the most common way these calls open and it is not a hard diagnosis: green or black growth on siding, roofs, and north-facing surfaces is almost always organic — ' +
      'algae, mildew, or lichen — and it is what exterior cleaning removes. Say that plainly so they feel understood, without turning it into a lecture. ' +
      'What actually matters for the quote is the surface and the size, so ask that: which surfaces, roughly how big, and how many storeys.',
  },
  {
    id: 'pw.will_it_damage',
    question: 'whether the cleaning will damage the surface',
    triggers: [
      /\b(damage|hurt|ruin|strip|blast|break|crack|harm)\b[^.]{0,35}\b(paint|siding|shingles?|roof|wood|screens?|windows|plants?|stucco)\b/i,
      /\bis it safe (for|on)\b/i,
      /\btoo (much|high) pressure\b/i,
      /\bmy plants\b/i,
    ],
    source: 'industry_general',
    guidance:
      'A fair and reassuring general answer: not every surface gets the same treatment. High pressure suits concrete, while siding, painted wood, and roofs are normally cleaned with low pressure and cleaning solution — ' +
      'that is what "soft washing" means, and it is worth naming since they may have heard it. Reputable operators rinse and protect landscaping. ' +
      'Do not guarantee no damage on their specific property, and do not promise a particular method before anyone has seen it.',
  },
  {
    id: 'pw.roof_cleaning_safe',
    question: 'whether cleaning a roof will harm it',
    triggers: [
      /\broof\b[^.]{0,40}\b(safe|damage|shingles?|void|warranty|pressure)\b/i,
      /\bpressure wash (my |the )?roof\b/i,
      /\bblack streaks\b/i,
    ],
    source: 'industry_general',
    guidance:
      'The black streaks on a shingle roof are almost always algae rather than dirt or damage — worth saying, because most callers assume the roof is failing. ' +
      'Generally true and safe: roofs are soft washed, not pressure washed; high pressure strips granules and can genuinely shorten a roof\'s life. ' +
      'Do not comment on whether cleaning affects their manufacturer warranty, and do not promise the streaks will never return.',
  },
  {
    id: 'pw.price_per_area',
    question: 'a price for the cleaning',
    triggers: [
      /\bhow much\b/i, /\bwhat (do|would) (you|it) (charge|cost)\b/i,
      /\bprice (for|on)\b/i, /\bper (square )?(foot|ft)\b/i,
      /\bballpark\b/i,
    ],
    source: 'business_config',
    requires: ['pricing'],
    guidance:
      'Do not invent a square-foot rate or a flat price. What you can honestly say is what the price depends on — the surfaces, the square footage, the number of storeys, ' +
      'how heavy the growth is, and access. Gather exactly those, because that is what turns into a real quote. ' +
      'Many of these jobs can be quoted from an address and a walk-around, so offer that as the next step rather than leaving them with nothing.',
  },
  {
    id: 'pw.how_long_lasts',
    question: 'how long the results last',
    triggers: [
      /\bhow long (does it|will it|before it)\b[^.]{0,25}\b(last|stay|come back|grow back)\b/i,
      /\bhow often (should|do i need)\b/i,
      /\bwill it come back\b/i,
    ],
    source: 'industry_general',
    guidance:
      'General and true: it depends on shade, moisture, and tree cover, and most properties are done somewhere between annually and every couple of years — heavily shaded or humid ones sooner. ' +
      'Growth does come back; saying otherwise sets up a complaint. This is a natural moment to ask whether they would want it on a recurring schedule, which is worth real money to the business.',
  },
  {
    id: 'pw.commercial_recurring',
    question: 'about commercial or recurring cleaning',
    triggers: [
      /\b(commercial|storefront|restaurant|shopping cent\w+|hoa|apartment|property manage\w+|multiple properties|our buildings?)\b/i,
      /\b(monthly|quarterly|weekly|recurring|contract|regular)\b/i,
      /\bdumpster pad\b/i, /\bdrive.?thru\b/i,
    ],
    source: 'needs_more_info',
    guidance:
      'Commercial and recurring work is the most valuable thing on this line, so slow down and treat it properly rather than rushing to book a one-off. ' +
      'Establish the number of properties or locations, the surfaces, the frequency they have in mind, and crucially whether cleaning has to happen outside business hours — ' +
      'restaurants and storefronts usually do. Get a decision-maker\'s name and number. This warrants a person calling back, not just a slot.',
  },
  {
    id: 'pw.do_i_need_to_be_home',
    question: 'whether they need to be there',
    triggers: [
      /\bdo i (need|have) to be (home|there|present)\b/i,
      /\bcan you do it (while|when) i'?m (at work|out|away|gone)\b/i,
      /\bwhat do you need from me\b/i,
    ],
    source: 'industry_general',
    guidance:
      'Generally exterior work does not require anyone home, though water access is normally needed and gates need to be unlocked — that much is safe and useful. ' +
      'Do not commit to their specific job being unattended; note it and let whoever confirms the appointment settle it.',
  },
  {
    id: 'pw.water_electric',
    question: 'about using their water or power',
    triggers: [
      /\b(my|your own|use my) (water|hose|spigot|electricity|power)\b/i,
      /\bwater bill\b/i,
      /\bdo you bring\b/i,
    ],
    source: 'business_config',
    requires: ['services'],
    guidance:
      'Practice varies — some operators bring tanks, most use the property\'s spigot. Do not assert either without configuration. ' +
      'Take the question, note it, and confirm when the appointment is set. Worth checking whether they have a working outside tap, since it occasionally matters.',
  },
  {
    id: 'pw.surfaces_covered',
    question: 'whether a particular surface can be cleaned',
    triggers: [
      /\bdo you (do|clean|wash|handle)\b[^.]{0,35}\b(driveways?|sidewalks?|patios?|decks?|fences?|pavers?|pool (deck|cage)|screens?|gutters?|windows?|dumpster|boats?|solar panels?)\b/i,
      /\bcan you clean\b/i,
    ],
    source: 'business_config',
    requires: ['services'],
    guidance:
      'Most exterior cleaners cover concrete, siding, decks and fences, but window cleaning, gutter interiors, screen enclosures and solar panels are often separate services or separate companies. ' +
      'Do not assume. Answer from the service list if configured; otherwise capture what they want cleaned and confirm it. The list of surfaces is what the quote is built from anyway.',
  },
];
