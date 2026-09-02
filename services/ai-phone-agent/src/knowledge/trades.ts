// Knowledge banks for the remaining field-service trades.
//
// Grouped in one file because each is a focused bank rather than a
// deep specialisation, and twenty separate two-hundred-line files
// would be harder to keep consistent, not easier.

import type { KnowledgeEntry } from './types.ts';

/** Shared by every trade that sends a van to a property. */
const FIELD_SERVICE_COMMON: KnowledgeEntry[] = [
  {
    id: 'field.diagnose_by_phone',
    question: 'what is wrong, or what it will take to fix',
    triggers: [
      /\bwhat (do you think|could it be|is wrong|caused)\b/i,
      /\bwhy (is|would) (it|this|my)\b[^.]{0,30}\b(doing|not working|broken)\b/i,
      /\bis it (the|a) \w+\b/i,
      /\bcan you tell (me|from)\b/i,
    ],
    source: 'needs_more_info',
    guidance:
      'You can narrow it with good questions but you cannot diagnose it, and pretending otherwise sets an expectation the technician then has to argue with. ' +
      'Describe possibilities only in general terms, ask what actually helps — when it started, what changed, what they have already tried — and let the visit settle it.',
  },
];

export const HVAC_KNOWLEDGE: KnowledgeEntry[] = [
  ...FIELD_SERVICE_COMMON,
  {
    id: 'hvac.no_cooling_checks',
    question: 'anything they can check themselves before someone comes',
    triggers: [/\b(anything|something) i can (check|do|try)\b/i, /\bbefore (you|someone) comes?\b/i, /\breset\b/i, /\bbreaker\b/i, /\bfilter\b/i],
    source: 'industry_general',
    guidance:
      'Two checks are safe and genuinely resolve a fair number of calls: whether the thermostat is set to cool and the batteries are good, and whether the breaker has tripped. ' +
      'A filthy filter is worth asking about too. Beyond that, stop — no opening panels, no touching the capacitor, no hosing the outdoor unit while it runs.',
  },
  {
    id: 'hvac.heat_or_ac_emergency',
    question: 'whether their situation counts as an emergency',
    triggers: [/\b(emergency|urgent|elderly|baby|newborn|infant|medical|asthma|heat stroke|freezing)\b/i, /\bhow (hot|cold) (is|does)\b/i, /\b(9\d|10\d) degrees\b/i],
    source: 'escalate',
    guidance:
      'Extreme indoor temperature with an infant, an elderly person, or anyone with a medical condition in the house is a genuine priority, and should be flagged as one rather than booked into the next open slot. ' +
      'Say it is being treated as urgent. Do not promise an arrival time nobody has committed to.',
  },
  {
    id: 'hvac.replace_or_repair',
    question: 'whether to repair or replace the system',
    triggers: [/\b(repair|fix)\b[^.]{0,25}\b(or|vs\.?|versus)\b[^.]{0,20}\breplace\b/i, /\bnew (system|unit|ac|air conditioner)\b/i, /\bhow long (do|should)\b[^.]{0,25}\b(units?|systems?|ac)\b[^.]{0,15}\blast\b/i, /\bworth (fixing|repairing)\b/i],
    source: 'needs_more_info',
    guidance:
      'General lifespan is fine: most systems run somewhere in the ten-to-twenty-year range, shorter in hard coastal or heavy-use conditions. ' +
      'Do not tell them theirs is finished, and do not quote a replacement price. Ask the age, whether it has needed repairs before, and whether the utility bill has been climbing.',
  },
  {
    id: 'hvac.refrigerant',
    question: 'about refrigerant, freon, or recharging the system',
    triggers: [/\b(freon|refrigerant|r.?22|410a|recharge|top (it )?off|low on)\b/i],
    source: 'industry_general',
    guidance:
      'Worth explaining generally, because it saves an argument later: a sealed system does not consume refrigerant, so low refrigerant means a leak, and simply adding more is a temporary fix. ' +
      'Do not quote a price, and do not comment on what their old system\'s refrigerant now costs.',
  },
];

export const ELECTRICAL_KNOWLEDGE: KnowledgeEntry[] = [
  ...FIELD_SERVICE_COMMON,
  {
    id: 'elec.burning_danger',
    question: 'about burning smells, sparks, or smoke',
    triggers: [/\b(burning|smoke|smok\w+|spark\w+|melt\w+|scorch\w+|hot to the touch|buzzing)\b/i],
    source: 'escalate',
    guidance:
      'Treat this as an emergency, not a booking. Tell them to stop using the circuit and, if they can do it safely, switch it off at the breaker. ' +
      'If there is active smoke, visible fire, or a hot panel, tell them to leave and call 911 — do not continue intake through that. Never talk anyone through opening a panel.',
  },
  {
    id: 'elec.reset_breaker',
    question: 'whether they can reset the breaker themselves',
    triggers: [/\b(reset|flip|turn back on)\b[^.]{0,25}\bbreaker\b/i, /\bcan i (just )?(reset|flip)\b/i],
    source: 'industry_general',
    guidance:
      'Resetting a breaker once is normal and fine to describe: fully off, then back on. What matters is the next sentence — if it trips again straight away, something is wrong and it must be left off. ' +
      'Repeatedly resetting a tripping breaker is how fires start, and saying so plainly is appropriate.',
  },
  {
    id: 'elec.panel_upgrade',
    question: 'about panel upgrades, EV chargers, or generators',
    triggers: [/\b(panel upgrade|service upgrade|200 amp|ev charger|tesla|generator|whole house|sub ?panel)\b/i],
    source: 'needs_more_info',
    guidance:
      'These are project jobs rather than service calls and usually need a site visit, and often a permit. Capture the panel\'s current amperage if they know it, the property age, and what they want to add. ' +
      'Do not quote, and do not tell them what their panel can support.',
  },
  {
    id: 'elec.flickering_lights',
    question: 'about flickering or dimming lights',
    triggers: [/\b(flicker\w*|dim\w+|brighten|surge|blink\w*)\b/i, /\blights?\b[^.]{0,30}\b(flicker|dim|go out)\w*/i],
    source: 'needs_more_info',
    guidance:
      'Worth separating: one fixture flickering is usually local, while lights dimming across the house — especially when a large appliance starts — points at something upstream and is more serious. ' +
      'Ask which it is. Flickering across the whole house together with any warmth or smell at the panel is an emergency, not a booking.',
  },
  {
    id: 'elec.gfci_outlet_dead',
    question: 'about outlets that have stopped working',
    triggers: [/\boutlets?\b[^.]{0,30}\b(dead|not work\w*|stopped|no power)\b/i, /\bgfci\b/i, /\bbathroom (outlet|plug)\b/i, /\bkitchen (outlet|plug)\b/i],
    source: 'industry_general',
    guidance:
      'One safe check that resolves a fair number of these: bathroom, kitchen, garage and outdoor outlets are usually on a GFCI, and a tripped GFCI kills every outlet downstream of it. ' +
      'They can press the reset button on the GFCI outlet itself. If it will not reset or trips again, stop there — that is a fault, not a nuisance trip.',
  },
  {
    id: 'elec.who_does_what',
    question: 'whether a job is electrical work at all',
    triggers: [/\bis (that|this) (an )?electric\w*/i, /\bdo you (do|handle)\b[^.]{0,30}\b(appliance|hvac|ac|pool|low voltage|cable|phone|alarm|tv)\b/i],
    source: 'business_config',
    requires: ['services'],
    guidance:
      'Some of this genuinely belongs to another trade — appliance repair, HVAC controls, low-voltage and cabling are often separate. Do not claim it without configuration. ' +
      'Take what they need and let a person confirm rather than sending an electrician to a job they cannot do.',
  },
];

export const PEST_KNOWLEDGE: KnowledgeEntry[] = [
  {
    id: 'pest.safe_for_kids_pets',
    question: 'whether the treatment is safe for children or pets',
    triggers: [/\b(safe|toxic|harmful|dangerous)\b[^.]{0,35}\b(kids?|children|pets?|dogs?|cats?|baby|pregnant)\b/i, /\bchemicals?\b/i, /\borganic|natural|green\b/i],
    source: 'business_config',
    requires: ['services'],
    guidance:
      'This is the most common question in pest control and it deserves care. Do not name products, do not state re-entry times, and do not promise anything is harmless. ' +
      'Generally: treatments are applied to a label with specific instructions, and the technician will go through what to do about pets, children, and food surfaces. ' +
      'Note if they mention pregnancy, an infant, or a fish tank — those genuinely change the treatment plan.',
  },
  {
    id: 'pest.bed_bug_prep',
    question: 'what they need to do before bed bug treatment',
    triggers: [/\bbed ?bugs?\b/i, /\b(prep|prepare|do before|get ready)\b/i, /\bdo i have to (wash|bag|move)\b/i],
    source: 'industry_general',
    guidance:
      'General and genuinely useful: bed bug work normally requires real preparation — laundering bedding on high heat, reducing clutter, and often more than one visit. ' +
      'Do not promise a single treatment will clear it, and do not tell them to throw out furniture. Do ask how long they have noticed it and how many rooms, since that shapes the job.',
  },
  {
    id: 'pest.one_time_or_recurring',
    question: 'whether they need ongoing service or a one-off treatment',
    triggers: [/\b(one.?time|once|recurring|quarterly|monthly|contract|ongoing|subscription)\b/i, /\bdo i have to sign up\b/i],
    source: 'business_config',
    requires: ['services'],
    guidance:
      'Explain the general distinction — some problems are resolved in a visit, others such as ants, roaches and rodents commonly recur without ongoing treatment. ' +
      'Do not quote plan prices or commit them to a contract. If they push back on recurring service, do not press it; take the one-off and note the objection.',
  },
  {
    id: 'pest.termite_damage',
    question: 'about termites, damage, or an inspection for a sale',
    triggers: [/\btermites?\b/i, /\bwdo\b/i, /\bwood destroying\b/i, /\b(closing|selling|buying|realtor|lender)\b[^.]{0,30}\binspection\b/i],
    source: 'needs_more_info',
    guidance:
      'A termite inspection tied to a closing has a deadline, so establish that immediately — it changes the priority entirely. ' +
      'Do not assess how bad the damage is or whether the structure is compromised. Capture the property type, whether it is for a sale, and any date they are working to.',
  },
];

export const GARAGE_DOOR_KNOWLEDGE: KnowledgeEntry[] = [
  ...FIELD_SERVICE_COMMON,
  {
    id: 'garage.spring_danger',
    question: 'about a broken spring or fixing the door themselves',
    triggers: [/\bspring\b/i, /\bcan i (fix|do) it myself\b/i, /\bforce it (open|up)\b/i, /\bpull the (cord|release)\b/i],
    source: 'industry_general',
    guidance:
      'Be direct about this one: torsion springs hold enormous tension and have seriously injured people who tried to adjust them. Tell them not to attempt it — that is not upselling, it is accurate. ' +
      'If the door is stuck and the car is trapped inside, note that as urgency. Do not talk them through the emergency release beyond mentioning it exists.',
  },
  {
    id: 'garage.car_trapped',
    question: 'about a car stuck inside the garage',
    triggers: [/\b(car|truck|vehicle)\b[^.]{0,30}\b(stuck|trapped|can'?t get (it )?out|inside)\b/i, /\bneed to get to work\b/i],
    source: 'escalate',
    guidance:
      'A trapped vehicle is a real priority — this is someone who cannot get to work. Flag it as urgent and try to get same-day. ' +
      'Do not promise a time nobody has committed to.',
  },
  {
    id: 'garage.door_wont_close',
    question: 'about a door that will not close, leaving the house open',
    triggers: [/\bwon'?t (close|go down|stay (closed|down))\b/i, /\bcan'?t (lock|secure|close) (up|the house)\b/i, /\bstuck open\b/i],
    source: 'escalate',
    guidance:
      'A door stuck open is a security problem, not just an inconvenience, and should be treated with real urgency — especially after dark. ' +
      'One safe general check: the photo-eye sensors near the floor commonly get knocked out of alignment or blocked, and a blinking light on the opener often points at that. That is worth mentioning; nothing further.',
  },
  {
    id: 'garage.opener_replace',
    question: 'about replacing an opener or adding smart features',
    triggers: [/\b(new|replace|upgrade)\b[^.]{0,25}\b(opener|motor)\b/i, /\b(myq|smart|wifi|app|phone)\b/i, /\bbelt drive\b/i, /\bquieter\b/i],
    source: 'business_config',
    requires: ['services'],
    guidance:
      'Do not name brands, models or prices. Useful and general: belt-drive units are quieter than chain, which matters when there is a bedroom over the garage. ' +
      'Ask how old the current opener is and whether the door itself is in good shape — replacing an opener on a failing door is money wasted.',
  },
  {
    id: 'garage.noise',
    question: 'about a door that has become noisy',
    triggers: [/\b(loud|noisy|grinding|squeal\w+|screech\w+|rattl\w+|bang\w+)\b/i, /\bmakes? a (noise|sound|racket)\b/i],
    source: 'needs_more_info',
    guidance:
      'Ask what kind of noise and when — a grinding or banging noise is different from a squeak, and a bang on opening can mean a spring. ' +
      'Do not diagnose it and do not suggest they lubricate or adjust anything themselves; the moving parts on a garage door are under serious tension.',
  },
  {
    id: 'garage.maintenance',
    question: 'about servicing or tuning up the door',
    triggers: [/\b(tune.?up|maintenance|service|inspect\w*|check it over|annual)\b/i],
    source: 'business_config',
    requires: ['services'],
    guidance:
      'Do not quote a maintenance price or describe what is included without configuration. Take the door age and any symptoms, and book the visit.',
  },
];

export const POOL_KNOWLEDGE: KnowledgeEntry[] = [
  {
    id: 'pool.green_water',
    question: 'about green or cloudy pool water',
    triggers: [/\b(green|cloudy|murky|milky|algae|swamp)\b/i, /\bcan i swim\b/i, /\bshock (it|the pool)\b/i],
    source: 'industry_general',
    guidance:
      'General and safe: green usually means algae from a chemistry or circulation problem, and cloudy often points at filtration. ' +
      'Do not give a chemical dosing regimen — wrong amounts damage equipment and surfaces, and can hurt someone. Advise against swimming until it is cleared. ' +
      'Ask the pool size, whether the pump is running, and how long it has looked like that.',
  },
  {
    id: 'pool.equipment_failure',
    question: 'about pump, filter, or heater failure',
    triggers: [/\b(pump|filter|heater|motor|salt cell|chlorinator)\b/i, /\b(loud|grinding|screech\w+|humming|leaking|not (running|working))\b/i],
    source: 'needs_more_info',
    guidance:
      'Capture what it is doing and for how long. If the pump is making a grinding or screeching noise, it is fair to suggest switching it off to avoid further damage. ' +
      'Do not diagnose or quote parts. If they mention electrical smells or water around equipment, escalate rather than book.',
  },
  {
    id: 'pool.service_frequency',
    question: 'about regular pool service',
    triggers: [/\b(weekly|biweekly|monthly|regular|maintenance|service plan|clean it)\b/i, /\bhow often\b/i],
    source: 'business_config',
    requires: ['services'],
    guidance:
      'Weekly service is the common pattern and it is safe to say so generally. Do not quote a monthly rate or promise what a plan includes. ' +
      'Capture pool size, whether it is chlorine or salt, and whether there is a spa attached — those determine the quote.',
  },
  {
    id: 'pool.losing_water',
    question: 'about the pool losing water',
    triggers: [/\b(losing|lost|leak\w*|drop\w*|low)\b[^.]{0,30}\b(water|level|inches?)\b/i, /\bfilling it (every|up)\b/i],
    source: 'industry_general',
    guidance:
      'Generally worth saying: some loss to evaporation is normal, and more in hot windy weather. A useful home check is the bucket test — a bucket of pool water on a step loses water at the same rate as the pool if it is evaporation, and slower than the pool if there is a leak. ' +
      'Do not estimate a leak location or cost. Ask roughly how much they are losing and how quickly.',
  },
  {
    id: 'pool.opening_closing',
    question: 'about opening, closing, draining or resurfacing',
    triggers: [/\b(open|close|opening|closing|winteriz\w+|drain|resurfac\w+|replaster|acid wash|tile)\b/i],
    source: 'business_config',
    requires: ['services'],
    guidance:
      'These are separate services many companies do not all offer. Do not assume. Take what they want, the pool size, and the surface type if they know it. ' +
      'One thing genuinely worth flagging: draining a pool is not a DIY job — an empty pool can lift out of the ground. Do not talk anyone through it.',
  },
  {
    id: 'pool.safety',
    question: 'anything involving a child, an accident, or the pool being unsafe',
    triggers: [/\b(child|kid|toddler|drown\w*|fell in|accident|unsafe|fence|gate|alarm|cover)\b/i],
    source: 'escalate',
    guidance:
      'If anything suggests a child has been in the water or is at risk right now, that is 911, not a service call, and it comes before every other thing on this call. ' +
      'For barrier, fence or safety-cover questions, do not state code requirements — they vary by jurisdiction — and get it to a person.',
  },
];

export const SCREEN_KNOWLEDGE: KnowledgeEntry[] = [
  {
    id: 'screen.repair_or_replace',
    question: 'whether panels can be repaired or the whole thing replaced',
    triggers: [/\b(repair|replace|rescreen|patch|whole thing)\b/i, /\bhow many panels\b/i, /\bworth (fixing|it)\b/i],
    source: 'needs_more_info',
    guidance:
      'Generally, individual panels are replaceable, while frame damage is a bigger job. Do not decide which theirs is without a look. ' +
      'Ask how many panels, whether the frame itself is bent or pulled loose, and whether it is a pool cage, lanai, or porch — those change the job completely.',
  },
  {
    id: 'screen.storm_damage',
    question: 'about storm damage and insurance',
    triggers: [/\b(storm|hurricane|wind|tree|branch|debris)\b/i, /\binsurance\b/i, /\bclaim\b/i],
    source: 'industry_general',
    guidance:
      'Do not predict whether insurance covers it — screen enclosures are treated inconsistently across policies. ' +
      'Practical advice worth giving: photograph it before anything is cleared away. If a pool cage is partly collapsed, tell them to keep people and pets out from under it.',
  },
  {
    id: 'screen.pet_screen',
    question: 'about pet-resistant or upgraded screen material',
    triggers: [/\b(pet|dog|cat|no.?see.?um|solar|privacy|heavy duty|upgrade)\b[^.]{0,20}\bscreen\b/i, /\bdifferent (kind|type|material)\b/i],
    source: 'business_config',
    requires: ['services'],
    guidance:
      'Different screen materials genuinely exist for pets, insects, and sun, so the question is a good one. Do not promise a specific product is stocked or quote an upcharge. ' +
      'Note what they want and let the estimate cover it.',
  },
  {
    id: 'screen.how_long',
    question: 'how long a rescreen or repair takes',
    triggers: [/\bhow long\b/i, /\bwhen (can|could) you\b/i, /\bsame day\b/i, /\bone day\b/i],
    source: 'needs_more_info',
    guidance:
      'Do not commit to a duration or a start date. Panel counts and access drive it, and a full cage rescreen is a different job from two panels. ' +
      'Capture how many panels and whether it is single or two-storey.',
  },
  {
    id: 'screen.permit_hoa',
    question: 'about permits or HOA approval for an enclosure',
    triggers: [/\b(permit|hoa|association|approval|code|setback|neighbou?r)\b/i],
    source: 'industry_general',
    guidance:
      'Generally: new structures usually need a permit and often HOA approval, and contractors typically handle the permit while the owner handles the HOA. ' +
      'Do not tell them whether theirs needs one, and do not comment on their HOA rules. Note it for the estimator.',
  },
  {
    id: 'screen.insurance_claim',
    question: 'whether to claim an enclosure on insurance',
    triggers: [/\b(insurance|claim|deductible|adjuster)\b/i],
    source: 'industry_general',
    guidance:
      'Do not predict coverage — screen enclosures are treated inconsistently across policies, and some exclude them entirely. ' +
      'Tell them to photograph the damage before anything is cleared. Capture the carrier and claim number if one exists.',
  },
];

export const LANDSCAPING_KNOWLEDGE: KnowledgeEntry[] = [
  {
    id: 'land.recurring_maintenance',
    question: 'about regular lawn or yard maintenance',
    triggers: [/\b(weekly|biweekly|every (other )?week|monthly|regular|ongoing|contract|mow(ing)?)\b/i, /\bhow often\b/i],
    source: 'business_config',
    requires: ['services'],
    guidance:
      'Recurring maintenance is the valuable work here, so capture it properly: property size, what is included in their mind — mowing, edging, beds, trimming — and how often. ' +
      'Do not quote a monthly rate. Most of these need a look at the property or at least an address.',
  },
  {
    id: 'land.tree_work',
    question: 'about tree removal or trimming',
    triggers: [/\btrees?\b/i, /\b(remove|removal|trim|cut down|stump|limbs?|branch\w*)\b/i, /\bnear (the|my) (house|roof|power|fence)\b/i],
    source: 'needs_more_info',
    guidance:
      'Establish size and proximity, because a large tree near a structure or power lines is a different job requiring different equipment and sometimes a separate contractor. ' +
      'If a tree or limb is currently leaning on a structure or touching power lines, that is an emergency — power lines mean the utility, not a landscaper. ' +
      'Do not quote and do not assess whether a tree is dangerous.',
  },
  {
    id: 'land.irrigation',
    question: 'about sprinklers or irrigation problems',
    triggers: [/\b(sprinkler|irrigation|zone|valve|timer|controller|head)\b/i, /\b(not (coming on|working)|leaking|flooding|dry spots?)\b/i],
    source: 'needs_more_info',
    guidance:
      'Useful to establish whether it is one zone or the whole system, since that separates a controller or valve problem from a broken head. ' +
      'If water is running continuously and cannot be stopped, that is urgent — it wastes a great deal of water and shows up on a bill. ' +
      'The shutoff advice is fair: most systems have a valve near the backflow preventer.',
  },
  {
    id: 'land.design_project',
    question: 'about a landscaping design or hardscape project',
    triggers: [/\b(design|redo|renovate|pavers?|patio|retaining wall|fire pit|outdoor kitchen|sod|hardscape|landscap\w+)\b/i],
    source: 'schedule',
    guidance:
      'Project work needs a site visit; there is no way to price it by phone and no point pretending otherwise. ' +
      'Capture what they want, roughly the area, and any deadline such as an event or a sale. Then get the consultation booked.',
  },
  {
    id: 'land.lawn_problems',
    question: 'about brown patches, weeds, or a struggling lawn',
    triggers: [/\b(brown|dead|patch\w*|bare|weeds?|fungus|chinch|grub|bug|yellow)\b/i, /\bgrass (is|looks)\b/i],
    source: 'needs_more_info',
    guidance:
      'Do not diagnose it from a description — drought stress, fungus, chinch bugs and irrigation failure all look similar over the phone and the treatments differ completely. ' +
      'Ask when it started, whether it is spreading, and whether the irrigation reaches that area. It needs eyes on it.',
  },
  {
    id: 'land.cleanup_debris',
    question: 'about storm cleanup or hauling debris away',
    triggers: [/\b(cleanup|clean up|debris|haul|branches|limbs|storm|mess|pile)\b/i],
    source: 'business_config',
    requires: ['services'],
    guidance:
      'Hauling and disposal are often priced separately or not offered at all, so do not promise it. ' +
      'Capture roughly how much there is and whether it is already piled or still where it fell — that changes the job considerably.',
  },
  {
    id: 'land.chemicals_pets',
    question: 'whether treatments are safe for pets or children',
    triggers: [/\b(safe|toxic|harmful|chemical|spray|fertiliz\w+|weed killer|pesticide)\b[^.]{0,35}\b(pets?|dogs?|cats?|kids?|children)\b/i, /\b(pets?|kids?|children)\b[^.]{0,30}\b(safe|chemical|spray)\b/i],
    source: 'business_config',
    requires: ['services'],
    guidance:
      'Do not name products or state re-entry times. Generally, applications carry label instructions about keeping off treated areas until dry. ' +
      'Note that they have pets or children so the technician leads with it.',
  },
];

export const RESTORATION_KNOWLEDGE: KnowledgeEntry[] = [
  {
    id: 'resto.is_it_safe',
    question: 'whether it is safe to stay in the property',
    triggers: [/\b(safe|stay|sleep|live|kids|children|breathe|smell)\b/i, /\bshould (we|i) (leave|stay|move out)\b/i],
    source: 'escalate',
    guidance:
      'Do not make a habitability judgement — that is not yours to make and getting it wrong either way is serious. ' +
      'What is safe: sewage contamination and active mould growth are reasons to keep children and anyone with breathing problems away from the affected area, and standing water near electrics is dangerous. ' +
      'If they sound genuinely unsure whether the building is safe, escalate to a person rather than booking a slot.',
  },
  {
    id: 'resto.insurance_process',
    question: 'how the insurance side works',
    triggers: [/\b(insurance|claim|adjuster|deductible|policy|carrier)\b/i, /\bwho pays\b/i, /\bwill they cover\b/i],
    source: 'industry_general',
    guidance:
      'Never predict coverage or promise a claim will be paid. General and genuinely helpful: carriers usually want damage reported promptly, and mitigation — stopping further damage — is normally expected of the property owner. ' +
      'Tell them to photograph everything before anything is moved or removed. Capture the carrier and claim number if they have one.',
  },
  {
    id: 'resto.mold_health',
    question: 'about mould and health effects',
    triggers: [/\bmou?ld\b/i, /\b(sick|allerg\w+|asthma|headaches?|breathing|toxic|black mold)\b/i],
    source: 'refuse',
    guidance:
      'Do not give medical advice and do not tell them whether mould is making them ill — that is a doctor\'s question and "black mould" carries a lot of frightening folklore. ' +
      'Do not identify a mould type from a description. Say it needs assessing in person, suggest keeping the area closed off and anyone with breathing difficulties away from it, and get someone out.',
  },
  {
    id: 'resto.how_fast',
    question: 'how quickly someone can start',
    triggers: [/\bhow (soon|fast|quickly)\b/i, /\bright now\b/i, /\btonight\b/i, /\bemergency\b/i],
    source: 'schedule',
    guidance:
      'Water damage genuinely gets worse by the hour, so urgency here is real rather than manufactured — treat active water intrusion as an emergency. ' +
      'Do not promise an arrival time. Check availability, offer the soonest, and flag it for a person if it is severe.',
  },
  {
    id: 'resto.what_do_i_do_now',
    question: 'what to do in the first few minutes',
    triggers: [/\bwhat (do|should) i do\b/i, /\bright now\b/i, /\bshould i (move|start|clean|throw)\b/i, /\bcan i (clean|dry|move)\b/i],
    source: 'industry_general',
    guidance:
      'Practical and genuinely useful: stop the source if it is safe to do so, photograph everything before moving anything, lift what can be lifted off wet flooring, and do not run the air conditioning if there is a sewage or heavy contamination concern. ' +
      'Do not tell them to start tearing anything out — insurers want to see it, and what gets removed matters to the claim.',
  },
  {
    id: 'resto.how_long_dry',
    question: 'how long drying or the whole job takes',
    triggers: [/\bhow long\b/i, /\bwhen (can|will) (we|i)\b[^.]{0,25}\b(move back|be done|use)\b/i, /\bdays?\b/i, /\bequipment\b/i],
    source: 'industry_general',
    guidance:
      'General: drying equipment typically runs for several days and the rebuild is a separate phase afterwards. Do not give a number for their job. ' +
      'Do not promise anything can be saved — flooring, cabinets and drywall decisions are made on site.',
  },
  {
    id: 'resto.contents',
    question: 'about damaged belongings and whether they can be saved',
    triggers: [/\b(furniture|belongings|contents|photos?|clothes|documents|electronics|antique|carpet)\b/i, /\bcan (it|that|they) be saved\b/i],
    source: 'needs_more_info',
    guidance:
      'Do not promise anything can be restored, and do not tell them to throw things away — an insurer usually wants an inventory first. ' +
      'Say to photograph it and leave it in place if it is safe to. Note anything irreplaceable, which changes how a crew handles the job.',
  },
];

export const CONSTRUCTION_KNOWLEDGE: KnowledgeEntry[] = [
  {
    id: 'const.ballpark_cost',
    question: 'roughly what a remodel or build will cost',
    triggers: [/\b(ballpark|rough|about how much|price range|budget|per square foot|cost)\b/i, /\bwhat does a (kitchen|bathroom|addition|remodel)\b/i],
    source: 'business_config',
    requires: ['pricing'],
    guidance:
      'Do not give a per-square-foot figure or a project range. Construction numbers vary enormously by scope, finishes, and structure, and a casual figure becomes the number they remember. ' +
      'What you can do is ask about their budget — it is a normal, expected question here and it qualifies the lead. Then get the consultation booked.',
  },
  {
    id: 'const.permits',
    question: 'about permits, inspections, or code',
    triggers: [/\b(permit|inspection|code|hoa|zoning|approval|county|city)\b/i, /\bdo i need a permit\b/i],
    source: 'industry_general',
    guidance:
      'Generally: structural work, electrical, plumbing, and additions typically require permits, and the contractor usually handles them — that much is safe. ' +
      'Do not tell them whether their specific job needs one, and do not comment on their HOA rules. Note it as something the estimator should address.',
  },
  {
    id: 'const.timeline',
    question: 'how long the project will take',
    triggers: [/\bhow long\b/i, /\bwhen (could|can) you start\b/i, /\btimeline\b/i, /\bby (christmas|thanksgiving|the wedding|summer)\b/i],
    source: 'needs_more_info',
    guidance:
      'Do not commit to a start date or a duration. If they name a hard deadline — an event, a sale, a birth — capture it, because it decides whether the project is even feasible. ' +
      'Say scheduling depends on scope and current workload, which is honest.',
  },
  {
    id: 'const.live_in_it',
    question: 'about living in the house during the work',
    triggers: [/\b(live|stay|move out|kids?|pets?|dust|noise|water|kitchen)\b[^.]{0,35}\b(during|while|through)\b/i, /\bcan we stay\b/i, /\bhow (bad|much) (is )?(the )?(dust|mess|noise)\b/i],
    source: 'industry_general',
    guidance:
      'Honest and general: most people stay through a bathroom or kitchen remodel, though losing a kitchen for several weeks is harder than people expect and dust control varies with the scope. ' +
      'Do not promise a timeline or a containment approach for their job. It is a good question to flag for the estimator.',
  },
  {
    id: 'const.design_drawings',
    question: 'about plans, drawings, or an architect',
    triggers: [/\b(plans?|drawings?|architect|designer|blueprint|render\w*|3d)\b/i, /\bdo (i|we) need\b[^.]{0,25}\b(plans?|architect)\b/i],
    source: 'business_config',
    requires: ['services'],
    guidance:
      'Some firms do design-build and some require the owner to bring drawings. Do not assume. ' +
      'Ask whether they already have plans — that single answer changes the whole conversation and is the most useful thing to capture.',
  },
  {
    id: 'const.existing_job',
    question: 'about a job already underway',
    triggers: [/\b(our|the) (project|job|remodel|build)\b/i, /\bcrew\b/i, /\bchange order\b/i, /\bpunch list\b/i, /\bnobody (showed|came)\b/i],
    source: 'escalate',
    guidance:
      'You cannot see schedules or job files. Do not confirm a start date, explain why nobody showed, or accept blame. ' +
      'Take the name, the address, and the short version, and get it to a person quickly — a live job with an unhappy owner is not a message to leave in a queue.',
  },
];

export const COLLISION_KNOWLEDGE: KnowledgeEntry[] = [
  {
    id: 'collision.insurance_or_out_of_pocket',
    question: 'about going through insurance versus paying themselves',
    triggers: [/\b(insurance|claim|deductible|out of pocket|my own|their insurance|at fault)\b/i, /\bwill (my|it) (rates?|premium) go up\b/i, /\bshould i (claim|file)\b/i],
    source: 'needs_more_info',
    guidance:
      'Do not advise whether to file a claim and do not predict what it does to their premium — that is their insurer\'s territory and a wrong answer costs them money. ' +
      'Do capture what matters: whether a claim exists, the carrier, the claim number, and whether the other party was at fault. ' +
      'It is fair to say most shops work with all carriers, but do not name specific insurers as approved without configuration.',
  },
  {
    id: 'collision.rental_car',
    question: 'about a rental or loaner while the car is in',
    triggers: [/\b(rental|loaner|courtesy car|how (do|will) i get around|enterprise)\b/i],
    source: 'business_config',
    requires: ['services'],
    guidance:
      'Do not promise a loaner or arrange a rental. Generally, rental coverage comes from the insurance policy rather than the shop. ' +
      'Note that they need transport and let the shop address it.',
  },
  {
    id: 'collision.drivable',
    question: 'whether the car is safe to drive',
    triggers: [/\b(safe to drive|drivable|can i drive|should i drive|tow)\b/i, /\b(fluid|leaking|steam|airbag|headlight|tire)\b/i],
    source: 'industry_general',
    guidance:
      'Do not certify a vehicle as safe. What is fair to say: leaking fluid, a deployed airbag, damaged lights, anything rubbing a tyre, or anything obstructing view means it should be towed rather than driven. ' +
      'Ask whether it is drivable and whether they need a tow — that is a real service moment.',
  },
  {
    id: 'collision.how_long_repair',
    question: 'how long the repair takes',
    triggers: [/\bhow long\b/i, /\bwhen (will|can) i get it back\b/i, /\bparts\b/i],
    source: 'needs_more_info',
    guidance:
      'Do not give a duration. It depends on the damage, parts availability, and insurer approval, all of which are unknown until it is estimated. ' +
      'Say the estimate is what produces a real timeline, and get them booked in for one.',
  },
  {
    id: 'collision.oem_parts',
    question: 'about the parts used in the repair',
    triggers: [/\b(oem|aftermarket|used|recycled|genuine|original)\b[^.]{0,20}\bparts?\b/i, /\bwhat parts\b/i],
    source: 'industry_general',
    guidance:
      'General and fair: which parts get used is often driven by the insurance policy rather than the shop, and owners can usually discuss it. ' +
      'Do not promise OEM parts, and do not disparage aftermarket. Note the question so the estimator addresses it.',
  },
  {
    id: 'collision.paint_match',
    question: 'about paint matching or the quality of the finish',
    triggers: [/\b(paint|colou?r|match\w*|blend\w*|clear ?coat|finish)\b/i, /\bwill (it|you) (match|notice)\b/i],
    source: 'industry_general',
    guidance:
      'General: modern paint is matched by code and blended into adjacent panels, and on faded older paint blending is what makes it invisible. ' +
      'Do not guarantee an invisible repair on their vehicle. Capture year, make, model and colour.',
  },
  {
    id: 'collision.total_loss',
    question: 'about the car being totalled',
    triggers: [/\btotal\w*\b/i, /\bwrite it off\b/i, /\bworth (fixing|repairing|more than)\b/i, /\bsalvage\b/i],
    source: 'refuse',
    guidance:
      'Do not tell anyone their vehicle is or is not a total loss. That is the insurer\'s determination, it depends on value against repair cost, and being wrong either way is damaging. ' +
      'Say the estimate and the carrier settle it, and get the vehicle looked at.',
  },
];

export const AUTO_DEALER_KNOWLEDGE: KnowledgeEntry[] = [
  {
    id: 'dealer.is_it_available',
    question: 'whether a specific vehicle is still available',
    triggers: [/\b(still (have|available|there)|in stock|sold)\b/i, /\bsaw (it|one) on\b/i, /\bstock number\b/i, /\bvin\b/i],
    source: 'needs_more_info',
    guidance:
      'You cannot see live inventory, so do not confirm a vehicle is available or say it has sold. Both are damaging: one wastes a trip, the other loses a buyer. ' +
      'Capture the stock number or a description, get their name and number, and offer to have someone confirm and hold it. Then push for the appointment — an appointment is the entire objective of this call.',
  },
  {
    id: 'dealer.price_negotiate',
    question: 'about price, discounts, or negotiating',
    triggers: [/\b(best price|discount|out the door|negotiat\w+|lowest|deal|msrp|rebate|incentive)\b/i, /\bhow much (is|for)\b/i],
    source: 'business_config',
    requires: ['pricing'],
    guidance:
      'Do not quote a price, a discount, or an out-the-door figure. Do not say the price is firm either. ' +
      'Move it to the appointment, which is where this genuinely gets resolved, and capture what they are interested in.',
  },
  {
    id: 'dealer.trade_value',
    question: 'what their trade-in is worth',
    triggers: [/\btrade[- ]?in\b/i, /\bwhat (can|will) you give me\b/i, /\bkbb|kelley|blue book\b/i, /\bmy (car|truck) is worth\b/i],
    source: 'needs_more_info',
    guidance:
      'Never give a trade value over the phone. It depends on condition, mileage, and the market, and a number you invent will be lower in person — which kills the deal and the trust. ' +
      'Capture year, make, model, mileage, and condition, then offer an appraisal appointment.',
  },
  {
    id: 'dealer.financing_approval',
    question: 'about financing, credit, or approval',
    triggers: [/\b(financ\w+|credit|approv\w+|apr|interest rate|monthly payment|bad credit|no credit|bankruptcy|down payment)\b/i],
    source: 'industry_general',
    guidance:
      'Do not quote rates or payments, and never tell someone whether they will be approved — that is a lender\'s decision and a false promise here is cruel. ' +
      'Do not discuss their credit history. If they raise credit difficulties, stay matter-of-fact and note that the finance team works with a range of situations, without promising an outcome.',
  },
  {
    id: 'dealer.service_appointment',
    question: 'about servicing, recalls, or maintenance',
    triggers: [/\b(oil change|service|maintenance|recall|tire rotation|warranty work|check engine)\b/i],
    source: 'schedule',
    guidance:
      'This is a service booking, not a sales call — do not run sales intake on it. Capture the vehicle, the concern, and book it. ' +
      'Do not confirm whether a recall applies to their VIN or whether work is covered under warranty; that needs a lookup you cannot do.',
  },
];

AUTO_DEALER_KNOWLEDGE.push(
  {
    id: 'dealer.hours_location',
    question: 'about visiting — hours, location, or whether they need an appointment',
    triggers: [/\b(open|hours|close|where are you|located|address|directions|appointment needed|just come)\b/i],
    source: 'business_config',
    requires: ['hours'],
    guidance:
      'Do not state hours or an address without configuration. Turn it into the appointment instead — someone asking whether they can just come in is telling you they intend to visit, ' +
      'and a booked visit is worth far more than an unbooked one.',
  },
  {
    id: 'dealer.warranty_coverage',
    question: 'about warranty coverage on a vehicle',
    triggers: [/\bwarrant\w+/i, /\b(covered|coverage)\b[^.]{0,25}\b(repair|part|still)\b/i, /\bextended (warranty|service)\b/i, /\bcertified pre.?owned\b/i],
    source: 'refuse',
    guidance:
      'Do not tell anyone whether a repair is covered. It depends on the vehicle, the mileage, the contract and the specific failure, and a wrong yes becomes a bill they did not expect. ' +
      'Take the VIN or the vehicle details and route it to service.',
  },
);

SCREEN_KNOWLEDGE.push({
  id: 'screen.structural_safety',
  question: 'about a cage or enclosure that is bent, leaning, or partly down',
  triggers: [/\b(collaps\w+|leaning|bent|sagging|coming down|unsafe|falling)\b/i, /\bis it (safe|going to)\b/i],
  source: 'refuse',
  guidance:
    'Do not tell anyone whether a damaged enclosure is safe or whether it will hold — that is a structural judgement you cannot make from a phone call, and a pool cage coming down on someone is a serious injury. ' +
    'Say to keep people and pets out from under it until it has been looked at, and get someone out. Do not suggest they prop it up or pull it straight.',
});
