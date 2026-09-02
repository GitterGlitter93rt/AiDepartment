// Weighted classification rules for every industry.
//
// Anchors are distinctive: matching one is strong evidence. Support
// terms corroborate but are weak alone. Confidence is driven by the
// winning rule's own evidence AND its margin over the best rule from a
// DIFFERENT industry — overlapping vocabulary ("leak", "house",
// "roof", "damage") is the real difficulty, and margin is what
// separates "my roof is leaking" (roofing) from "the pipe under my
// sink is leaking" (plumbing).
//
// Ordering within this array is irrelevant; scoring decides.

import type { Industry, Urgency } from './taxonomy.ts';

export interface Rule {
  industry: Industry;
  specialty: string;
  intent: string;
  urgency?: Urgency;
  /** Distinctive terms. Matching one is strong evidence. */
  anchors: RegExp[];
  /** Corroborating terms. Weak alone — they can never classify by
   * themselves, only strengthen a rule that already hit an anchor. */
  support?: RegExp[];
  /**
   * Disqualifying context. If any of these match, the rule is
   * discarded outright no matter how well its anchors scored.
   *
   * This exists because some overlaps are not a matter of degree.
   * "My air conditioning stopped working in my apartment" contains a
   * textbook HVAC anchor, but a tenant does not call an HVAC company —
   * they call the property manager, who dispatches one. No amount of
   * score tuning expresses that; the word "apartment" simply takes the
   * call out of HVAC's hands.
   */
  veto?: RegExp[];
}

/**
 * The water has already done its damage and the caller is describing
 * demolition, not a repair. That is a restoration job even when the
 * words that caused it ("sewage backed up", "pipe burst") belong to a
 * plumber.
 */
const POST_DAMAGE_CONTEXT = [
  /\b(carpet|drywall|flooring|baseboards?|cabinets?)\b[^.]{0,40}\b(come out|coming out|torn out|ripped out|removed|replaced|ruined)\b/i,
  /\b(tear|rip|take|pull) (it |them |everything )?out\b/i,
  /\bdry (it|the (house|place|floor))? ?out\b/i,
  /\bmitigation\b/i,
];

/** Caller is a tenant, so the call belongs to whoever manages the building. */
const TENANT_CONTEXT = [
  /\bmy (apartment|unit|landlord|property manager)\b/i,
  /\bin my (apartment|unit)\b/i,
  /\bi(')?m a tenant\b/i,
  /\bthe unit (above|below|next to)\b/i,
];

export const RULES: Rule[] = [
  // ================= ATTORNEYS =================
  { industry: 'attorneys', specialty: 'family_law', intent: 'divorce',
    anchors: [/\bdivorc\w*/i, /\bdissolution of marriage\b/i, /\bserved me (with )?(divorce )?papers\b/i, /\bsplitting up with my (wife|husband)\b/i],
    support: [/\b(wife|husband|spouse|marriage|married|ex)\b/i, /\balimony\b/i, /\bprenup\w*/i, /\bseparat\w+/i] },
  { industry: 'attorneys', specialty: 'family_law', intent: 'child_custody',
    anchors: [/\bcustody\b/i, /\bvisitation\b/i, /\bparenting (plan|time)\b/i, /\bwho gets the (kids|children)\b/i,
              // Callers describe custody without ever using the word.
              /\b(wife|husband|ex|she|he|mother|father)\b[^.]{0,30}\b(took|taken|left with|has)\b[^.]{0,25}\b(the )?(kids|children|son|daughter)\b/i,
              /\bhaven'?t seen (my|the) (kids?|children|son|daughter)\b/i,
              /\bwon'?t (let me (see|have)|give (me )?back)\b[^.]{0,30}\b(kids?|children|son|daughter|them)\b/i,
              /\b(keeping|withholding)\b[^.]{0,20}\b(kids?|children|son|daughter)\b/i],
    support: [/\b(kids|children|son|daughter|my ex)\b/i, /\bweeks?\b/i] },
  { industry: 'attorneys', specialty: 'family_law', intent: 'child_support',
    anchors: [/\bchild support\b/i, /\bsupport payments?\b/i],
    support: [/\b(kids|children|ex|behind|owes)\b/i] },
  { industry: 'attorneys', specialty: 'family_law', intent: 'domestic_violence', urgency: 'emergency',
    anchors: [/\bprotective order\b/i, /\brestraining order\b/i, /\bdomestic violence\b/i, /\b(he|she) (hit|threatened|assaulted) me\b/i],
    support: [/\bafraid\b/i, /\bscared\b/i, /\bsafe\b/i] },
  { industry: 'attorneys', specialty: 'personal_injury', intent: 'car_accident',
    anchors: [/\b(car|auto|motorcycle|truck|motor vehicle) (accident|crash|wreck)\b/i, /\brear[- ]?ended\b/i, /\bt[- ]?boned\b/i,
              /\bhit by a (car|truck|driver|drunk)\b/i, /\bsideswiped\b/i, /\brun off the road\b/i,
              /\b(killed|died)\b[^.]{0,30}\b(crash|accident|wreck)\b/i],
    support: [/\binjur\w+/i, /\bhurt\b/i, /\bhospital\b/i, /\bwhiplash\b/i, /\badjuster\b/i, /\bmy (neck|back)\b/i] },
  { industry: 'attorneys', specialty: 'personal_injury', intent: 'slip_and_fall',
    anchors: [/\bslip(ped)? and fell\b/i, /\bslip and fall\b/i, /\bfell (at|in|on) (the|a) \w+/i, /\btripped (over|on)\b/i,
              /\bslipped on\b[^.]{0,30}\b(floor|ice|water|spill)\b/i],
    support: [/\binjur\w+/i, /\bbroke my\b/i, /\bstore\b/i, /\bgrocery\b/i, /\bwet floor\b/i] },
  { industry: 'attorneys', specialty: 'personal_injury', intent: 'injury_claim',
    anchors: [/\bpersonal injury\b/i, /\bi was (hurt|injured)\b/i, /\bwrongful death\b/i, /\bdog (bit|attacked)\b/i, /\bmedical malpractice\b/i,
              /\brecorded statement\b/i, /\binsurance (company|adjuster)\b[^.]{0,45}\b(keeps? calling|settle\w*|offer\w*|statement|lowball)\b/i],
    support: [/\blawyer\b/i, /\battorney\b/i, /\bclaim\b/i] },
  { industry: 'attorneys', specialty: 'criminal_defense', intent: 'criminal_charge',
    anchors: [/\barrested\b/i, /\bcharged with\b/i, /\b(dui|dwi)\b/i, /\bfelony\b/i, /\bmisdemean\w+/i, /\bcriminal defense\b/i, /\bwarrant\b/i, /\bin jail\b/i,
              /\bprobation\b[^.]{0,20}\bviolat\w+/i, /\bviolated my probation\b/i, /\bexpunge\w*/i, /\bout on bond\b/i,
              /\b(detective|investigator|police|officer)\b[^.]{0,45}\b(called|contacted|wants|questioning|interview|come in)\b/i,
              /\bunder investigation\b/i, /\bturn myself in\b/i],
    support: [/\bcourt date\b/i, /\bbail\b/i, /\bbond\b/i, /\bpolice\b/i] },
  { industry: 'attorneys', specialty: 'probate_estate', intent: 'probate',
    anchors: [/\bprobate\b/i, /\bestate (administration|dispute)\b/i, /\bexecutor\b/i,
              /\bcontest\w+\b[^.]{0,30}\b(will|estate)\b/i, /\b(passed away|died)\b[^.]{0,50}\b(estate|will|probate)\b/i],
    support: [/\bwill\b/i, /\binherit\w+/i, /\bbeneficiar\w+/i],
    // Someone who inherited a house and wants to SELL it needs an
    // agent, not a probate attorney — even though probate may well be
    // in their future.
    veto: [/\b(sell|selling|list|listing|put it on the market|realtor)\b/i] },
  { industry: 'attorneys', specialty: 'probate_estate', intent: 'will_drafting',
    anchors: [/\b(draw up|write|make|need|update|get) a will\b/i, /\bwill\b[^.]{0,15}\bdrawn up\b/i, /\bset up a trust\b/i,
              /\bliving (will|trust)\b/i, /\bpower of attorney\b/i, /\bestate planning\b/i, /\bguardianship\b/i] },
  { industry: 'attorneys', specialty: 'general', intent: 'legal_inquiry',
    anchors: [/\b(lawyer|attorney|law firm|legal advice|lawsuit|being sued|sue (them|him|her|someone))\b/i] },

  // ================= PLUMBING =================
  { industry: 'plumbing', specialty: 'emergency', intent: 'active_water_leak', urgency: 'emergency',
    anchors: [/\bwater (is )?(pouring|gushing|spraying|flooding|everywhere|shooting)\b/i,
              /\b(burst|broken|busted) pipe\b/i, /\bpipe\b[^.]{0,30}\b(burst|busted|broke|split)\b/i,
              /\bwater (all )?over the floor\b/i, /\bwater\b[^.]{0,20}\bunder my sink\b/i],
    support: [/\b(sink|toilet|faucet|tub|shower|pipe|drain|basement|kitchen|bathroom|ceiling|wall)\b/i, /\bshut ?off\b/i, /\bvalve\b/i, /\bleak\w*/i] },
  { industry: 'plumbing', specialty: 'emergency', intent: 'toilet_overflow', urgency: 'emergency',
    anchors: [/\btoilets?( is| are|'?s)? ?overflow\w*/i, /\btoilets?( is| are)? ?running over\b/i, /\boverflowing toilet\b/i],
    support: [/\bwater\b/i, /\bfloor\b/i] },
  { industry: 'plumbing', specialty: 'emergency', intent: 'active_water_leak', urgency: 'high',
    anchors: [/\b(leak|drip)\w*\b[^.]{0,40}\b(sink|toilet|faucet|tub|shower|water heater|pipe|drain|supply line|spigot)\b/i,
              /\b(sink|toilet|faucet|tub|shower|water heater|pipe|drain|supply line|spigot)\b[^.]{0,40}\b(leak|drip)\w*/i],
    support: [/\bwater\b/i, /\bunder\b/i, /\bfor a (week|month|while)\b/i] },
  { industry: 'plumbing', specialty: 'emergency', intent: 'active_water_leak', urgency: 'emergency',
    // Water reaching electrics. Routed to plumbing because stopping the
    // water is the first job; the specialist's own rules carry the
    // safety guidance.
    anchors: [/\bwater\b[^.]{0,45}\b(breaker|panel|outlet|electrical|wiring|fuse box)\b/i,
              /\b(breaker|panel|outlet|electrical|fuse box)\b[^.]{0,45}\bwater\b/i],
    support: [/\b(running|dripping|pouring|leak\w*|down the wall)\b/i],
    veto: [/\b(burning|smok\w+|spark\w+|melt\w+)\b/i] },
  { industry: 'plumbing', specialty: 'drains', intent: 'sewer_backup', urgency: 'emergency',
    anchors: [/\bsewer\w* (back\w*|line)\b/i, /\bsewage\b/i, /\bbacking up into\b/i],
    support: [/\bsmell\b/i, /\bshower\b/i, /\btoilet\b/i],
    // Once the caller is talking about tearing out carpet and drywall,
    // the job has moved past unclogging the line.
    veto: POST_DAMAGE_CONTEXT },
  { industry: 'plumbing', specialty: 'drains', intent: 'clogged_drain',
    anchors: [/\bclog\w*/i, /\bbacke?(d|ing) up\b/i,
              /\b(drain|sink|toilet|tub|shower)s?\b[^.]{0,25}\bback\w+ up\b/i,
              /\bdrain\w*\b[^.]{0,20}\b(slow|blocked|stopped up)\b/i, /\bwon'?t drain\b/i],
    support: [/\b(toilet|sink|drain|shower|tub)\b/i],
    veto: POST_DAMAGE_CONTEXT },
  { industry: 'plumbing', specialty: 'water_heater', intent: 'no_hot_water',
    anchors: [/\bno hot water\b/i, /\bwater heater\b/i, /\bhot water (heater|tank)\b/i, /\bwater (is|isn'?t) (not )?(getting )?hot\b/i],
    support: [/\bpilot\b/i, /\bshower\b/i, /\btank\b/i] },
  { industry: 'plumbing', specialty: 'general', intent: 'low_water_pressure',
    anchors: [/\bwater pressure\b/i, /\bpressure (is )?(low|dropped)\b/i] },
  { industry: 'plumbing', specialty: 'general', intent: 'garbage_disposal',
    anchors: [/\bgarbage disposal\b/i, /\bdisposal (is )?(jam\w*|stuck|humming|broken)\b/i] },
  { industry: 'plumbing', specialty: 'general', intent: 'general_service',
    anchors: [/\bplumb\w+/i, /\brepipe\w*/i, /\binstall a (new )?(faucet|toilet|sink|water heater)\b/i] },

  // ================= ROOFING =================
  { industry: 'roofing', specialty: 'storm', intent: 'storm_damage', urgency: 'high',
    anchors: [/\broof\w*\b[^.]{0,60}\b(storm|hail|wind|hurricane|tornado)\b/i,
              /\b(storm|hail|wind|hurricane|tornado)\b[^.]{0,60}\broof\w*/i,
              /\b(storm|wind) (ripped|tore|blew)\b[^.]{0,30}\bshingle/i],
    support: [/\bdamage\w*/i, /\bshingle\w*/i, /\bleak\w*/i, /\binsurance\b/i, /\bmissing\b/i],
    // A car has a roof too. Hail on a hood is body work.
    veto: [/\b(hood|bumper|fender|windshield|quarter panel|my (car|truck|vehicle))\b/i] },
  { industry: 'roofing', specialty: 'emergency', intent: 'active_leak', urgency: 'high',
    anchors: [/\broof\w*\b[^.]{0,40}\bleak\w*/i, /\bleak\w*\b[^.]{0,40}\broof\b/i, /\brain (came|is coming) (in|through)\b/i,
              /\bceiling\b[^.]{0,40}\b(leak|drip|water|stain|spot|brown)\w*/i,
              /\b(water|it)\b[^.]{0,30}\b(drip\w+|coming|pouring|running)\b[^.]{0,30}\b(through|from)\b[^.]{0,20}\b(ceiling|attic|roof)\b/i,
              /\bbuckets?\b[^.]{0,30}\b(ceiling|roof|drip|catch)\w*/i,
              /\b(brown|water) (spot|stain)\b[^.]{0,30}\bceiling\b/i],
    support: [/\bwater\b/i, /\bbucket\b/i, /\battic\b/i, /\bspreading\b/i],
    // Water from the flat above is not a roof problem, and a tenant
    // calls the building, not a roofer.
    veto: TENANT_CONTEXT },
  { industry: 'roofing', specialty: 'storm', intent: 'tree_impact', urgency: 'emergency',
    anchors: [/\btree\b[^.]{0,40}\b(roof|house|home)\b/i,
              /\b(tree|limb|branch)\b[^.]{0,30}\b(fell|came|went) (on|onto|through|into)\b[^.]{0,20}\b(roof|house|home|attic|ceiling)\b/i],
    // A tree merely on the ground belongs to landscaping; this rule
    // deliberately requires the structure to be involved.
    veto: [/\bscreen\b/i, /\b(pool cage|lanai)\b/i, /\b(covered|coverage|policy|deductible)\b/i,
           /\b(file|start|report)\b[^.]{0,20}\ba claim\b/i] },
  { industry: 'roofing', specialty: 'insurance', intent: 'insurance_claim',
    anchors: [/\b(insurance|adjuster|claim)\b[^.]{0,50}\broof\w*/i, /\broof\w*\b[^.]{0,50}\b(insurance|adjuster|claim)\b/i] },
  { industry: 'roofing', specialty: 'replacement', intent: 'roof_replacement',
    anchors: [/\b(new|replace|replacing|replacement)\b[^.]{0,25}\broof\b/i, /\broof\b[^.]{0,25}\breplac\w+/i, /\bre-?roof\w*/i],
    support: [/\byears old\b/i, /\bquote\b/i, /\bestimate\b/i],
    veto: [/\bsolar\b/i] },
  { industry: 'roofing', specialty: 'general', intent: 'general_inquiry',
    anchors: [/\broof(s|ing|er)?\b/i, /\bshingle\w*/i, /\bgutter\w*/i, /\bflashing\b/i],
    // "soft wash my roof" is exterior cleaning, "roof before solar" is
    // a solar call, "is my roof covered" is an insurance question, and
    // "the roof of my car" is body work. None of them want a roofer.
    veto: [/\b(soft ?wash|pressure ?wash|power ?wash)\w*/i, /\bclean\w*\b[^.]{0,20}\broof\b/i,
           /\broof\b[^.]{0,20}\bclean\w*/i, /\bsolar\b/i, /\b(covered|coverage|deductible|my policy)\b/i,
           /\b(hood|bumper|fender|windshield|my (car|truck|vehicle))\b/i] },

  // ================= HVAC =================
  { industry: 'hvac', specialty: 'cooling', intent: 'no_cooling', urgency: 'high',
    anchors: [/\b(a\/?c|air ?condition\w*)\b[^.]{0,40}\b(not work\w*|stopped|broke|down|out|dead|blowing (warm|hot))\b/i,
              /\bno (a\/?c|air ?condition\w*|cool\w*)\b/i, /\bnot (cooling|blowing cold)\b/i,
              /\b(a\/?c|air ?condition\w*)\b[^.]{0,20}\b(quit|died)\b/i],
    support: [/\bhot\b/i, /\bdegrees\b/i, /\bhouse\b/i],
    veto: TENANT_CONTEXT },
  { industry: 'hvac', specialty: 'heating', intent: 'no_heat', urgency: 'high',
    anchors: [/\bno heat\b/i,
              /\bheat(er|ing)?\b[^.]{0,30}\b(not work\w*|not coming on|stopped|broke|won'?t (come|turn) on|out)\b/i,
              /\bfurnace\b[^.]{0,30}\b(not|won'?t|stopped|broke)\b/i],
    support: [/\bcold\b/i, /\bfreez\w+/i, /\bdegrees\b/i, /\bnewborn\b/i, /\bbaby\b/i],
    veto: TENANT_CONTEXT },
  { industry: 'hvac', specialty: 'general', intent: 'furnace_repair',
    anchors: [/\bfurnace\b/i, /\bheat pump\b/i, /\bmini[- ]?split\b/i], veto: TENANT_CONTEXT },
  { industry: 'hvac', specialty: 'general', intent: 'system_replacement',
    anchors: [/\b(new|replace|replacing)\b[^.]{0,30}\b(a\/?c|air ?condition\w*|hvac|furnace|system)\b/i, /\bhvac\b[^.]{0,20}\bquote\b/i] },
  { industry: 'hvac', specialty: 'general', intent: 'general_service',
    anchors: [/\bhvac\b/i, /\bair ?condition\w*/i, /\bthermostat\b/i, /\bduct(work)?\b/i, /\bmaintenance plan\b/i],
    veto: TENANT_CONTEXT },

  // ================= ELECTRICAL =================
  { industry: 'electrical', specialty: 'emergency', intent: 'burning_smell', urgency: 'emergency',
    anchors: [/\bburning smell\b/i,
              /\bsmell\w*\b[^.]{0,30}\bburning\b/i,
              /\bsmells? like (something is )?burning\b/i,
              /\b(outlet|panel|breaker|switch|wire|wiring)\b[^.]{0,35}\b(burning|smok\w+|melt\w+|scorch\w+|hot to the touch)\b/i,
              /\b(burning|smok\w+|melt\w+|scorch\w+)\b[^.]{0,35}\b(outlet|panel|breaker|switch|wire|wiring)\b/i],
    support: [/\b(outlet|panel|breaker|switch|wall)\b/i],
    // A burning smell at the stove or the furnace is not electrical.
    veto: [/\b(oven|stove|food|toast|furnace|fireplace)\b/i] },
  { industry: 'electrical', specialty: 'emergency', intent: 'sparking', urgency: 'emergency',
    anchors: [/\bspark\w+\b[^.]{0,30}\b(outlet|panel|breaker|switch|wire)\b/i, /\b(outlet|panel|breaker|switch)\b[^.]{0,25}\bspark\w+/i, /\bgot (a )?shock\w*\b/i, /\bshocked me\b/i] },
  { industry: 'electrical', specialty: 'general', intent: 'breaker_tripping',
    anchors: [/\bbreaker\b[^.]{0,40}\b(trip\w*|keeps? (going|flipping) off|won'?t (stay )?reset)\b/i, /\bkeeps? tripping\b/i, /\bfuse\b[^.]{0,20}\bblow\w*/i] },
  { industry: 'electrical', specialty: 'general', intent: 'power_outage_partial',
    anchors: [/\b(half|part)( of)? (my|the) (house|home|building)\b[^.]{0,35}\b(no power|has no|out|dark)\b/i,
              /\bno power (in|to)\b/i, /\b(half|part)( of)? (my|the) (house|home)\b[^.]{0,20}\bpower\b/i,
              /\bouts? of power in (one|a) room\b/i],
    veto: TENANT_CONTEXT },
  { industry: 'electrical', specialty: 'general', intent: 'panel_upgrade',
    anchors: [/\bpanel upgrade\b/i, /\bupgrade (my|the) (electrical )?panel\b/i, /\bev charger\b/i, /\bgenerator (install|hookup)\b/i, /\brewir\w+/i] },
  { industry: 'electrical', specialty: 'general', intent: 'general_service',
    anchors: [/\belectric(ian|al)\b/i, /\boutlet\w*/i, /\bwiring\b/i, /\brecessed light\w*/i, /\bceiling fan\b[^.]{0,20}\binstall\w*/i] },

  // ================= PEST CONTROL =================
  { industry: 'pest_control', specialty: 'general', intent: 'bed_bugs',
    anchors: [/\bbed ?bugs?\b/i], support: [/\bbit\w+/i, /\bmattress\b/i, /\bbedroom\b/i] },
  { industry: 'pest_control', specialty: 'general', intent: 'termites',
    anchors: [/\btermites?\b/i, /\btermite (damage|inspection)\b/i], support: [/\bwood\b/i, /\bdamage\b/i] },
  { industry: 'pest_control', specialty: 'general', intent: 'rodents',
    anchors: [/\b(rats?|mice|mouse|rodents?)\b/i,
              /\bsomething( is)?( |'s )?(living|scratching|running|moving|nesting)\b[^.]{0,20}\b(attic|walls?|ceiling|crawl ?space)\b/i],
    support: [/\battic\b/i, /\bdropping\w*/i, /\bgarage\b/i] },
  { industry: 'pest_control', specialty: 'general', intent: 'roaches',
    anchors: [/\broach\w*/i, /\bcockroach\w*/i], support: [/\bkitchen\b/i] },
  { industry: 'pest_control', specialty: 'general', intent: 'wasps_bees',
    anchors: [/\b(wasp|hornet|yellow ?jacket|bee)s?\b[^.]{0,25}\bnest\b/i, /\bnest\b[^.]{0,25}\b(wasp|hornet|bee)s?\b/i, /\bwasps?\b/i, /\bhornets?\b/i] },
  { industry: 'pest_control', specialty: 'general', intent: 'general_service',
    anchors: [/\bpest control\b/i, /\bexterminat\w+/i,
              /\bthe spray\b/i, /\b(spray|treatment|chemicals?)\b[^.]{0,35}\b(safe|toxic|harmful|kids?|children|pets?|dog|cat)\b/i,
              /\b(safe|toxic|harmful)\b[^.]{0,30}\b(spray|treatment|chemicals?)\b/i, /\b(ants?|spiders?|fleas?|mosquito\w*|silverfish|scorpions?)\b/i, /\bquarterly (service|treatment)\b/i] },

  // ================= GARAGE DOOR =================
  { industry: 'garage_door', specialty: 'general', intent: 'broken_spring', urgency: 'high',
    anchors: [/\bgarage door\b[^.]{0,40}\bspring\b/i, /\bspring\b[^.]{0,30}\b(snapped|broke|broken)\b/i] },
  { industry: 'garage_door', specialty: 'general', intent: 'door_off_track', urgency: 'high',
    anchors: [/\bgarage door\b[^.]{0,40}\b(off (the )?track|crooked|jammed|stuck)\b/i, /\boff (the )?track\b/i] },
  { industry: 'garage_door', specialty: 'general', intent: 'opener_failure',
    anchors: [/\bgarage (door )?opener\b/i, /\bopener\b[^.]{0,30}\b(not work\w*|clicks?|dead|broken)\b/i] },
  { industry: 'garage_door', specialty: 'general', intent: 'general_service',
    anchors: [/\bgarage doors?\b/i,
              /\b(car|truck|vehicle)\b[^.]{0,25}\bstuck in the garage\b/i,
              /\bthe door\b[^.]{0,35}\b(won'?t|will not|wont)\b[^.]{0,15}\b(close|open|go up|go down)\b/i,
              /\b(quote|price|estimate|cost)\b[^.]{0,30}\b(new |insulated |replacement )*door\b/i,
              /\b(new|insulated|replacement)\b[^.]{0,20}\bdoor\b[^.]{0,25}\b(quote|price|estimate|cost)\b/i],
    support: [/\bremote\b/i, /\bkeypad\b/i, /\bpanel\b/i, /\bdent\w*/i, /\bgarage\b/i] },

  // ================= POOL =================
  { industry: 'pool', specialty: 'general', intent: 'green_pool',
    anchors: [/\bpool\b[^.]{0,30}\b(green|cloudy|murky|algae)\b/i, /\b(green|cloudy|algae)\b[^.]{0,20}\bpool\b/i] },
  { industry: 'pool', specialty: 'general', intent: 'pump_failure',
    anchors: [/\bpool (pump|filter|heater)\b/i,
              /\bpump\b[^.]{0,35}\b(stopped|not work\w*|broke|dead|grinding|screech\w+|squeal\w+|humming|loud|noise)\b/i,
              /\b(grinding|screech\w+|squeal\w+|horrible)\b[^.]{0,30}\b(noise|sound)\b[^.]{0,25}\bpump\b/i,
              /\b(skimmer|salt cell|chlorinator|pool light)\b/i] },
  { industry: 'pool', specialty: 'general', intent: 'general_service',
    anchors: [/\bpool\b/i],
    support: [/\bservice\b/i, /\bchemical\w*/i, /\bresurfac\w+/i, /\bweekly\b/i, /\bchlorine\b/i, /\bsalt\b/i, /\btile\b/i],
    // "pool deck", "pool cage" and "pool house" are somebody else's job.
    veto: [/\bpool (deck|cage|house|screen|enclosure)\b/i, /\b(pressure|power|soft) ?wash\w*/i] },

  // ================= SCREEN ENCLOSURE =================
  { industry: 'screen_enclosure', specialty: 'general', intent: 'screen_repair',
    anchors: [/\bscreen\w*\b[^.]{0,30}\b(torn|rip\w+|hole|damage\w*|repair)\b/i,
              /\b(pool cage|lanai)\b/i, /\brescreen\w*/i,
              /\b(branch|limb|tree|ball|animal)\b[^.]{0,30}\b(through|into)\b[^.]{0,15}\bscreen\b/i,
              /\bscreen door\b/i, /\bscreens?\b[^.]{0,30}\b(won'?t|will not)\b[^.]{0,15}\bclose\b/i],
    support: [/\benclosure\b/i, /\bpatio\b/i, /\bporch\b/i, /\bpanel\w*/i] },
  { industry: 'screen_enclosure', specialty: 'general', intent: 'pet_damage',
    anchors: [/\b(dog|cat|pet|animal)\b[^.]{0,35}\b(through|tore|ripped|scratched|hole)\b[^.]{0,25}\bscreen\b/i,
              /\bscreen\b[^.]{0,30}\b(dog|cat|pet)\b/i,
              /\bpet screen\b/i],
    support: [/\bcage\b/i, /\blanai\b/i, /\bporch\b/i] },
  { industry: 'screen_enclosure', specialty: 'general', intent: 'structure_damage',
    anchors: [/\b(pool cage|lanai|enclosure|screen room)\b[^.]{0,40}\b(bent|collaps\w+|leaning|down|damage\w*|frame)\b/i,
              /\b(frame|beam|post|gutter)\b[^.]{0,30}\b(bent|broken|pulled|loose)\b[^.]{0,30}\b(cage|lanai|enclosure|screen)\b/i],
    support: [/\bstorm\b/i, /\bwind\b/i] },
  { industry: 'screen_enclosure', specialty: 'general', intent: 'maintenance',
    anchors: [/\b(rescreen|re.?screen)\w*/i,
              /\bscreens?\b[^.]{0,30}\b(sagging|loose|stretched|old|faded|need\w* replacing)\b/i,
              /\b(spline|screen door (roller|handle|latch))\b/i] },
  { industry: 'screen_enclosure', specialty: 'general', intent: 'quote_request',
    anchors: [/\bscreen enclosure\b/i, /\bscreen (room|porch)\b/i,
              /\bscreen in\b[^.]{0,30}\b(porch|patio|lanai|deck|area)\b/i,
              /\b(enclose|close in)\b[^.]{0,25}\b(porch|patio|lanai)\b/i] },

  // ================= LANDSCAPING =================
  { industry: 'landscaping', specialty: 'general', intent: 'lawn_maintenance',
    anchors: [/\b(mow|mowing|cut)\b[^.]{0,25}\b(lawn|grass|yard)\b/i, /\blawn (care|service|maintenance)\b/i, /\byard (work|maintenance)\b/i] },
  { industry: 'landscaping', specialty: 'general', intent: 'landscape_design',
    anchors: [/\blandscap\w+/i, /\b(paver|outdoor kitchen|fire pit|retaining wall|hardscape)\b/i, /\bsod\b/i] },
  { industry: 'landscaping', specialty: 'general', intent: 'irrigation',
    anchors: [/\b(sprinklers?|irrigation)\b/i],
    support: [/\b(zone|valve|timer|controller|head|shut off|running)\b/i] },
  { industry: 'landscaping', specialty: 'general', intent: 'tree_service',
    anchors: [/\btree (removal|service|trimming)\b/i, /\btrim\w*\b[^.]{0,20}\btrees?\b/i,
              /\btree\b[^.]{0,25}\b(came down|fell|needs to come down|is down)\b/i,
              // Callers name the species rather than saying "tree".
              /\b(oak|pine|palm|maple|elm|magnolia|cypress|willow|birch)\b[^.]{0,40}\b(come down|cut down|remove|removed|trim\w*|down)\b/i,
              /\b(big|large|dead|dying|old)\b[^.]{0,15}\b(tree|oak|pine|palm|maple|elm)\b/i,
              /\bstump\b/i],
    // A tree on the ground is a tree service call. A tree on the ROOF
    // is a roofing emergency, a tree on the CAR with a claim attached
    // is an insurance call, and neither wants a landscaper.
    veto: [/\b(trees?|limbs?|branch\w*)\b[^.]{0,35}\b(fell|came down|went|landed|is)\b[^.]{0,20}\b(on|onto|through|into)\b[^.]{0,20}\b(roof|house|home|car|truck|vehicle)\b/i,
           /\b(file|start|report)\b[^.]{0,20}\ba claim\b/i] },
  { industry: 'landscaping', specialty: 'general', intent: 'drainage',
    anchors: [/\b(yard|back ?yard|lawn)\b[^.]{0,30}\bflood\w*/i, /\bdrainage (issue|problem)\b/i, /\bstanding water\b[^.]{0,20}\byard\b/i] },

  // ================= RESTORATION =================
  { industry: 'restoration', specialty: 'general', intent: 'water_damage', urgency: 'emergency',
    // Damage that has already happened and now needs drying out and
    // rebuilding. The distinction from plumbing is tense: a plumber
    // stops water that is still running; restoration deals with what
    // the water left behind.
    anchors: [/\b(soaked|saturated|waterlogged)\b[^.]{0,40}\b(floor|carpet|drywall|ceiling|wall|everything|downstairs|upstairs|basement|house)\b/i,
              /\b(floor|carpet|drywall|ceiling|walls?|downstairs|upstairs|basement|whole (house|place))\b[^.]{0,35}\b(soaked|saturated|ruined|destroyed|under water)\b/i,
              /\bwhile we were (away|gone|out of town)\b/i,
              /\b(tear out|rip out|take out|replace)\b[^.]{0,30}\b(carpet|drywall|flooring|baseboards?)\b/i,
              /\b(carpet|drywall|flooring|baseboards?|cabinets?)\b[^.]{0,40}\b(come out|coming out|torn out|ripped out|removed)\b/i,
              /\bdry (it |the (house|place) )?out\b/i],
    support: [/\bwater\b/i, /\bpipe\b/i, /\bdamage\w*/i, /\bsewage\b/i, /\binsurance\b/i] },
  { industry: 'restoration', specialty: 'general', intent: 'water_damage', urgency: 'emergency',
    anchors: [/\b(basement|house|home|floor)\b[^.]{0,30}\bflood\w+/i, /\bflood\w+\b[^.]{0,25}\b(basement|house|home)\b/i,
              /\bwater damage\b/i, /\bfoot of water\b/i, /\b(soaked|saturated|waterlogged)\b/i,
              /\bwater (got|came) in\b/i, /\bdry ?out\b/i, /\bwater (mitigation|extraction|removal)\b/i],
    support: [/\bcarpet\b/i, /\bdrywall\b/i, /\bcleanup\b/i, /\brestoration\b/i, /\bwhile we were (away|gone)\b/i] },
  { industry: 'restoration', specialty: 'general', intent: 'fire_damage', urgency: 'emergency',
    anchors: [/\bfire damage\b/i, /\bhad a fire\b/i, /\bsmoke damage\b/i, /\bhouse (caught )?fire\b/i] },
  { industry: 'restoration', specialty: 'general', intent: 'mold',
    anchors: [/\bmou?ld\b/i, /\bblack mou?ld\b/i], support: [/\bdrywall\b/i, /\bbehind\b/i, /\bsmell\b/i] },
  { industry: 'restoration', specialty: 'general', intent: 'general_service',
    anchors: [/\brestoration (company|services?)\b/i, /\bwater (mitigation|extraction)\b/i, /\bbiohazard\b/i] },

  // ================= CONSTRUCTION =================
  { industry: 'construction', specialty: 'general', intent: 'kitchen_remodel',
    anchors: [/\bkitchen\b[^.]{0,25}\b(remodel|renovat\w+|redo|gut)\w*/i, /\bremodel\w*\b[^.]{0,20}\bkitchen\b/i] },
  { industry: 'construction', specialty: 'general', intent: 'bathroom_remodel',
    anchors: [/\bbathroom\b[^.]{0,25}\b(remodel|renovat\w+|redo|gut)\w*/i, /\bgut\w*\b[^.]{0,20}\bbathroom\b/i] },
  { industry: 'construction', specialty: 'general', intent: 'home_addition',
    anchors: [/\b(add|adding|addition)\b[^.]{0,30}\b(room|storey|story|floor|onto (my|the) house)\b/i, /\bhome addition\b/i, /\bsecond (storey|story)\b/i] },
  { industry: 'construction', specialty: 'general', intent: 'general_inquiry',
    anchors: [/\b(permit|permitting)\b[^.]{0,45}\b(add|build|remodel|renovat\w+|bathroom|kitchen|addition|deck|garage|room)\b/i,
              /\b(add|adding|build\w*)\b[^.]{0,30}\b(a |an )?(bathroom|kitchen|bedroom|room|garage|deck|addition)\b/i,
              /\b(general )?contractor\b/i, /\bremodel\w*/i, /\brenovat\w+/i, /\bnew (home |house )?construction\b/i, /\bbuild(ing)? a (new )?(house|home)\b/i, /\bbuil[td][- ]?out\b/i, /\bbuil[td]\b[^.]{0,25}\b(commercial|office|retail|warehouse) space\b/i, /\bdeck\b[^.]{0,25}\b(rebuild|rot\w*|replace)\b/i] },

  // ================= PRESSURE WASHING =================
  { industry: 'pressure_washing', specialty: 'general', intent: 'driveway',
    anchors: [/\b(driveway|sidewalk|walkway|patio|deck|concrete|pool deck)\b[^.]{0,40}\b(wash\w*|clean\w*|power ?wash\w*|pressure ?wash\w*)\b/i,
              /\b(pressure|power) ?wash\w*\b[^.]{0,40}\b(driveway|sidewalk|walkway|patio|deck|concrete)\b/i,
              /\b(pool deck|patio|lanai|driveway|sidewalks?)\b[^.]{0,35}\b(need|needs|want)\w*\b[^.]{0,15}\bclean\w*/i,
              /\b(driveway|patio|deck|sidewalk|walkway|concrete)\b[^.]{0,25}\b(is|looks|has|are)\b[^.]{0,20}\b(black|filthy|awful|terrible|disgusting|green|nasty|gross|stained)\b/i,
              /\b(clean|wash)\b[^.]{0,15}\bthat\b/i,
              /\b(driveway|patio|deck|sidewalk|siding|house)\b[^.]{0,40}\bstains?\b[^.]{0,25}\b(back|again|returned)\b/i,
              /\bstains?\b[^.]{0,25}\b(already )?(back|again)\b/i],
    support: [/\b(pressure|power|soft) ?wash\w*/i, /\bstain\w*/i, /\bmildew\b/i, /\balgae\b/i] },
  { industry: 'pressure_washing', specialty: 'general', intent: 'house_wash',
    anchors: [/\b(house|home|siding|exterior|storefront|building)\b[^.]{0,35}\b(wash\w*|soft ?wash\w*|power ?wash\w*|pressure ?wash\w*)\b/i,
              /\b(pressure|power|soft) ?wash\w*\b[^.]{0,35}\b(house|home|siding|exterior|storefront|building)\b/i],
    support: [/\bgreen\b/i, /\bmildew\b/i, /\bstain\w*/i] },
  { industry: 'pressure_washing', specialty: 'general', intent: 'roof_cleaning',
    anchors: [/\broof\b[^.]{0,30}\b(clean\w*|wash\w*|soft ?wash\w*)\b/i,
              /\b(soft ?wash|pressure ?wash|power ?wash|clean)\w*\b[^.]{0,20}\b(my |the |our )?roof\b/i,
              /\b(black streaks?|algae|moss|stains?|green)\b[^.]{0,35}\broof\b/i,
              /\broof\b[^.]{0,30}\b(black streaks?|algae|moss|green)\b/i,
              /\b(get|take|clean)\b[^.]{0,20}\b(streaks?|algae|moss|stains?)\b[^.]{0,15}\boff\b/i],
    support: [/\balgae\b/i, /\bmoss\b/i, /\bblack streak\w*/i] },
  { industry: 'pressure_washing', specialty: 'general', intent: 'commercial',
    anchors: [/\b(storefront|restaurant|apartment complex|parking (lot|garage)|dumpster pad|shopping cent\w+|hoa|sidewalks?)\b[^.]{0,45}\b(clean\w*|wash\w*|done)\b/i,
              /\b(sidewalks?|walkways?|breezeways?)\b[^.]{0,40}\b(done|clean\w*|wash\w*)\b[^.]{0,35}\b(apartment|complex|hoa|propert\w+|building)\b/i,
              /\b(clean\w*|wash\w*)\b[^.]{0,35}\b(storefront|restaurant|apartment complex|parking (lot|garage)|sidewalks?)\b/i,
              /\b(quarterly|monthly|recurring)\b[^.]{0,25}\bclean\w*/i],
    support: [/\bcommercial\b/i, /\bproperty\b/i] },
  { industry: 'pressure_washing', specialty: 'general', intent: 'house_wash',
    anchors: [/\b(siding|exterior|stucco)\b[^.]{0,35}\b(green|black|dirty|mildew|algae|covered in)\b/i,
              // Callers have no vocabulary for this: "green crap on the
              // side of my house" is the single most common opener.
              /\b(green|black|gray|grey|dark)\b[^.]{0,15}\b(crap|stuff|junk|gunk|slime|film|growth|streaks?|mildew|algae|mold|mould)\b/i,
              /\b(crap|stuff|junk|gunk|growth|mildew|algae|mold|mould)\b[^.]{0,35}\b(side of|on) (my|the) (house|home|siding|garage|fence|wall)\b/i],
    support: [/\bwash\w*/i, /\bclean\w*/i, /\bhouse\b/i, /\bsiding\b/i] },
  { industry: 'pressure_washing', specialty: 'general', intent: 'quote_request',
    anchors: [/\b(pressure|power|soft) ?wash\w*/i] },

  // ================= COLLISION REPAIR =================
  { industry: 'collision_repair', specialty: 'general', intent: 'accident_repair',
    anchors: [/\b(body|collision) (shop|work|repair)\b/i,
              /\b(car|truck|vehicle|bumper|fender|door|quarter panel)\b[^.]{0,30}\b(dent\w*|damage\w*|smashed|wrecked|banged up|crumpled|scraped)\b/i,
              /\b(backed into|hit) my (car|truck|vehicle|bumper)\b/i,
              /\b(rear[- ]?ended|backed into)\b[^.]{0,35}\bparking lot\b/i,
              /\bestimate\b[^.]{0,25}\b(body work|repair|car)\b/i],
    support: [/\baccident\b/i, /\binsurance\b/i, /\bclaim\b/i, /\badjuster\b/i] },
  { industry: 'collision_repair', specialty: 'general', intent: 'hail_damage_auto',
    anchors: [/\bhail\b[^.]{0,40}\b(car|truck|vehicle|hood|trunk|quarter panel)\b/i,
              /\b(hood|trunk|quarter panel|fender|bumper)\b[^.]{0,35}\bhail\b/i,
              /\bhail damage\b[^.]{0,25}\b(car|vehicle)\b/i] },
  { industry: 'collision_repair', specialty: 'general', intent: 'towing_needed',
    anchors: [/\bcar (is )?not drivable\b/i, /\bneed(s)? (a )?tow\w*/i, /\btow (my|the) car\b/i] },
  { industry: 'collision_repair', specialty: 'general', intent: 'repair_status',
    anchors: [/\bhow('s| is)\b[^.]{0,25}\b(my (car|truck|vehicle))\b[^.]{0,25}\b(coming|doing|looking)\b/i,
              /\bmy (car|truck|vehicle)\b[^.]{0,40}\b(in|at) your shop\b/i,
              /\b(in|at) (your|the) shop\b[^.]{0,35}\b(ready|done|finished|weeks?|days?)\b/i,
              /\bis it ready\b/i,
              /\b(status|update)\b[^.]{0,30}\bmy (car|truck|vehicle)\b/i,
              /\bwhen (will|can i get)\b[^.]{0,25}\bmy (car|truck|vehicle)\b/i] },
  { industry: 'collision_repair', specialty: 'general', intent: 'insurance_estimate',
    anchors: [/\b(my )?insurance\b[^.]{0,35}\bestimate\b/i, /\bestimate\b[^.]{0,30}\b(my )?insurance\b/i] },

  // ================= AUTOMOTIVE DEALER =================
  { industry: 'automotive_dealer', specialty: 'general', intent: 'vehicle_inquiry',
    anchors: [/\b(do you (still )?have|is .{0,20} still available)\b[^.]{0,40}\b(truck|car|suv|sedan|van|in stock)\b/i,
              /\bin stock\b/i, /\bon your (website|lot)\b/i],
    support: [/\bstock number\b/i, /\bvin\b/i] },
  { industry: 'automotive_dealer', specialty: 'general', intent: 'test_drive',
    anchors: [/\btest drive\b/i] },
  { industry: 'automotive_dealer', specialty: 'general', intent: 'trade_in',
    anchors: [/\btrade[- ]?in\b/i, /\bwhat (can|will) you give me for my\b/i, /\btrade my (car|truck|vehicle)\b/i] },
  { industry: 'automotive_dealer', specialty: 'general', intent: 'service_appointment',
    anchors: [/\boil change\b/i, /\btire rotation\b/i, /\bservice (appointment|department)\b/i, /\brecall (notice)?\b/i,
              /\bschedule\b[^.]{0,25}\b(service|maintenance)\b/i] },
  { industry: 'automotive_dealer', specialty: 'general', intent: 'financing_inquiry',
    anchors: [/\bmy payment (be|would be)\b/i, /\bfinanc\w+\b[^.]{0,25}\b(car|truck|vehicle)\b/i, /\blease (a|the) (car|truck|vehicle)\b/i] },

  // ================= REAL ESTATE =================
  { industry: 'real_estate', specialty: 'buyer', intent: 'buyer_inquiry',
    anchors: [/\b(buy|buying|purchase|purchasing)\b[^.]{0,30}\b(house|home|condo|property|place)\b/i,
              /\blooking (to buy|for a (house|home|condo))\b/i, /\bfirst.time (home ?)?buyer\b/i,
              /\bin the market for a (house|home)\b/i,
              // Someone relocating who needs somewhere to live is a
              // buyer lead, not a general enquiry.
              /\bneed to find a (house|home|place)\b/i,
              /\b(relocat\w+|moving)\b[^.]{0,45}\b(need|looking|find|buy)\b[^.]{0,25}\b(house|home|place)\b/i],
    support: [/\bpre.?approv\w+/i, /\bmortgage\b/i, /\brealtor\b/i, /\bagent\b/i, /\bbedroom\w*/i] },
  { industry: 'real_estate', specialty: 'seller', intent: 'seller_inquiry',
    anchors: [/\b(sell|selling|list|listing)\b[^.]{0,30}\b(house|home|condo|property|place|it)\b/i,
              /\b(house|home|condo|property|place)\b[^.]{0,35}\b(listed|on the market|for sale)\b/i,
              /\bput (my|the) (house|home|condo|place) on the market\b/i, /\bwant to list\b/i,
              /\binherit\w+\b[^.]{0,45}\b(sell|selling|list)\w*/i,
              /\b(need|want|looking) to sell\b/i],
    support: [/\brealtor\b/i, /\bagent\b/i, /\bmarket\b/i] },
  { industry: 'real_estate', specialty: 'valuation', intent: 'home_valuation',
    anchors: [/\bwhat.{0,20}(my (house|home)).{0,20}worth\b/i, /\bhome valuation\b/i, /\bmarket analysis\b/i, /\bhow much (is|could) (my|our) (house|home)\b/i] },
  { industry: 'real_estate', specialty: 'showing', intent: 'showing_request',
    anchors: [/\b(schedule|book|set up|arrange)\b[^.]{0,25}\b(showing|viewing|tour)\b/i,
              /\b(see|look at|tour)\b[^.]{0,30}\b(the )?(house|home|property|listing|place) (on|at)\b/i,
              /\bopen house\b/i,
              /\b(house|home|listing|place|one)\b[^.]{0,30}\bstill available\b/i,
              /\bstill available\b[^.]{0,25}\b(house|home|listing|place)\b/i,
              /\bsign (out front|in the yard)\b/i,
              /\bdrove (by|past)\b[^.]{0,35}\b(house|home|place|property|listing|one)\b/i,
              /\b(house|home|place|property) on \w+ (street|st|road|rd|avenue|ave|lane|drive|dr|way|court|ct|boulevard|blvd)\b/i] },
  { industry: 'real_estate', specialty: 'rental', intent: 'rental_investor',
    anchors: [/\b(investment|rental) propert\w+/i, /\bbuy (a )?rental\b/i, /\binvestor\b/i] },
  { industry: 'real_estate', specialty: 'general', intent: 'relocation',
    anchors: [/\b(moving|relocating) to\b[^.]{0,40}\b(need|looking|realtor|agent)\b/i,
              /\brelocat\w+\b[^.]{0,35}\b(realtor|agent|house|home|area|for work)\b/i,
              /\bwe(')?re relocating\b/i, /\bmoving to the area\b/i] },
  { industry: 'real_estate', specialty: 'general', intent: 'general_inquiry',
    anchors: [/\breal estate\b/i, /\brealtor\b/i, /\bmls\b/i] },

  // ================= PROPERTY MANAGEMENT =================
  { industry: 'property_management', specialty: 'general', intent: 'maintenance_request',
    anchors: [/\b(my|the) (apartment|unit|rental)\b[^.]{0,45}\b(broke|broken|not work\w*|stopped|leak\w*|out)\b/i,
              /\b(broke|broken|not work\w*|stopped working|leak\w*)\b[^.]{0,35}\b(in|at) my (apartment|unit)\b/i,
              /\b(no|without)\b[^.]{0,25}\b(heat|water|power|air|ac|hot water|electricity)\b[^.]{0,30}\bmy (apartment|unit)\b/i,
              /\b(no|without)\b[^.]{0,20}\b(heat|water|power|air|ac|hot water)\b[^.]{0,20}\bin my unit\b/i,
              /\bmaintenance request\b/i, /\btell (my|the) landlord\b/i,
              /\bi(')?m a tenant\b/i,
              /\bthe unit (above|below|next to)\b/i,
              /\b(landlord|property manager)\b[^.]{0,30}\b(fix|repair|maintenance)\b/i,
              /\b(lock|door|window|appliance|dishwasher|stove|fridge|refrigerator|water heater)\b[^.]{0,35}\b(broke|broken|not work\w*)\b[^.]{0,25}\b(apartment|unit|rental)\b/i],
    support: [/\btenant\b/i, /\blease\b/i, /\bunit\b/i, /\bapartment\b/i] },
  { industry: 'property_management', specialty: 'general', intent: 'leasing_inquiry',
    anchors: [/\b(available|vacant)\b[^.]{0,30}\b(unit|apartment|rental)\b/i,
              /\b(units?|apartments?|rentals?|bedrooms?)\b[^.]{0,30}\b(available|vacant|open)\b/i,
              /\b(one|two|three|1|2|3)[- ]bed\w*\b/i,
              /\bapply for\b[^.]{0,25}\b(apartment|unit|rental)\b/i,
              /\brental application\b/i, /\bwant to (see|rent|tour)\b[^.]{0,30}\b(apartment|unit|the two.?bedroom)\b/i] },
  { industry: 'property_management', specialty: 'general', intent: 'owner_inquiry',
    anchors: [/\bi own\b[^.]{0,40}\b(rental|propert\w+|units?|door\w*|house\w*|condo\w*)\b/i,
              /\bmanage (my|them|our)\b[^.]{0,25}\b(rental|propert\w+|units?)?\b/i,
              /\b(someone|somebody) to manage\b/i,
              /\bproperty management\b/i, /\btired of managing\b/i] },
  { industry: 'property_management', specialty: 'general', intent: 'general_inquiry',
    anchors: [/\bmy lease\b/i, /\bmy landlord\b/i, /\brent (is )?due\b/i] },

  // ================= HEALTHCARE =================
  { industry: 'healthcare', specialty: 'general', intent: 'appointment_booking',
    anchors: [/\b(appointment|see the doctor)\b[^.]{0,35}\b(doctor|dr\.?|clinic|office|practice)\b/i,
              /\b(schedule|make|book)\b[^.]{0,25}\b(an? )?appointment\b/i, /\bget in to see\b/i],
    support: [/\bpatient\b/i, /\bdoctor\b/i, /\bclinic\b/i] },
  { industry: 'healthcare', specialty: 'general', intent: 'appointment_booking',
    // Symptom plus a request to be seen. The specialist's own rules
    // stop it from triaging; routing it correctly is what gets the
    // 911 guidance in front of the caller at all.
    anchors: [/\bshould i (come in|be seen|make an appointment)\b/i,
              /\b(can|could) i (get in|be seen|come in)\b/i,
              /\b(chest pain|shortness of breath|can'?t breathe|fever|bleeding|dizzy|numb|vomiting|rash|swelling|infection)\b/i],
    support: [/\b(doctor|dr\.?|clinic|office|nurse|appointment)\b/i, /\bsince (this )?(morning|yesterday|last night)\b/i] },
  { industry: 'healthcare', specialty: 'general', intent: 'new_patient',
    anchors: [/\bnew patient\b/i, /\bget established\b[^.]{0,25}\b(doctor|practice|clinic)\b/i] },
  { industry: 'healthcare', specialty: 'general', intent: 'prescription_refill',
    anchors: [/\b(refill|prescription)\b[^.]{0,30}\b(medication|medicine|prescription|pharmacy)\b/i, /\bneed a refill\b/i] },
  { industry: 'healthcare', specialty: 'general', intent: 'reschedule',
    anchors: [/\b(reschedul\w+|cancel|move|change)\b[^.]{0,25}\bmy appointment\b/i, /\bmy appointment\b[^.]{0,25}\b(reschedul\w+|cancel)\w*/i] },
  { industry: 'healthcare', specialty: 'general', intent: 'records_request',
    anchors: [/\b(my )?(medical )?records\b[^.]{0,35}\b(sent|transferred|released|another (doctor|office|provider))\b/i,
              /\b(test|lab|blood|biopsy|scan)\b[^.]{0,15}\bresults?\b/i,
              /\bresults?\b[^.]{0,25}\b(back|in|ready|available)\b/i,
              /\brelease of information\b/i],
    support: [/\b(doctor|office|nurse|patient|wife|husband)\b/i] },
  { industry: 'healthcare', specialty: 'general', intent: 'billing_question',
    anchors: [/\b(question|call\w*|confused)\b[^.]{0,30}\bmy bill\b/i, /\bmy bill\b[^.]{0,30}\b(question|wrong|high|insurance)\b/i,
              /\bbilling (department|question)\b/i] },
  { industry: 'healthcare', specialty: 'general', intent: 'general_inquiry',
    anchors: [/\bmedical records\b/i, /\bdo you (take|accept)\b[^.]{0,25}\b(insurance|blue cross|aetna|cigna|medicare|medicaid|united)\b/i] },

  // ================= INSURANCE =================
  { industry: 'insurance', specialty: 'general', intent: 'quote_request',
    anchors: [/\b(quote|rate)\b[^.]{0,30}\b(insurance|coverage|policy)\b/i, /\binsurance quote\b/i,
              /\b(auto|home|life|renters?|business) insurance\b/i],
    support: [/\bpremium\b/i, /\bcarrier\b/i, /\bswitch\b/i] },
  { industry: 'insurance', specialty: 'general', intent: 'claim_report',
    anchors: [/\bfile a claim\b/i, /\breport a claim\b/i, /\bmy (insurance )?claim\b/i, /\bstart a claim\b/i],
    support: [/\bpolicy\b/i, /\badjuster\b/i, /\bdamage\b/i, /\bdeductible\b/i] },
  { industry: 'insurance', specialty: 'general', intent: 'coverage_question',
    anchors: [/\b(is|are|am i|does my policy)\b[^.]{0,35}\b(covered|cover)\b/i,
              /\bcovered under my (policy|insurance)\b/i, /\bwhat('s| is) my deductible\b/i,
              /\bdo i have coverage\b/i] },
  { industry: 'insurance', specialty: 'general', intent: 'policy_change',
    anchors: [/\badd (a car|a vehicle|a driver)\b[^.]{0,25}\bpolicy\b/i, /\bchange my policy\b/i, /\bproof of insurance\b/i,
              /\bmy premium went up\b/i, /\bmy policy\b/i] },

  // ================= FINANCIAL SERVICES =================
  { industry: 'financial_services', specialty: 'general', intent: 'retirement_planning',
    anchors: [/\bretirement (planning|plan)\b/i, /\b401 ?k\b/i, /\bira\b/i, /\broll(ing)? over\b[^.]{0,25}\b401|ira\b/i] },
  { industry: 'financial_services', specialty: 'general', intent: 'tax_services',
    anchors: [/\b(do|file|prepare)\b[^.]{0,25}\b(my|our|business) taxes\b/i,
              /\btax (preparation|preparer|accountant|return|notice|letter|extension|deadline)\b/i,
              /\bcpa\b/i, /\birs\b/i,
              /\b(letter|notice)\b[^.]{0,30}\birs\b/i],
    support: [/\b(don'?t know what to do|penalty|audit|owe)\b/i] },
  { industry: 'financial_services', specialty: 'general', intent: 'bookkeeping',
    anchors: [/\bbookkeep\w+/i, /\bpayroll\b[^.]{0,25}\bservice\b/i] },
  { industry: 'financial_services', specialty: 'general', intent: 'new_client_inquiry',
    anchors: [/\bfinancial (advisor|planner|planning)\b/i, /\bwealth manage\w+/i, /\binvestment advisor\b/i,
              /\b(current|my|our)\b[^.]{0,15}\badvisor\b/i, /\bswitch\w*\b[^.]{0,25}\badvisor\b/i,
              /\binherited\b[^.]{0,35}\b(money|estate)\b/i] },

  // ================= PROFESSIONAL SERVICES =================
  { industry: 'professional_services', specialty: 'general', intent: 'new_engagement',
    anchors: [/\b(consulting|consultancy|advisory) (services?|firm|help)\b/i,
              /\blooking for a (firm|consultant|partner)\b/i, /\bsend us a proposal\b/i,
              /\bneed outside help\b/i, /\bstatement of work\b/i,
              /\b(existing|current|our) engagement\b/i, /\bscope of work\b/i] },

  // ================= MANUFACTURING =================
  { industry: 'manufacturing', specialty: 'general', intent: 'rfq',
    anchors: [/\b(rfq|request for quote)\b/i, /\bquote\b[^.]{0,35}\b(machined|part|parts|units|fabricat\w+|tooling|castings?)\b/i,
              /\b(machin\w+|fabricat\w+|cnc|injection mold\w*|stamping)\b[^.]{0,30}\b(part|quote|run)\b/i],
    support: [/\bdrawings?\b/i, /\bcad\b/i, /\btolerance\w*/i, /\bmaterial\b/i, /\bquantity\b/i] },
  { industry: 'manufacturing', specialty: 'general', intent: 'rfq',
    anchors: [/\b[\d,]{3,}\s*(units?|pieces?|parts?|pcs)\b/i, /\bwe need [\d,]+\b/i,
              /\b(anodi[sz]\w+|plating|powder ?coat\w*|heat treat\w*|passivat\w+|welding)\b/i,
              /\b(hold|holding)\b[^.]{0,35}\b(tolerance|thou|thousandth|tenth|micron|\.\d{3})\b/i,
              /\b(tolerance|thou|thousandth|tenth of a thou)\b[^.]{0,30}\b(stainless|aluminum|aluminium|steel|titanium|inconel|brass)\b/i,
              /\bon (stainless|aluminum|aluminium|titanium|inconel)\b/i,
              /\bin house\b[^.]{0,20}\b(finish\w*|machin\w*|coat\w*)\b/i],
    support: [/\bdrawings?\b/i, /\bprints?\b/i, /\bquote\b/i, /\bcapabilit\w+/i] },
  { industry: 'manufacturing', specialty: 'general', intent: 'quality_issue',
    anchors: [/\bout of spec\b/i, /\bnonconform\w+/i, /\bour line (is )?down\b/i, /\b(production|assembly) line\b[^.]{0,20}\bdown\b/i,
              /\bdefective parts?\b/i, /\bscrapp\w+\b[^.]{0,20}\bparts?\b/i],
    // "a power line down across the road" is a utility emergency, and a
    // nonconformance raised under AS9100/ITAR belongs to the aerospace
    // program desk.
    veto: [/\bpower line\b/i, /\bacross the road\b/i, /\b(as9100|itar|dfars|cmmc|nadcap)\b/i] },
  { industry: 'manufacturing', specialty: 'general', intent: 'order_status_manufacturing',
    anchors: [/\b(purchase order|our po)\b/i, /\bwhere (is|are) (our|my) parts?\b/i,
              /\bwhere (is|are) (our|my) order\b[^.]{0,40}\b(po|purchase order|parts?|production)\b/i],
    support: [/\bpo\b/i, /\bweeks ago\b/i, /\blead time\b/i] },

  // ================= LOGISTICS =================
  { industry: 'logistics', specialty: 'general', intent: 'freight_quote',
    anchors: [/\b(freight|shipping|ship)\b[^.]{0,35}\b(quote|rate|pallet|ltl|truckload)\b/i,
              /\bquote to ship\b/i, /\b(reefer|flatbed|dry van|ltl)\b/i,
              /\b(rate|quote|price)\b[^.]{0,35}\b(move|haul|ship|transport)\b/i,
              /\b(move|haul|ship|transport)\b[^.]{0,30}\bpallets?\b/i,
              /\b\d+\s*pallets?\b/i,
              /\bfrom \w+ to \w+\b[^.]{0,25}\b(pallet|freight|load|truck)\b/i],
    support: [/\bpallet\w*/i, /\bweight\b/i, /\bpickup\b/i] },
  { industry: 'logistics', specialty: 'general', intent: 'shipment_tracking',
    anchors: [/\bwhere is my (shipment|freight|load|delivery)\b/i, /\btrack\w*\b[^.]{0,25}\b(shipment|freight|load)\b/i,
              /\b(pro|bol) number\b/i, /\bmy (delivery|shipment) (never|hasn'?t) (showed|arrived|come)\b/i] },
  { industry: 'logistics', specialty: 'general', intent: 'pickup_request',
    anchors: [/\bschedule a pickup\b/i, /\bneed a pickup\b/i, /\bcapacity out of\b/i] },
  { industry: 'logistics', specialty: 'general', intent: 'damage_claim',
    anchors: [/\b(freight|shipment|pallet|load|skid)\b[^.]{0,35}\b(arrived|came|showed up|delivered)\b[^.]{0,20}\bdamage\w*/i,
              /\b(freight|shipment|pallet|load)\b[^.]{0,25}\bdamage\w*/i,
              /\bdamage\w*\b[^.]{0,25}\b(freight|shipment|pallet|load)\b/i,
              /\bfreight claim\b/i] },

  // ================= ENERGY =================
  { industry: 'energy', specialty: 'general', intent: 'safety_report', urgency: 'emergency',
    anchors: [/\bsmell gas\b/i, /\bgas leak\b/i, /\bpower line (down|hanging)\b/i, /\bdowned (power )?line\b/i] },
  { industry: 'energy', specialty: 'general', intent: 'outage_report',
    anchors: [/\bpower('s| is| has been) (out|off)\b/i, /\boutage\b/i,
              /\b(without|no) power for\b/i, /\b(facility|building|plant|site)\b[^.]{0,35}\b(without power|no power|power (is )?out)\b/i],
    support: [/\bhours?\b/i, /\bneighborhood\b/i] },
  { industry: 'energy', specialty: 'general', intent: 'project_inquiry',
    anchors: [/\benergy (efficiency|project|audit)\b/i, /\butility (project|program)\b/i, /\b(storage|generation) project\b/i,
              /\bdemand response\b/i, /\bpower purchase agreement\b/i, /\bppa\b/i,
              /\b(vendor|supplier) list\b/i, /\bget on your (vendor|supplier) list\b/i],
    support: [/\b(utility|facility|grid|kw|mw|energy|power)\b/i] },

  // ================= DEFENSE & AEROSPACE =================
  { industry: 'defense_aerospace', specialty: 'general', intent: 'capability_inquiry',
    anchors: [/\b(as9100|itar|dfars|cmmc|nadcap)\b/i, /\bdefense (contract\w*|supplier|program)\b/i,
              /\baerospace\b[^.]{0,30}\b(part|program|supplier|component)\b/i,
              /\b(rfi|rfp)\b[^.]{0,35}\b(defense|aerospace|program|your company)\b/i,
              /\bcapability (requirement|statement|briefing)\b/i,
              /\bget (qualified|approved)\b[^.]{0,25}\bsupplier\b/i,
              /\bsupplier\b[^.]{0,30}\bget(ting)? qualified\b/i,
              /\bexisting contract\b/i, /\bprime contractor\b/i, /\bsubcontract\w*/i,
              /\b(approved|qualified) (vendor|supplier) list\b/i,
              /\b(controlled|export.controlled|classified)\b[^.]{0,20}\b(part|drawing|data|document)/i,
              /\bdrawings?\b[^.]{0,30}\bcontrolled\b/i],
    // "approved vendor list" also matches energy's general rule; the
    // corroboration is what separates an aerospace supplier enquiry
    // from a utility one.
    support: [/\b(supplier|vendor|qualified|certification|aerospace|defense|program|part)\b/i] },

  // ================= SOLAR =================
  { industry: 'solar', specialty: 'general', intent: 'solar_quote',
    anchors: [/\bsolar\b/i, /\bgo(ing)? solar\b/i, /\bnet meter\w*/i,
              /\b(electric|power|utility) bill\b[^.]{0,35}\b(out of control|insane|crazy|ridiculous|too high|so high)\b/i,
              /\b(federal |investment )?tax credit\b/i],
    support: [/\belectric bill\b/i, /\broof\b/i, /\btax credit\b/i, /\bpanels?\b/i, /\bwarehouse\b/i, /\bkwh\b/i] },
  { industry: 'solar', specialty: 'general', intent: 'production_issue',
    anchors: [/\bsolar\b[^.]{0,35}\b(not (working|producing)|stopped|down|offline)\b/i, /\binverter\b/i,
              /\bnot producing\b/i,
              /\b(app|monitoring|system)\b[^.]{0,35}\b(not producing|no production|offline|zero)\b/i,
              /\b(panels?|array)\b[^.]{0,30}\b(not|stopped|down)\b/i] },
  { industry: 'solar', specialty: 'general', intent: 'battery_storage',
    anchors: [/\bbattery (backup|storage)\b/i, /\bpowerwall\b/i] },

  // ================= FIBER & BROADBAND =================
  { industry: 'fiber_broadband', specialty: 'general', intent: 'availability_check',
    anchors: [/\b(fiber|fibre|broadband|internet)\b[^.]{0,35}\b(available|at my address|in my area|service)\b/i,
              /\bdo you (have|offer)\b[^.]{0,25}\b(fiber|fibre|internet|broadband)\b/i] },
  { industry: 'fiber_broadband', specialty: 'general', intent: 'service_outage',
    anchors: [/\b(internet|wifi|wi-fi|service|connection)\b[^.]{0,30}\b(is )?(out|down|not work\w*)\b/i],
    support: [/\bmodem\b/i, /\brouter\b/i, /\boutage\b/i] },
  { industry: 'fiber_broadband', specialty: 'general', intent: 'speed_issue',
    anchors: [/\b(speeds?|internet)\b[^.]{0,30}\b(slow|slower than)\b/i] },
  { industry: 'fiber_broadband', specialty: 'general', intent: 'new_service_order',
    anchors: [/\bswitch from (cable|my provider)\b/i, /\bbusiness internet\b/i, /\bnew internet service\b/i,
              /\b(install|hook ?up|turn on|activate)\b[^.]{0,30}\b(fiber|fibre|internet|service|modem)\b/i,
              /\b(fiber|fibre|internet)\b[^.]{0,25}\binstall\w*/i] },
  { industry: 'fiber_broadband', specialty: 'general', intent: 'plant_damage',
    anchors: [/\b(cable|line|fiber|fibre|drop)\b[^.]{0,35}\b(hanging (down|low)|down in my yard|laying (in|across))\b/i,
              /\bburied (my |the )?(cable|line|drop)\b/i, /\btemporary (cable|line|drop)\b/i] },

  // ================= E-COMMERCE =================
  { industry: 'ecommerce', specialty: 'general', intent: 'order_status',
    anchors: [/\bwhere('s| is) my (order|package)\b/i, /\border status\b/i,
              /\bmy (order|package)\b[^.]{0,35}\b(hasn'?t|never|was supposed to)\b/i,
              /\btrack(ing)? (my |the )?(order|package)\b/i],
    support: [/\border number\b/i, /\btracking\b/i, /\bwebsite\b/i],
    veto: [/\b(purchase order|our po|freight|pallet|drawings?)\b/i] },
  { industry: 'ecommerce', specialty: 'general', intent: 'product_question',
    anchors: [/\b(does|do) (this|it|you)\b[^.]{0,30}\b(come in|have it in|carry)\b[^.]{0,25}\b(size|color|colour|larger|smaller)\b/i,
              /\bin stock\b[^.]{0,25}\b(size|color|colour)\b/i, /\bwhat sizes?\b/i] },
  { industry: 'ecommerce', specialty: 'general', intent: 'wholesale_inquiry',
    anchors: [/\b(stock|carry|sell)\b[^.]{0,30}\byour products?\b/i, /\bwholesale\b/i, /\bresell\w*/i,
              /\bin our store\b/i] },
  { industry: 'ecommerce', specialty: 'general', intent: 'return_request',
    anchors: [/\b(return|exchange)\b[^.]{0,30}\b(item|order|product|it)\b/i, /\bwant to return\b/i, /\brefund\b/i] },
  { industry: 'ecommerce', specialty: 'general', intent: 'damaged_item',
    anchors: [/\b(arrived|came|got (it|the))\b[^.]{0,25}\b(damaged|broken|wrong)\b/i, /\bwrong (item|size|colour|color)\b/i] },
];

/** Utterances that signal danger regardless of industry. */
export const EMERGENCY_MARKERS = [
  /\bemergency\b/i, /\bright now\b/i, /\bpouring\b/i, /\bgushing\b/i, /\bflooding\b/i,
  /\bburst\b/i, /\bon fire\b/i, /\bsmoke\b/i, /\bcan'?t breathe\b/i, /\bbleeding\b/i,
];
