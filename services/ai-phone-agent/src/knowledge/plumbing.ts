import type { KnowledgeEntry } from './types.ts';

export const PLUMBING_KNOWLEDGE: KnowledgeEntry[] = [
  // ---------- safety, first ----------
  {
    id: 'plumbing.shut_off_water',
    question: 'how to shut the water off themselves',
    triggers: [
      /\b(how do i|can i|where is|where'?s)\b[^.]{0,30}\b(shut|turn) (it |the water )?off\b/i,
      /\bshut ?off valve\b/i, /\bwhere'?s? the main\b/i, /\bstop the water\b/i,
    ],
    source: 'industry_general',
    guidance:
      'Help with this immediately and specifically — it is the one piece of hands-on guidance worth more than anything else you can do for them. ' +
      'Fixture shutoffs are on the wall or under the cabinet behind the sink or toilet, usually an oval or football-shaped handle, clockwise to close. ' +
      'The main is typically at the street in a covered box, or where the line enters the house, or by the water heater. ' +
      'If a valve is stuck, tell them not to force it — a snapped valve turns a leak into a flood. Then get back to the details.',
  },
  {
    id: 'plumbing.water_near_electric',
    question: 'water near electrical panels, outlets, or appliances',
    triggers: [
      /\bwater\b[^.]{0,40}\b(electric\w*|outlet|panel|breaker|wiring|socket)\b/i,
      /\b(electric\w*|outlet|panel|breaker)\b[^.]{0,40}\bwater\b/i,
      /\bceiling light\b[^.]{0,30}\bwater\b/i,
    ],
    source: 'escalate',
    guidance:
      'Treat this as an emergency the moment you hear it. Tell them not to walk through standing water near an outlet or panel and not to touch anything electrical that is wet. ' +
      'If they can reach the breaker safely and dry, they can kill power to that area. Do not talk them through anything more than that. Escalate.',
  },
  {
    id: 'plumbing.diy_repair',
    question: 'how to fix the plumbing problem themselves',
    triggers: [
      /\b(how do i|can i|should i)\b[^.]{0,30}\b(fix|repair|replace|patch|unclog|snake|solder|tighten)\b/i,
      /\bcan i (just )?(use|put)\b[^.]{0,25}\b(drano|liquid plumber|plumber'?s putty|flex seal|tape)\b/i,
      /\bdo it myself\b/i, /\byoutube\b/i,
    ],
    source: 'refuse',
    guidance:
      'Shutting water off is the only hands-on step you give. Do not walk anyone through a repair — not tightening a fitting, not snaking a line, not swapping a valve, ' +
      'and never soldering or anything touching a gas water heater. Say it honestly: it is not something to talk through over the phone, and a wrong turn on a fitting can flood a room. ' +
      'One exception worth mentioning: caustic drain chemicals often make a clog worse and make it dangerous for whoever opens the line, so it is fair to advise against them. Then move to getting someone out.',
  },

  // ---------- diagnosis-shaped questions ----------
  {
    id: 'plumbing.water_heater_replace',
    question: 'whether a leaking or failing water heater needs replacing',
    triggers: [
      /\bwater heater\b[^.]{0,40}\b(replace|new one|repair|fix|worth|old|leaking|rusty)\b/i,
      /\bdo i need a new (water )?heater\b/i,
      /\bis it worth (repairing|fixing)\b/i,
    ],
    source: 'needs_more_info',
    guidance:
      'You can explain how the decision generally gets made without pretending to make it. ' +
      'Leaking from the tank body usually means replacement; leaking from a fitting, valve, or connection is often a repair. Age matters — tanks commonly last around eight to twelve years. ' +
      'Ask where the water is coming from, roughly how old it is, and whether it is gas or electric. Then let the technician decide. Do not quote a replacement price.',
  },
  {
    id: 'plumbing.tankless',
    question: 'whether the business works on tankless water heaters',
    triggers: [/\btankless\b/i, /\bon.?demand (water )?heater\b/i, /\brinnai|navien|noritz\b/i],
    source: 'business_config',
    requires: ['services'],
    guidance:
      'Tankless is a genuine specialisation and not every plumber does it, so do not assume. ' +
      'If the service list is configured, answer from it. If not, say you will check and take the details — including the brand if they know it, since that often decides who can service it.',
  },
  {
    id: 'plumbing.slab_leak',
    question: 'about a suspected slab leak',
    triggers: [
      /\bslab leak\b/i,
      /\b(warm|hot) spot\b[^.]{0,25}\bfloor\b/i,
      /\bwater bill\b[^.]{0,35}\b(high|spiked|jumped|doubled)\b/i,
      /\bhear water running\b[^.]{0,30}\b(no one|nothing|nobody)\b/i,
    ],
    source: 'industry_general',
    guidance:
      'The classic signs are worth naming back to them: a warm patch on the floor, a water bill that jumped for no reason, the sound of running water with everything off, or unexplained damp in the slab. ' +
      'It needs leak detection equipment, so it is a visit rather than a phone diagnosis. Ask whether they have shut the water off and whether the meter is still turning — that last one is genuinely useful information for the technician.',
  },
  {
    id: 'plumbing.sewage_health',
    question: 'whether sewage backing up is dangerous',
    triggers: [
      /\bsewage\b[^.]{0,35}\b(safe|dangerous|health|sick|kids|children|clean)\b/i,
      /\bis (it|that) (safe|dangerous)\b/i,
      /\bcan i clean (it|that) up\b/i,
    ],
    source: 'industry_general',
    guidance:
      'Be direct: sewage backup is a health hazard. Keep children and pets out of it, do not use the fixtures on that line, and do not try to clean it up without protection. ' +
      'Do not diagnose the cause or estimate the cost. Treat the call as urgent.',
  },
  {
    id: 'plumbing.whole_house_backup',
    question: 'everything in the house backing up at once',
    triggers: [
      /\b(every|all)\b[^.]{0,30}\b(drain|toilet|sink)s?\b[^.]{0,25}\b(back\w+ up|slow|clogged)\b/i,
      /\bwhole house\b[^.]{0,30}\b(back\w+ up|clogged|drain)\b/i,
      /\bgurgl\w+\b/i,
    ],
    source: 'industry_general',
    guidance:
      'Several fixtures backing up together, or gurgling when another fixture runs, points at the main line rather than any one drain — worth saying, because it tells them why one plunger will not fix it. ' +
      'Advise them to stop running water, including the washing machine and dishwasher, until someone looks. Treat as urgent.',
  },

  // ---------- commercial / tenancy ----------
  {
    id: 'plumbing.commercial',
    question: 'whether the business handles commercial work',
    triggers: [
      /\b(commercial|business|office|restaurant|retail|warehouse|building|apartment complex)\b/i,
      /\bgrease trap\b/i, /\bbackflow\b/i,
    ],
    source: 'business_config',
    requires: ['services'],
    guidance:
      'Commercial plumbing is a different licence and a different crew at many shops, so do not assume it is covered. ' +
      'Answer from the service list if configured; otherwise take the details, including the type of premises and whether the business is currently shut down by the problem — that last part sets the urgency.',
  },
  {
    id: 'plumbing.landlord_tenant',
    question: 'who pays when the caller rents',
    triggers: [
      /\b(landlord|property manager|rental|i rent|renting)\b/i,
      /\bwho pays\b/i,
      /\bmy landlord (said|told me)\b/i,
    ],
    source: 'needs_more_info',
    guidance:
      'Find out who is authorising the work before anything else — a tenant usually cannot approve a paid repair, and doing the work for the wrong person is how a plumber does not get paid. ' +
      'Ask whether the landlord or management company sent them, and get that contact. Do not opine on who is legally responsible under their lease.',
  },
  {
    id: 'plumbing.insurance_covers',
    question: 'whether insurance will cover the plumbing damage',
    triggers: [
      /\b(insurance|homeowners|policy|claim)\b[^.]{0,40}\b(cover|pay|covered)\b/i,
      /\bwill insurance\b/i,
    ],
    source: 'industry_general',
    guidance:
      'Never predict a coverage decision — that is the adjuster\'s call and getting it wrong sets up a nasty surprise. ' +
      'What is generally true and safe to say: policies more often address sudden damage than gradual wear, and the plumbing repair itself is treated separately from the water damage it caused. ' +
      'Encourage them to photograph everything before anything is moved, and to call their carrier. Then get on with scheduling.',
  },
];
