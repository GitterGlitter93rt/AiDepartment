// Depth pass.
//
// Added after probing the banks with the questions real callers
// actually ask. Fifty-five of sixty probe questions matched nothing
// industry-specific, and the dominant pattern was scope — "do you do
// gutters?", "do you do septic?", "do you handle adoptions?" — which
// every trade fields constantly and which is almost always a
// BusinessProfile question rather than an industry-knowledge one.
//
// Kept in one file so the shape stays consistent across trades, and so
// it is obvious which entries came from evidence rather than from
// imagining what a caller might say.

import type { KnowledgeEntry } from './types.ts';

/**
 * Builds a scope entry for a trade.
 *
 * "Do you do X?" is a business question, not a trade question: two
 * plumbers a mile apart differ on septic, gas lines and water
 * treatment. Answering it from general knowledge is how a truck gets
 * sent to a job the company does not do.
 */
function scopeEntry(id: string, adjacent: RegExp, examples: string): KnowledgeEntry {
  return {
    id: `${id}.scope`,
    question: 'whether the business does a particular kind of work',
    triggers: [
      /\bdo you (guys |also )?(do|handle|work on|offer|install|service|cover|take on)\b/i,
      /\bcan you (do|handle|install|fix|clean|service)\b/i,
      /\bis that something you\b/i,
      /\bwhat about\b[^.?]{0,25}\?/i,
      adjacent,
    ],
    source: 'business_config',
    requires: ['services'],
    guidance:
      `Do not answer this from general knowledge of the trade. Shops a mile apart differ on ${examples}, ` +
      'and a confident yes sends a van to a job the company does not do — which costs a truck roll and a customer. ' +
      'If the service list is configured, answer from it. If not, say you will check and take the details, ' +
      'because you still want the job on the sheet either way.',
  };
}

export const PLUMBING_DEPTH: KnowledgeEntry[] = [
  scopeEntry('plumbing', /\b(septic|water softener|water treatment|gas line|sewer camera|camera the line|hydro ?jet|well pump|sprinkler|backflow|repipe)\b/i,
    'septic, gas lines, water treatment and well systems'),
  {
    id: 'plumbing.low_pressure',
    question: 'about low water pressure',
    triggers: [/\b(pressure|flow)\b[^.]{0,30}\b(low|weak|bad|dropped|terrible|nothing)\b/i,
      /\b(no|hardly any|not much|lost)\b[^.]{0,15}\b(pressure|water pressure)\b/i,
      /\bbarely (any|a trickle)\b/i, /\btrickle\b/i],
    source: 'needs_more_info',
    guidance:
      'The useful question is whether it is one fixture or the whole house — that single answer separates a clogged aerator or cartridge from a supply, regulator or main-line problem, ' +
      'and it is worth asking before anything else. Also ask whether it came on gradually or suddenly, and whether it affects hot, cold, or both. Do not diagnose it.',
  },
  {
    id: 'plumbing.water_quality',
    question: 'about discoloured, smelly, or bad-tasting water',
    triggers: [/\bwater\b[^.]{0,30}\b(brown|rusty|cloudy|smells?|taste|tastes|dirty|discolo\w+|sulfur|rotten egg)\b/i, /\bis (my|the) water safe\b/i],
    source: 'escalate',
    guidance:
      'Do not tell anyone their water is safe or unsafe to drink — that is not a judgement to make over the phone, and being wrong either way is serious. ' +
      'Two things that genuinely help: ask whether it is hot only (often the water heater) or both, and whether neighbours have it too (often the utility). ' +
      'If they mention illness, tell them to stop drinking it and contact the water utility.',
  },
  {
    id: 'plumbing.disposal_jam',
    question: 'about a jammed or humming garbage disposal',
    triggers: [/\b(garbage )?disposal\b/i, /\bhumming\b/i, /\bjam\w*/i],
    source: 'industry_general',
    guidance:
      'One safe step worth giving, because it resolves a good share of these: switch it off at the wall, and there is usually a red reset button on the underside of the unit. ' +
      'Never tell anyone to put a hand into a disposal, even with the power off. If it still hums after a reset, stop there — a humming motor is drawing current and should be left off.',
  },
  {
    id: 'plumbing.repipe',
    question: 'about repiping or replacing supply lines',
    triggers: [/\brepipe\w*/i, /\b(polybutylene|poly ?b|galvani[sz]ed|cast iron|cpvc|pex)\b/i, /\breplace (all )?(the )?(pipes|plumbing)\b/i],
    source: 'needs_more_info',
    guidance:
      'A repipe is a project, not a service call, and it needs a site visit. Useful to capture: the property age, the pipe material if they know it, the number of bathrooms, and whether it is slab or crawlspace. ' +
      'Do not quote, and do not tell them their pipe material must be replaced.',
  },
];

export const ROOFING_DEPTH: KnowledgeEntry[] = [
  scopeEntry('roofing', /\b(gutters?|siding|skylight|soffit|fascia|chimney|solar|flat roof|metal roof|tile)\b/i,
    'gutters, siding, skylights and chimney work'),
  {
    id: 'roofing.patch_or_full',
    question: 'whether it can just be patched',
    triggers: [/\b(just|only|simple)\b[^.]{0,20}\b(patch|repair|fix)\b/i, /\bcan you (just )?patch\b/i, /\bdo i need the whole\b/i],
    source: 'needs_more_info',
    guidance:
      'Fine to explain generally that a localised problem on a roof with life left in it usually repairs, while widespread damage or an old roof usually does not — and that patching a roof near the end of its life often costs money twice. ' +
      'Do not decide theirs sight unseen and do not quote either option.',
  },
  {
    id: 'roofing.insurance_liaison',
    question: 'whether the company will deal with the insurance company',
    triggers: [/\b(deal|work|talk|meet|handle)\b[^.]{0,30}\b(insurance|adjuster|carrier)\b/i, /\bdo you (do|handle) (the )?claims?\b/i, /\bmeet the adjuster\b/i],
    source: 'business_config',
    requires: ['services'],
    guidance:
      'Practice varies a great deal here and some of it is regulated — in several states a contractor negotiating a claim is acting as a public adjuster, which requires a licence. ' +
      'Do not promise the company will handle the claim. Say it will be covered when someone comes out, and capture the carrier and claim number.',
  },
  {
    id: 'roofing.job_logistics',
    question: 'practical questions about the day of the work',
    triggers: [/\bdo i (need|have) to be (home|there|present)\b/i, /\b(haul|take|clean) (away|up)\b/i,
      /\b(driveway|car|dumpster|nails|debris|landscap\w+|satellite|dish|solar panels?)\b/i, /\bhow (loud|messy)\b/i,
      /\bhow (many|big)\b[^.]{0,25}\b(squares?|square feet|sq ?ft)\b/i, /\bhow (big|large) is (my|the) roof\b/i],
    source: 'industry_general',
    guidance:
      'Generally true and reassuring: a tear-off is noisy and dusty, crews normally use a magnet for nails afterwards, and vehicles usually need moving off the driveway. ' +
      'Do not commit to whether they must be home, what happens to a satellite dish or solar array, or who moves what — those are job-specific and belong to whoever quotes it. ' +
      'Note anything on the roof, because it genuinely changes the quote.',
  },
  {
    id: 'roofing.referral',
    question: 'mentioning a referral or a neighbour',
    triggers: [/\b(neighbou?r|friend|referred|recommended|used you|saw your (sign|truck|yard sign))\b/i],
    source: 'needs_more_info',
    guidance:
      'Worth capturing — a referral is the highest-converting lead a roofer gets, and the person who referred them often deserves acknowledgement. ' +
      'Ask who referred them, and note it. Do not confirm any past job or discuss another customer.',
  },
];

export const REAL_ESTATE_DEPTH: KnowledgeEntry[] = [
  scopeEntry('real_estate', /\b(rentals?|property management|commercial|land|lots?|new construction|mobile home|auction)\b/i,
    'rentals, commercial, land and new construction'),
  {
    id: 're.how_long_to_sell',
    question: 'how long it will take to sell',
    triggers: [/\bhow long\b[^.]{0,30}\b(sell|take|on the market|list)\b/i, /\bdays on market\b/i,
      /\bhow (fast|quickly) (can|will|do)\b/i, /\bhow many showings\b/i, /\bwhat (should|can) i expect\b/i],
    source: 'industry_general',
    guidance:
      'Safe and general: it depends on price, condition, and what the local market is doing, and the agent will have current numbers for their area. ' +
      'Do not give a number of days or promise a timeframe — a seller who was told "three weeks" and is still waiting at ten is a complaint, not a client.',
  },
  {
    id: 're.repairs_staging',
    question: 'whether to make repairs, stage, or improve before listing',
    triggers: [/\b(repairs?|fix (it |anything )?up|paint|stag\w+|declutter|renovat\w+|worth (doing|fixing))\b/i, /\bshould i (do|fix|paint|update)\b/i],
    source: 'needs_more_info',
    guidance:
      'Do not tell them what to spend money on — that judgement needs someone who has seen the house and knows what local buyers are paying for. ' +
      'It is a genuinely good sign when a seller asks: it means they are serious. Capture it and get the appointment, where an agent can walk it with them.',
  },
  {
    id: 're.process_terms',
    question: 'what a term in the process means',
    triggers: [/\bwhat (is|are|does)\b[^.?]{0,30}\b(earnest money|escrow|contingency|appraisal|title|closing costs?|due diligence|under contract|option period)\b/i, /\bdo i need an inspection\b/i],
    source: 'industry_general',
    guidance:
      'General definitions are fine and build confidence — earnest money is a good-faith deposit, escrow is a neutral third party holding funds, a contingency is a condition that must be met. ' +
      'Keep it to a sentence; this is a phone call, not a class. Do not advise on whether to waive anything or what amount to offer.',
  },
  {
    id: 're.for_sale_by_owner',
    question: 'about selling without an agent',
    triggers: [/\b(fsbo|for sale by owner|sell it myself|do it myself|save the commission)\b/i,
      /\bwithout (an? )?(agent|realtor|broker|you)\b/i, /\bwhy (do i|would i) need\b/i],
    source: 'needs_more_info',
    guidance:
      'Do not argue with them and do not disparage the idea — someone testing the question is usually price-sensitive rather than hostile, and arguing loses them. ' +
      'Ask what they are hoping to achieve and what their timeline is, and offer a conversation with no obligation. Do not quote a commission.',
  },
  {
    id: 're.cash_offer',
    question: 'about a cash offer or a quick sale',
    triggers: [/\bcash (offer|buyer|sale)\b/i, /\b(quick|fast|as.is) (sale|sell)\b/i, /\bibuyer|opendoor|offerpad\b/i, /\bjust want it (gone|sold)\b/i],
    source: 'needs_more_info',
    guidance:
      'Do not compare a cash offer to a market sale or tell them what they would net either way. Find out why speed matters — a job move, a probate, a property they cannot maintain — ' +
      'because that reason is what an agent needs and it usually changes the advice. Treat urgency as a reason to get them a call quickly.',
  },
];

export const PRESSURE_WASHING_DEPTH: KnowledgeEntry[] = [
  scopeEntry('pressure_washing', /\b(gutters?|windows?|pool cage|screens?|seal(ing|er)?|paint|deck stain|solar panels?|dumpster)\b/i,
    'gutter cleaning, windows, screen enclosures and sealing'),
  {
    id: 'pw.plants_pets',
    question: 'whether the cleaning will harm plants, pets, or grass',
    triggers: [/\b(plants?|grass|lawn|landscap\w+|flowers?|garden|pets?|dogs?|cats?|kids?)\b/i, /\b(kill|harm|damage|safe)\b[^.]{0,30}\b(plants?|grass|lawn|pets?)\b/i],
    source: 'industry_general',
    guidance:
      'Generally: reputable operators pre-wet and rinse landscaping, and ask that pets be kept inside while they work. ' +
      'Do not promise nothing will be affected and do not name the solutions used. Note if they have anything delicate — it is the kind of detail that turns a good job into a complaint when missed.',
  },
  {
    id: 'pw.logistics',
    question: 'practical questions about the visit',
    triggers: [/\bhow long (does|will|would) it take\b/i, /\bmove (my|the) car\b/i, /\bdo i (need|have) to\b/i, /\bwhat time\b/i, /\bhow (many|much) (people|water)\b/i],
    source: 'industry_general',
    guidance:
      'Generally a typical house or driveway is a few hours rather than a day, vehicles are usually moved off the area being cleaned, and windows and doors should be closed. ' +
      'Do not commit to a duration or an arrival window for their job. These questions usually mean they are close to booking, so answer briefly and move to scheduling.',
  },
  {
    id: 'pw.sealing',
    question: 'about sealing or coating after cleaning',
    triggers: [/\bseal\w*/i, /\bcoat\w*/i, /\bstain\b[^.]{0,20}\b(deck|fence|wood)\b/i, /\bprotect\w*\b[^.]{0,20}\b(driveway|pavers?|concrete)\b/i],
    source: 'business_config',
    requires: ['services'],
    guidance:
      'Sealing is a separate service many exterior cleaners do not offer, and it usually has to happen after the surface has dried. Do not assume it is available or quote it. ' +
      'Capture the surface and note the interest — it is a meaningful upsell for the business.',
  },
];

export const LEGAL_DEPTH: KnowledgeEntry[] = [
  {
    id: 'legal.practice_areas',
    question: 'whether the firm handles a particular kind of matter',
    triggers: [
      /\bdo you (guys )?(handle|do|take|practice)\b/i,
      /\b(adoption|prenup|postnup|name change|guardianship|bankruptcy|immigration|estate planning|real estate closing|business|employment|workers.? comp|social security|traffic|landlord|tenant)\b/i,
      /\bis that something you (do|handle)\b/i,
    ],
    source: 'business_config',
    requires: ['specialties'],
    guidance:
      'Do not claim a practice area that was not configured — a firm taking on a matter outside its competence is a professional problem, not just a scheduling one. ' +
      'If it is plainly outside what this firm does, say so simply and offer to take their details anyway so someone can point them in the right direction. Never recommend a specific other firm.',
  },
  {
    id: 'legal.firm_experience',
    question: 'about the firm\'s experience or track record',
    triggers: [/\bhow many\b[^.]{0,30}\b(cases|clients|years)\b/i, /\bhave you (ever )?(handled|done|won)\b/i, /\b(track record|success rate|win rate|experience)\b/i, /\bhow good\b/i],
    source: 'business_config',
    requires: ['licensing'],
    guidance:
      'Never state a success rate, a win rate, or a number of cases — several bar associations restrict exactly those claims, so this is a regulatory line and not merely a factual one. ' +
      'Say the attorney will go through their background at the consultation, and get them booked.',
  },
  {
    id: 'legal.logistics',
    question: 'practical questions about the consultation',
    triggers: [/\bwhere (is|are) (your|the) (office|you)\b/i, /\bwhat (do|should) i (need to )?bring\b/i, /\bcan i bring\b/i, /\bhow long (is|does)\b[^.]{0,25}\b(consult|meeting|appointment)\b/i, /\b(phone|video|zoom|in person|virtual)\b/i, /\bparking\b/i],
    source: 'business_config',
    requires: ['serviceArea'],
    guidance:
      'Do not state an address, parking arrangements, or whether consultations are in person or by video unless configured. ' +
      'What is safe and genuinely useful: encourage them to bring any documents they have — anything they were served with, court paperwork, or correspondence from the other side — because it makes the meeting far more productive. ' +
      'Bringing a family member is usually fine but it is not yours to authorise; note that they asked.',
  },
  {
    id: 'legal.which_court',
    question: 'about which court or county the matter is in',
    triggers: [/\bwhat (court|county)\b/i, /\bdo you (go to|appear in|practice in)\b/i, /\b(circuit|district|family) court\b/i],
    source: 'business_config',
    requires: ['serviceArea'],
    guidance:
      'Do not confirm the firm appears in a particular court without configuration — attorneys are licensed by jurisdiction and it is a real constraint, not a preference. ' +
      'Capture where the matter is, since it determines whether the firm can take it at all, and let a person confirm.',
  },
];

export const HVAC_DEPTH: KnowledgeEntry[] = [
  scopeEntry('hvac', /\b(duct ?work|duct cleaning|mini ?split|air quality|uv|dehumidif\w+|commercial|geothermal|boiler|radiant)\b/i,
    'duct cleaning, mini splits, air quality and commercial work'),
  {
    id: 'hvac.sizing',
    question: 'what size system they need',
    triggers: [/\bwhat size\b/i, /\bhow (big|many tons?)\b/i, /\b\d+\s?tons?\b/i, /\bseer\b/i, /\bhow much (system|unit)\b/i],
    source: 'refuse',
    guidance:
      'Do not size a system over the phone, and do not repeat the square-feet-per-ton rule of thumb — sizing needs a load calculation, and an oversized unit short-cycles, fails to dehumidify, and wears out early. ' +
      'Say it needs someone to measure and calculate, which is exactly what the visit is for.',
  },
  {
    id: 'hvac.uneven_temperature',
    question: 'about one room or floor being hotter or colder',
    triggers: [/\b(upstairs|downstairs|one room|back (room|bedroom)|master)\b[^.]{0,35}\b(hot|cold|warm|never|always)\b/i, /\buneven\b/i, /\bwon'?t (cool|heat) (the )?(upstairs|whole)\b/i],
    source: 'needs_more_info',
    guidance:
      'A real and common complaint with several ordinary causes — duct design, insulation, a closed or blocked register, or a system sized for a different layout. Say generally that it usually comes down to airflow rather than the unit being broken. ' +
      'Ask whether it has always been like that or is new; "always" is a design problem and "new" is usually a fault.',
  },
  {
    id: 'hvac.maintenance_plan',
    question: 'about a maintenance plan or tune-up',
    triggers: [/\b(maintenance (plan|agreement|contract)|tune.?up|service plan|annual|twice a year|membership)\b/i],
    source: 'business_config',
    requires: ['services'],
    guidance:
      'Do not describe what a plan includes or what it costs. Generally, systems are serviced once or twice a year and neglected ones fail sooner — that much is fair. ' +
      'Note the interest; recurring maintenance revenue matters a lot to these businesses.',
  },
];

export const ELECTRICAL_DEPTH: KnowledgeEntry[] = [
  scopeEntry('electrical', /\b(generator|hot tub|pool|landscape lighting|low voltage|data|network|solar|ev charger|ceiling fan|attic fan)\b/i,
    'generators, low-voltage work, pools and landscape lighting'),
  {
    id: 'elec.small_jobs',
    question: 'about a small installation job',
    triggers: [/\b(install|add|put in|replace|hang|run)\b[^.]{0,30}\b(ceiling fans?|outlets?|switch(es)?|lights?|fixtures?|dimmers?|smoke detectors?|doorbell|receptacles?|circuits?)\b/i],
    source: 'schedule',
    guidance:
      'These are straightforward bookings, so book them rather than over-qualifying. Worth capturing: how many, whether wiring already exists at that spot, and the ceiling height for a fan. ' +
      'Do not quote. Several small jobs at once is a better visit for everyone, so it is fair to ask whether anything else needs doing while someone is out.',
  },
  {
    id: 'elec.fan_not_working',
    question: 'about a bathroom fan, attic fan, or exhaust fan',
    triggers: [/\b(bathroom|attic|exhaust|vent) fan\b/i, /\bfan\b[^.]{0,25}\b(not work\w*|stopped|noisy|loud)\b/i],
    source: 'needs_more_info',
    guidance:
      'Ask whether it has stopped entirely or become noisy, and whether the light on the same switch still works — that separates a switch or wiring fault from a failed motor. ' +
      'Do not diagnose. A bathroom fan that has stopped is worth treating as more than cosmetic, since it is what keeps moisture out of the ceiling.',
  },
];
