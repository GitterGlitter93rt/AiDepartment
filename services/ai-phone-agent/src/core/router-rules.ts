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
  anchors: RegExp[];
  support?: RegExp[];
}

export const RULES: Rule[] = [
  // ================= ATTORNEYS =================
  { industry: 'attorneys', specialty: 'family_law', intent: 'divorce',
    anchors: [/\bdivorc\w*/i, /\bdissolution of marriage\b/i, /\bserved me (with )?(divorce )?papers\b/i, /\bsplitting up with my (wife|husband)\b/i],
    support: [/\b(wife|husband|spouse|marriage|married|ex)\b/i, /\balimony\b/i, /\bprenup\w*/i, /\bseparat\w+/i] },
  { industry: 'attorneys', specialty: 'family_law', intent: 'child_custody',
    anchors: [/\bcustody\b/i, /\bvisitation\b/i, /\bparenting (plan|time)\b/i, /\bwho gets the (kids|children)\b/i],
    support: [/\b(kids|children|son|daughter|my ex)\b/i] },
  { industry: 'attorneys', specialty: 'family_law', intent: 'child_support',
    anchors: [/\bchild support\b/i, /\bsupport payments?\b/i],
    support: [/\b(kids|children|ex|behind|owes)\b/i] },
  { industry: 'attorneys', specialty: 'family_law', intent: 'domestic_violence', urgency: 'emergency',
    anchors: [/\bprotective order\b/i, /\brestraining order\b/i, /\bdomestic violence\b/i, /\b(he|she) (hit|threatened|assaulted) me\b/i],
    support: [/\bafraid\b/i, /\bscared\b/i, /\bsafe\b/i] },
  { industry: 'attorneys', specialty: 'personal_injury', intent: 'car_accident',
    anchors: [/\b(car|auto|motorcycle|truck|motor vehicle) (accident|crash|wreck)\b/i, /\brear[- ]?ended\b/i, /\bt[- ]?boned\b/i, /\bhit by a (car|truck|driver)\b/i],
    support: [/\binjur\w+/i, /\bhurt\b/i, /\bhospital\b/i, /\bwhiplash\b/i, /\badjuster\b/i] },
  { industry: 'attorneys', specialty: 'personal_injury', intent: 'slip_and_fall',
    anchors: [/\bslip(ped)? and fell\b/i, /\bslip and fall\b/i, /\bfell (at|in) (the|a) \w+/i, /\btripped (over|on)\b/i],
    support: [/\binjur\w+/i, /\bbroke my\b/i, /\bstore\b/i] },
  { industry: 'attorneys', specialty: 'personal_injury', intent: 'injury_claim',
    anchors: [/\bpersonal injury\b/i, /\bi was (hurt|injured)\b/i, /\bwrongful death\b/i, /\bdog (bit|attacked)\b/i, /\bmedical malpractice\b/i],
    support: [/\blawyer\b/i, /\battorney\b/i, /\bclaim\b/i] },
  { industry: 'attorneys', specialty: 'criminal_defense', intent: 'criminal_charge',
    anchors: [/\barrested\b/i, /\bcharged with\b/i, /\b(dui|dwi)\b/i, /\bfelony\b/i, /\bmisdemean\w+/i, /\bcriminal defense\b/i, /\bwarrant\b/i, /\bin jail\b/i, /\bprobation violation\b/i, /\bexpunge\w*/i],
    support: [/\bcourt date\b/i, /\bbail\b/i, /\bbond\b/i, /\bpolice\b/i] },
  { industry: 'attorneys', specialty: 'probate_estate', intent: 'probate',
    anchors: [/\bprobate\b/i, /\bestate (administration|dispute)\b/i, /\bexecutor\b/i, /\bcontest\w+ (the )?(will|estate)\b/i, /\b(passed away|died)\b[^.]{0,50}\b(estate|will|probate)\b/i],
    support: [/\bwill\b/i, /\binherit\w+/i, /\bbeneficiar\w+/i] },
  { industry: 'attorneys', specialty: 'probate_estate', intent: 'will_drafting',
    anchors: [/\b(draw up|write|make|need|update) a will\b/i, /\bset up a trust\b/i, /\bpower of attorney\b/i, /\bestate planning\b/i, /\bguardianship\b/i] },
  { industry: 'attorneys', specialty: 'general', intent: 'legal_inquiry',
    anchors: [/\b(lawyer|attorney|law firm|legal advice|lawsuit|being sued|sue (them|him|her|someone))\b/i] },

  // ================= PLUMBING =================
  { industry: 'plumbing', specialty: 'emergency', intent: 'active_water_leak', urgency: 'emergency',
    anchors: [/\bwater (is )?(pouring|gushing|spraying|flooding|everywhere|shooting)\b/i, /\b(burst|broken|busted) pipe\b/i, /\bpipe (burst|broke)\b/i, /\bwater (all )?over the floor\b/i],
    support: [/\b(sink|toilet|faucet|tub|shower|pipe|drain|basement|kitchen|bathroom|ceiling|wall)\b/i, /\bshut ?off\b/i, /\bvalve\b/i, /\bleak\w*/i] },
  { industry: 'plumbing', specialty: 'emergency', intent: 'toilet_overflow', urgency: 'emergency',
    anchors: [/\btoilet (is )?overflow\w*/i, /\btoilet (is )?running over\b/i, /\boverflowing toilet\b/i],
    support: [/\bwater\b/i, /\bfloor\b/i] },
  { industry: 'plumbing', specialty: 'emergency', intent: 'active_water_leak', urgency: 'high',
    anchors: [/\bleak\w*\b[^.]{0,40}\b(sink|toilet|faucet|tub|shower|water heater|pipe|drain|supply line)\b/i,
              /\b(sink|toilet|faucet|tub|shower|water heater|pipe|drain|supply line)\b[^.]{0,40}\bleak\w*/i],
    support: [/\bwater\b/i, /\bdrip\w*/i, /\bunder\b/i] },
  { industry: 'plumbing', specialty: 'drains', intent: 'sewer_backup', urgency: 'emergency',
    anchors: [/\bsewer\w* (back\w*|line)\b/i, /\bsewage\b/i, /\bbacking up into\b/i],
    support: [/\bsmell\b/i, /\bshower\b/i, /\btoilet\b/i] },
  { industry: 'plumbing', specialty: 'drains', intent: 'clogged_drain',
    anchors: [/\bclog\w*/i, /\bdrains? (keep )?back\w+ up\b/i, /\bbacked up\b/i, /\bdrain\w* (is )?(slow|blocked)\b/i, /\bwon'?t drain\b/i],
    support: [/\b(toilet|sink|drain|shower|tub)\b/i] },
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
    support: [/\bdamage\w*/i, /\bshingle\w*/i, /\bleak\w*/i, /\binsurance\b/i, /\bmissing\b/i] },
  { industry: 'roofing', specialty: 'emergency', intent: 'active_leak', urgency: 'high',
    anchors: [/\broof\w*\b[^.]{0,40}\bleak\w*/i, /\bleak\w*\b[^.]{0,40}\broof\b/i,
              /\bceiling\b[^.]{0,40}\b(leak|drip|water|stain|spot|brown)\w*/i,
              /\b(brown|water) (spot|stain)\b[^.]{0,30}\bceiling\b/i],
    support: [/\bwater\b/i, /\bbucket\b/i, /\battic\b/i, /\bspreading\b/i] },
  { industry: 'roofing', specialty: 'storm', intent: 'tree_impact', urgency: 'emergency',
    anchors: [/\btree\b[^.]{0,40}\b(roof|house|home)\b/i, /\b(tree|limb|branch)\b[^.]{0,25}\b(fell|came down|went through)\b/i] },
    // NOTE: also matched by landscaping tree work; margin decides.
  { industry: 'roofing', specialty: 'insurance', intent: 'insurance_claim',
    anchors: [/\b(insurance|adjuster|claim)\b[^.]{0,50}\broof\w*/i, /\broof\w*\b[^.]{0,50}\b(insurance|adjuster|claim)\b/i] },
  { industry: 'roofing', specialty: 'replacement', intent: 'roof_replacement',
    anchors: [/\b(new|replace|replacing|replacement)\b[^.]{0,25}\broof\b/i, /\broof\b[^.]{0,25}\breplac\w+/i, /\bre-?roof\w*/i],
    support: [/\byears old\b/i, /\bquote\b/i, /\bestimate\b/i] },
  { industry: 'roofing', specialty: 'general', intent: 'general_inquiry',
    anchors: [/\broof(s|ing|er)?\b/i, /\bshingle\w*/i, /\bgutter\w*/i, /\bflashing\b/i] },

  // ================= HVAC =================
  { industry: 'hvac', specialty: 'cooling', intent: 'no_cooling', urgency: 'high',
    anchors: [/\b(a\/?c|air ?condition\w*)\b[^.]{0,40}\b(not work\w*|stopped|broke|down|out|dead|blowing (warm|hot))\b/i,
              /\bno (a\/?c|air ?condition\w*|cool\w*)\b/i, /\bnot (cooling|blowing cold)\b/i],
    support: [/\bhot\b/i, /\bdegrees\b/i, /\bhouse\b/i] },
  { industry: 'hvac', specialty: 'heating', intent: 'no_heat', urgency: 'high',
    anchors: [/\bno heat\b/i, /\bheat(er|ing)?\b[^.]{0,30}\b(not work\w*|stopped|broke|won'?t (come|turn) on|out)\b/i, /\bfurnace\b[^.]{0,30}\b(not|won'?t|stopped|broke)\b/i],
    support: [/\bcold\b/i, /\bfreez\w+/i, /\bdegrees\b/i] },
  { industry: 'hvac', specialty: 'general', intent: 'furnace_repair',
    anchors: [/\bfurnace\b/i, /\bheat pump\b/i, /\bmini[- ]?split\b/i] },
  { industry: 'hvac', specialty: 'general', intent: 'system_replacement',
    anchors: [/\b(new|replace|replacing)\b[^.]{0,30}\b(a\/?c|air ?condition\w*|hvac|furnace|system)\b/i, /\bhvac\b[^.]{0,20}\bquote\b/i] },
  { industry: 'hvac', specialty: 'general', intent: 'general_service',
    anchors: [/\bhvac\b/i, /\bair ?condition\w*/i, /\bthermostat\b/i, /\bduct(work)?\b/i, /\bmaintenance plan\b/i] },

  // ================= ELECTRICAL =================
  { industry: 'electrical', specialty: 'emergency', intent: 'burning_smell', urgency: 'emergency',
    anchors: [/\bburning smell\b[^.]{0,40}\b(outlet|panel|breaker|wall|switch)\b/i, /\b(outlet|panel|breaker|switch)\b[^.]{0,30}\b(burning|smok\w+|melt\w+|scorch\w+)\b/i, /\bsmells? like (something is )?burning\b/i] },
  { industry: 'electrical', specialty: 'emergency', intent: 'sparking', urgency: 'emergency',
    anchors: [/\bspark\w+\b[^.]{0,30}\b(outlet|panel|breaker|switch|wire)\b/i, /\b(outlet|panel|breaker|switch)\b[^.]{0,25}\bspark\w+/i, /\bgot (a )?shock\w*\b/i, /\bshocked me\b/i] },
  { industry: 'electrical', specialty: 'general', intent: 'breaker_tripping',
    anchors: [/\bbreaker\b[^.]{0,40}\b(trip\w*|keeps? (going|flipping) off|won'?t (stay )?reset)\b/i, /\bkeeps? tripping\b/i, /\bfuse\b[^.]{0,20}\bblow\w*/i] },
  { industry: 'electrical', specialty: 'general', intent: 'power_outage_partial',
    anchors: [/\b(half|part) of (my|the) (house|home|building)\b[^.]{0,30}\b(no power|out|dark)\b/i, /\bno power (in|to)\b/i, /\bouts? of power in (one|a) room\b/i] },
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
    anchors: [/\b(rats?|mice|mouse|rodents?)\b/i, /\bsomething (living|scratching) in (my|the) (attic|walls|ceiling)\b/i],
    support: [/\battic\b/i, /\bdropping\w*/i, /\bgarage\b/i] },
  { industry: 'pest_control', specialty: 'general', intent: 'roaches',
    anchors: [/\broach\w*/i, /\bcockroach\w*/i], support: [/\bkitchen\b/i] },
  { industry: 'pest_control', specialty: 'general', intent: 'wasps_bees',
    anchors: [/\b(wasp|hornet|yellow ?jacket|bee)s?\b[^.]{0,25}\bnest\b/i, /\bnest\b[^.]{0,25}\b(wasp|hornet|bee)s?\b/i, /\bwasps?\b/i, /\bhornets?\b/i] },
  { industry: 'pest_control', specialty: 'general', intent: 'general_service',
    anchors: [/\bpest control\b/i, /\bexterminat\w+/i, /\b(ants?|spiders?|fleas?|mosquito\w*|silverfish|scorpions?)\b/i, /\bquarterly (service|treatment)\b/i] },

  // ================= GARAGE DOOR =================
  { industry: 'garage_door', specialty: 'general', intent: 'broken_spring', urgency: 'high',
    anchors: [/\bgarage door\b[^.]{0,40}\bspring\b/i, /\bspring\b[^.]{0,30}\b(snapped|broke|broken)\b/i] },
  { industry: 'garage_door', specialty: 'general', intent: 'door_off_track', urgency: 'high',
    anchors: [/\bgarage door\b[^.]{0,40}\b(off (the )?track|crooked|jammed|stuck)\b/i, /\boff (the )?track\b/i] },
  { industry: 'garage_door', specialty: 'general', intent: 'opener_failure',
    anchors: [/\bgarage (door )?opener\b/i, /\bopener\b[^.]{0,30}\b(not work\w*|clicks?|dead|broken)\b/i] },
  { industry: 'garage_door', specialty: 'general', intent: 'general_service',
    anchors: [/\bgarage doors?\b/i], support: [/\bremote\b/i, /\bkeypad\b/i, /\bpanel\b/i, /\bdent\w*/i] },

  // ================= POOL =================
  { industry: 'pool', specialty: 'general', intent: 'green_pool',
    anchors: [/\bpool\b[^.]{0,30}\b(green|cloudy|murky|algae)\b/i, /\b(green|cloudy|algae)\b[^.]{0,20}\bpool\b/i] },
  { industry: 'pool', specialty: 'general', intent: 'pump_failure',
    anchors: [/\bpool (pump|filter|heater)\b/i, /\bpump\b[^.]{0,25}\b(stopped|not work\w*|broke|dead)\b/i] },
  { industry: 'pool', specialty: 'general', intent: 'general_service',
    anchors: [/\bpool\b/i], support: [/\bservice\b/i, /\bclean\w*/i, /\bchemical\w*/i, /\bresurfac\w+/i, /\bweekly\b/i, /\bchlorine\b/i, /\bsalt\b/i] },

  // ================= SCREEN ENCLOSURE =================
  { industry: 'screen_enclosure', specialty: 'general', intent: 'screen_repair',
    anchors: [/\bscreen\w*\b[^.]{0,30}\b(torn|rip\w+|hole|damage\w*|repair)\b/i, /\b(pool cage|lanai)\b/i, /\brescreen\w*/i],
    support: [/\benclosure\b/i, /\bpatio\b/i, /\bporch\b/i] },
  { industry: 'screen_enclosure', specialty: 'general', intent: 'quote_request',
    anchors: [/\bscreen enclosure\b/i, /\bscreen (room|porch)\b/i] },

  // ================= LANDSCAPING =================
  { industry: 'landscaping', specialty: 'general', intent: 'lawn_maintenance',
    anchors: [/\b(mow|mowing|cut)\b[^.]{0,25}\b(lawn|grass|yard)\b/i, /\blawn (care|service|maintenance)\b/i, /\byard (work|maintenance)\b/i] },
  { industry: 'landscaping', specialty: 'general', intent: 'landscape_design',
    anchors: [/\blandscap\w+/i, /\b(paver|outdoor kitchen|fire pit|retaining wall|hardscape)\b/i, /\bsod\b/i] },
  { industry: 'landscaping', specialty: 'general', intent: 'irrigation',
    anchors: [/\b(sprinkler|irrigation)\b/i] },
  { industry: 'landscaping', specialty: 'general', intent: 'tree_service',
    anchors: [/\btree (removal|service|trimming|down)\b/i, /\btrim\w*\b[^.]{0,20}\btrees?\b/i] },
  { industry: 'landscaping', specialty: 'general', intent: 'drainage',
    anchors: [/\b(yard|back ?yard|lawn)\b[^.]{0,30}\bflood\w*/i, /\bdrainage (issue|problem)\b/i, /\bstanding water\b[^.]{0,20}\byard\b/i] },

  // ================= RESTORATION =================
  { industry: 'restoration', specialty: 'general', intent: 'water_damage', urgency: 'emergency',
    anchors: [/\b(basement|house|home|floor)\b[^.]{0,30}\bflood\w+/i, /\bflood\w+\b[^.]{0,25}\b(basement|house|home)\b/i,
              /\bwater damage\b/i, /\bfoot of water\b/i, /\bsoaked\b/i, /\bwater (got|came) in\b/i],
    support: [/\bcarpet\b/i, /\bdrywall\b/i, /\bcleanup\b/i, /\brestoration\b/i] },
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
    anchors: [/\b(general )?contractor\b/i, /\bremodel\w*/i, /\brenovat\w+/i, /\bnew (home |house )?construction\b/i, /\bbuild(ing)? a (new )?(house|home)\b/i, /\bbuild ?out\b/i, /\bdeck\b[^.]{0,25}\b(rebuild|rot\w*|replace)\b/i] },

  // ================= PRESSURE WASHING =================
  { industry: 'pressure_washing', specialty: 'general', intent: 'driveway',
    anchors: [/\b(driveway|sidewalk|walkway|patio|deck|concrete|pool deck)\b[^.]{0,40}\b(wash\w*|clean\w*|power ?wash\w*|pressure ?wash\w*)\b/i,
              /\b(pressure|power) ?wash\w*\b[^.]{0,40}\b(driveway|sidewalk|walkway|patio|deck|concrete)\b/i,
              /\bdriveway (is|looks) (black|filthy|awful|terrible|disgusting)\b/i],
    support: [/\b(pressure|power|soft) ?wash\w*/i, /\bstain\w*/i, /\bmildew\b/i, /\balgae\b/i] },
  { industry: 'pressure_washing', specialty: 'general', intent: 'house_wash',
    anchors: [/\b(house|home|siding|exterior|storefront|building)\b[^.]{0,35}\b(wash\w*|soft ?wash\w*|power ?wash\w*|pressure ?wash\w*)\b/i,
              /\b(pressure|power|soft) ?wash\w*\b[^.]{0,35}\b(house|home|siding|exterior|storefront|building)\b/i],
    support: [/\bgreen\b/i, /\bmildew\b/i, /\bstain\w*/i] },
  { industry: 'pressure_washing', specialty: 'general', intent: 'roof_cleaning',
    anchors: [/\broof\b[^.]{0,30}\b(clean\w*|wash\w*|soft ?wash\w*)\b/i, /\b(soft ?wash|clean)\w*\b[^.]{0,20}\broof\b/i],
    support: [/\balgae\b/i, /\bmoss\b/i, /\bblack streak\w*/i] },
  { industry: 'pressure_washing', specialty: 'general', intent: 'quote_request',
    anchors: [/\b(pressure|power|soft) ?wash\w*/i] },

  // ================= COLLISION REPAIR =================
  { industry: 'collision_repair', specialty: 'general', intent: 'accident_repair',
    anchors: [/\b(body|collision) (shop|work|repair)\b/i, /\b(car|truck|vehicle|bumper|fender|door)\b[^.]{0,30}\b(dent\w*|damage\w*|smashed|wrecked|banged up)\b/i,
              /\bestimate\b[^.]{0,25}\b(body work|repair|car)\b/i],
    support: [/\baccident\b/i, /\binsurance\b/i, /\bclaim\b/i, /\badjuster\b/i] },
  { industry: 'collision_repair', specialty: 'general', intent: 'hail_damage_auto',
    anchors: [/\bhail\b[^.]{0,35}\b(car|truck|vehicle|hood|roof of my car)\b/i, /\bhail damage\b[^.]{0,25}\b(car|vehicle)\b/i] },
  { industry: 'collision_repair', specialty: 'general', intent: 'towing_needed',
    anchors: [/\bcar (is )?not drivable\b/i, /\bneed(s)? (a )?tow\w*/i, /\btow (my|the) car\b/i] },

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
              /\bin the market for a (house|home)\b/i],
    support: [/\bpre.?approv\w+/i, /\bmortgage\b/i, /\brealtor\b/i, /\bagent\b/i, /\bbedroom\w*/i] },
  { industry: 'real_estate', specialty: 'seller', intent: 'seller_inquiry',
    anchors: [/\b(sell|selling|list|listing)\b[^.]{0,30}\b(house|home|condo|property)\b/i,
              /\bput (my|the) (house|home|condo) on the market\b/i, /\bwant to list\b/i],
    support: [/\brealtor\b/i, /\bagent\b/i, /\bmarket\b/i] },
  { industry: 'real_estate', specialty: 'valuation', intent: 'home_valuation',
    anchors: [/\bwhat.{0,20}(my (house|home)).{0,20}worth\b/i, /\bhome valuation\b/i, /\bmarket analysis\b/i, /\bhow much (is|could) (my|our) (house|home)\b/i] },
  { industry: 'real_estate', specialty: 'showing', intent: 'showing_request',
    anchors: [/\b(schedule|book|set up|arrange)\b[^.]{0,25}\b(showing|viewing|tour)\b/i,
              /\b(see|look at|tour)\b[^.]{0,30}\b(the )?(house|home|property|listing|place) (on|at)\b/i,
              /\bopen house\b/i, /\bstill available\b[^.]{0,25}\b(house|home|listing|place)\b/i] },
  { industry: 'real_estate', specialty: 'rental', intent: 'rental_investor',
    anchors: [/\b(investment|rental) propert\w+/i, /\bbuy (a )?rental\b/i, /\binvestor\b/i] },
  { industry: 'real_estate', specialty: 'general', intent: 'relocation',
    anchors: [/\b(moving|relocating) to\b[^.]{0,40}\b(need|looking|realtor|agent)\b/i, /\brelocat\w+\b[^.]{0,30}\b(realtor|agent|house|home)\b/i] },
  { industry: 'real_estate', specialty: 'general', intent: 'general_inquiry',
    anchors: [/\breal estate\b/i, /\brealtor\b/i, /\bmls\b/i] },

  // ================= PROPERTY MANAGEMENT =================
  { industry: 'property_management', specialty: 'general', intent: 'maintenance_request',
    anchors: [/\b(my|the) (apartment|unit|rental)\b[^.]{0,40}\b(broke|broken|not work\w*|leak\w*|out)\b/i,
              /\bmaintenance request\b/i, /\btell (my|the) landlord\b/i,
              /\b(landlord|property manager)\b[^.]{0,30}\b(fix|repair|maintenance)\b/i],
    support: [/\btenant\b/i, /\blease\b/i, /\bunit\b/i] },
  { industry: 'property_management', specialty: 'general', intent: 'leasing_inquiry',
    anchors: [/\b(available|vacant)\b[^.]{0,30}\b(unit|apartment|rental)\b/i, /\bapply for\b[^.]{0,25}\b(apartment|unit|rental)\b/i,
              /\brental application\b/i, /\bwant to (see|rent|tour)\b[^.]{0,30}\b(apartment|unit|the two.?bedroom)\b/i] },
  { industry: 'property_management', specialty: 'general', intent: 'owner_inquiry',
    anchors: [/\bi own\b[^.]{0,35}\b(rental|propert\w+|units?)\b/i, /\bmanage my (rental|propert\w+)\b/i, /\bproperty management\b/i] },
  { industry: 'property_management', specialty: 'general', intent: 'general_inquiry',
    anchors: [/\bmy lease\b/i, /\bmy landlord\b/i, /\brent (is )?due\b/i] },

  // ================= HEALTHCARE =================
  { industry: 'healthcare', specialty: 'general', intent: 'appointment_booking',
    anchors: [/\b(appointment|see the doctor)\b[^.]{0,35}\b(doctor|dr\.?|clinic|office|practice)\b/i,
              /\b(schedule|make|book)\b[^.]{0,25}\b(an? )?appointment\b/i, /\bget in to see\b/i],
    support: [/\bpatient\b/i, /\bdoctor\b/i, /\bclinic\b/i] },
  { industry: 'healthcare', specialty: 'general', intent: 'new_patient',
    anchors: [/\bnew patient\b/i, /\bget established\b[^.]{0,25}\b(doctor|practice|clinic)\b/i] },
  { industry: 'healthcare', specialty: 'general', intent: 'prescription_refill',
    anchors: [/\b(refill|prescription)\b[^.]{0,30}\b(medication|medicine|prescription|pharmacy)\b/i, /\bneed a refill\b/i] },
  { industry: 'healthcare', specialty: 'general', intent: 'general_inquiry',
    anchors: [/\bmedical records\b/i, /\bdo you (take|accept)\b[^.]{0,25}\b(insurance|blue cross|aetna|cigna|medicare|medicaid|united)\b/i] },

  // ================= INSURANCE =================
  { industry: 'insurance', specialty: 'general', intent: 'quote_request',
    anchors: [/\b(quote|rate)\b[^.]{0,30}\b(insurance|coverage|policy)\b/i, /\binsurance quote\b/i,
              /\b(auto|home|life|renters?|business) insurance\b/i],
    support: [/\bpremium\b/i, /\bcarrier\b/i, /\bswitch\b/i] },
  { industry: 'insurance', specialty: 'general', intent: 'claim_report',
    anchors: [/\bfile a claim\b/i, /\breport a claim\b/i, /\bmy (insurance )?claim\b/i],
    support: [/\bpolicy\b/i, /\badjuster\b/i, /\bdamage\b/i] },
  { industry: 'insurance', specialty: 'general', intent: 'policy_change',
    anchors: [/\badd (a car|a vehicle|a driver)\b[^.]{0,25}\bpolicy\b/i, /\bchange my policy\b/i, /\bproof of insurance\b/i,
              /\bmy premium went up\b/i, /\bmy policy\b/i] },

  // ================= FINANCIAL SERVICES =================
  { industry: 'financial_services', specialty: 'general', intent: 'retirement_planning',
    anchors: [/\bretirement (planning|plan)\b/i, /\b401 ?k\b/i, /\bira\b/i, /\broll(ing)? over\b[^.]{0,25}\b401|ira\b/i] },
  { industry: 'financial_services', specialty: 'general', intent: 'tax_services',
    anchors: [/\b(do|file|prepare)\b[^.]{0,25}\b(my|our|business) taxes\b/i, /\btax (preparation|preparer|accountant)\b/i, /\bcpa\b/i] },
  { industry: 'financial_services', specialty: 'general', intent: 'bookkeeping',
    anchors: [/\bbookkeep\w+/i, /\bpayroll\b[^.]{0,25}\bservice\b/i] },
  { industry: 'financial_services', specialty: 'general', intent: 'new_client_inquiry',
    anchors: [/\bfinancial (advisor|planner|planning)\b/i, /\bwealth manage\w+/i, /\binvestment advisor\b/i,
              /\binherited\b[^.]{0,35}\b(money|estate)\b/i] },

  // ================= PROFESSIONAL SERVICES =================
  { industry: 'professional_services', specialty: 'general', intent: 'new_engagement',
    anchors: [/\b(consulting|consultancy|advisory) (services?|firm|help)\b/i,
              /\blooking for a (firm|consultant|partner)\b/i, /\bsend us a proposal\b/i,
              /\bneed outside help\b/i] },

  // ================= MANUFACTURING =================
  { industry: 'manufacturing', specialty: 'general', intent: 'rfq',
    anchors: [/\b(rfq|request for quote)\b/i, /\bquote\b[^.]{0,35}\b(machined|part|parts|units|fabricat\w+|tooling|castings?)\b/i,
              /\b(machin\w+|fabricat\w+|cnc|injection mold\w*|stamping)\b[^.]{0,30}\b(part|quote|run)\b/i],
    support: [/\bdrawings?\b/i, /\bcad\b/i, /\btolerance\w*/i, /\bmaterial\b/i, /\bquantity\b/i] },
  { industry: 'manufacturing', specialty: 'general', intent: 'quality_issue',
    anchors: [/\bout of spec\b/i, /\bnonconform\w+/i, /\bline (is )?down\b/i, /\bdefective parts?\b/i] },
  { industry: 'manufacturing', specialty: 'general', intent: 'order_status_manufacturing',
    anchors: [/\b(purchase order|our po)\b/i, /\bwhere (is|are) (our|my) (parts?|order)\b/i] },

  // ================= LOGISTICS =================
  { industry: 'logistics', specialty: 'general', intent: 'freight_quote',
    anchors: [/\b(freight|shipping|ship)\b[^.]{0,35}\b(quote|rate|pallet|ltl|truckload)\b/i,
              /\bquote to ship\b/i, /\b(reefer|flatbed|dry van|ltl)\b/i],
    support: [/\bpallet\w*/i, /\bweight\b/i, /\bpickup\b/i] },
  { industry: 'logistics', specialty: 'general', intent: 'shipment_tracking',
    anchors: [/\bwhere is my (shipment|freight|load|delivery)\b/i, /\btrack\w*\b[^.]{0,25}\b(shipment|freight|load)\b/i,
              /\b(pro|bol) number\b/i, /\bmy (delivery|shipment) (never|hasn'?t) (showed|arrived|come)\b/i] },
  { industry: 'logistics', specialty: 'general', intent: 'pickup_request',
    anchors: [/\bschedule a pickup\b/i, /\bneed a pickup\b/i, /\bcapacity out of\b/i] },

  // ================= ENERGY =================
  { industry: 'energy', specialty: 'general', intent: 'safety_report', urgency: 'emergency',
    anchors: [/\bsmell gas\b/i, /\bgas leak\b/i, /\bpower line (down|hanging)\b/i, /\bdowned (power )?line\b/i] },
  { industry: 'energy', specialty: 'general', intent: 'outage_report',
    anchors: [/\bpower('s| is| has been) (out|off)\b/i, /\boutage\b/i] },
  { industry: 'energy', specialty: 'general', intent: 'project_inquiry',
    anchors: [/\benergy (efficiency|project|audit)\b/i, /\butility (project|program)\b/i, /\b(storage|generation) project\b/i] },

  // ================= DEFENSE & AEROSPACE =================
  { industry: 'defense_aerospace', specialty: 'general', intent: 'capability_inquiry',
    anchors: [/\b(as9100|itar|dfars|cmmc)\b/i, /\bdefense (contract\w*|supplier)\b/i,
              /\baerospace\b[^.]{0,30}\b(part|program|supplier|component)\b/i, /\b(rfi|rfp)\b[^.]{0,30}\b(defense|aerospace|program)\b/i] },

  // ================= SOLAR =================
  { industry: 'solar', specialty: 'general', intent: 'solar_quote',
    anchors: [/\bsolar (panels?|system|quote|installation)\b/i, /\bgo(ing)? solar\b/i, /\bget solar\b/i],
    support: [/\belectric bill\b/i, /\broof\b/i, /\btax credit\b/i] },
  { industry: 'solar', specialty: 'general', intent: 'production_issue',
    anchors: [/\bsolar\b[^.]{0,35}\b(not (working|producing)|stopped|down|offline)\b/i, /\binverter\b/i] },
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
    anchors: [/\bswitch from (cable|my provider)\b/i, /\bbusiness internet\b/i, /\bnew internet service\b/i] },

  // ================= E-COMMERCE =================
  { industry: 'ecommerce', specialty: 'general', intent: 'order_status',
    anchors: [/\bwhere('s| is) my (order|package)\b/i, /\border status\b/i, /\bmy (order|package)\b[^.]{0,30}\b(hasn'?t|never) (arrived|shipped|come)\b/i],
    support: [/\border number\b/i, /\btracking\b/i] },
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
