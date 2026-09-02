// Knowledge banks for the professional, regulated, enterprise and
// growth industries.

import type { KnowledgeEntry } from './types.ts';

export const PROPERTY_MGMT_KNOWLEDGE: KnowledgeEntry[] = [
  {
    id: 'pm.who_pays',
    question: 'who is responsible for a repair',
    triggers: [/\bwho (pays|is responsible|has to fix)\b/i, /\bdo i have to pay\b/i, /\bmy (lease|deposit)\b/i, /\bcharge me\b/i],
    source: 'refuse',
    guidance:
      'Do not interpret their lease or state who is liable — that is a contractual and sometimes legal question, and being wrong creates a dispute. ' +
      'Log the maintenance request, which is what actually helps them, and say the office will confirm how it is handled.',
  },
  {
    id: 'pm.emergency_maintenance',
    question: 'whether their maintenance issue is an emergency',
    triggers: [/\b(emergency|urgent|no (water|heat|power|ac)|flooding|gas|sewage|lock(ed)? out|break.?in)\b/i, /\bafter hours\b/i],
    source: 'escalate',
    guidance:
      'Some of these genuinely are emergencies: no heat in freezing weather, no water, active flooding, gas smell, sewage, or a unit that cannot be secured. ' +
      'A gas smell means leave and call the gas company or 911, immediately, before anything else. Escalate real emergencies rather than logging them as tickets.',
  },
  {
    id: 'pm.application_status',
    question: 'about a rental application or availability',
    triggers: [/\b(applicat\w+|apply|approved|denied|credit check|background|deposit|move.?in)\b/i, /\bwhat'?s? available\b/i, /\bhow much is rent\b/i],
    source: 'business_config',
    requires: ['services'],
    guidance:
      'Do not state rents, availability, deposits, or screening criteria without configuration, and never comment on why an application was denied — ' +
      'screening decisions carry fair-housing exposure and are not yours to explain. Capture what they are looking for and get it to the leasing team.',
  },
  {
    id: 'pm.owner_pitch',
    question: 'about having their property managed',
    triggers: [/\bi own\b/i, /\bmanage (my|our) (propert\w+|rental|house|units?)\b/i, /\b(fee|commission|percentage|what do you charge)\b/i, /\bhow many (units|doors)\b/i],
    source: 'needs_more_info',
    guidance:
      'This is a new-business call and worth more than a maintenance ticket — treat it accordingly. Capture the number of units, where they are, whether they are currently tenanted, and whether they are managed now. ' +
      'Do not quote a management fee. Get it to a person quickly.',
  },
];

export const HEALTHCARE_KNOWLEDGE: KnowledgeEntry[] = [
  {
    id: 'health.medical_advice',
    question: 'a medical question about symptoms or treatment',
    triggers: [/\b(should i (be )?(worried|come in|go to)|is (this|that) normal|what (does|could) (this|it) mean|symptom|pain|fever|bleeding|dizzy|rash|lump)\b/i, /\bdo i need to (see|be seen)\b/i],
    source: 'refuse',
    guidance:
      'Give no medical advice of any kind, including reassurance that something sounds minor. You are scheduling, not triaging. ' +
      'Say clearly that clinical questions need the provider, and offer the soonest appropriate appointment. ' +
      'If they describe anything that sounds like an emergency — chest pain, difficulty breathing, severe bleeding, stroke symptoms, thoughts of self-harm — tell them to call 911 or go to an emergency room, and do not continue with scheduling.',
  },
  {
    id: 'health.insurance_accepted',
    question: 'whether their insurance is accepted',
    triggers: [/\b(do you (take|accept)|in.?network|out of network|covered)\b/i, /\b(blue cross|aetna|cigna|united|humana|medicare|medicaid|tricare|bcbs)\b/i, /\bmy insurance\b/i],
    source: 'business_config',
    requires: ['insurance'],
    guidance:
      'Never guess at network participation. Telling someone you take their plan when you do not results in a bill they did not expect. ' +
      'If it is configured, answer. If not, say you will have that verified and take the plan name and member ID so someone can check before the visit.',
  },
  {
    id: 'health.records_privacy',
    question: 'about medical records or someone else\'s information',
    triggers: [/\b(records|chart|results|test results|my (wife|husband|mother|father|son|daughter))\b/i, /\bcan you tell me (about|if)\b/i, /\bhipaa\b/i],
    source: 'escalate',
    guidance:
      'Do not confirm whether someone is a patient, discuss any record, or give results — this is protected health information and the rules are strict. ' +
      'That applies to family members asking about relatives, however reasonable it sounds. Take a name and number and route it to the office.',
  },
  {
    id: 'health.new_patient',
    question: 'about becoming a new patient',
    triggers: [/\bnew patient\b/i, /\b(accepting|taking) (new )?patients\b/i, /\bget established\b/i, /\bhow soon can i be seen\b/i],
    source: 'business_config',
    requires: ['services'],
    guidance:
      'Do not state whether the practice is accepting new patients unless configured — availability changes and a wrong answer turns someone away needlessly. ' +
      'Take their details and what they need to be seen for, and offer to have the office confirm.',
  },
];

export const INSURANCE_KNOWLEDGE: KnowledgeEntry[] = [
  {
    id: 'ins.am_i_covered',
    question: 'whether something is covered by their policy',
    triggers: [/\b(covered|cover|does my policy|am i covered|will it pay)\b/i, /\bdeductible\b/i],
    source: 'refuse',
    guidance:
      'Do not make a coverage determination. You have not read their policy, coverage varies by form and endorsement, and an incorrect answer here has real financial consequences. ' +
      'Take the policy number and what happened, and get it to a licensed agent or the claims team.',
  },
  {
    id: 'ins.quote_price',
    question: 'what a policy would cost',
    triggers: [/\b(quote|how much|premium|rate|cheaper|save|price)\b/i],
    source: 'needs_more_info',
    guidance:
      'Never quote a premium. Rates depend on the vehicle or property, location, history, and the coverage selected, and none of that is known yet. ' +
      'What you can do is gather exactly those things so a real quote can be produced — that is the whole job of this call. ' +
      'Do not promise savings over their current carrier.',
  },
  {
    id: 'ins.claim_process',
    question: 'how to file or follow up a claim',
    triggers: [/\b(file|start|report|status of|follow up)\b[^.]{0,25}\bclaim\b/i, /\bwhat do i do (next|now)\b/i, /\badjuster\b/i],
    source: 'industry_general',
    guidance:
      'General process is fine: claims are typically reported promptly, an adjuster is assigned, and documentation matters. Tell them to photograph damage before anything is repaired or removed. ' +
      'Do not predict the outcome, the payout, or the timeline, and do not confirm the status of an existing claim — you cannot see it.',
  },
  {
    id: 'ins.rate_increase',
    question: 'why their premium went up',
    triggers: [/\b(went up|increase|higher|more expensive|raised)\b/i, /\bwhy (is|am) (it|i) paying\b/i],
    source: 'escalate',
    guidance:
      'Do not speculate about why — rating factors are complex and a guess sounds like an excuse. Do not become defensive about it either. ' +
      'Acknowledge the frustration, take the policy number, and get them to an agent who can review it properly.',
  },
];
export const FINANCIAL_KNOWLEDGE: KnowledgeEntry[] = [
  {
    id: 'fin.investment_advice',
    question: 'what they should do with their money',
    triggers: [/\bshould i (invest|buy|sell|move|roll|convert|put)\b/i, /\bwhat (should|would) i do with\b/i, /\b(good|bad) (time|idea) to\b/i, /\bwhich (fund|stock|account)\b/i],
    source: 'refuse',
    guidance:
      'Give no investment, tax, or financial advice — none, including the mild version ("a lot of people are moving to..."). This is a regulated area and you are not licensed. ' +
      'Say an advisor needs to look at their whole picture, and get the consultation booked.',
  },
  {
    id: 'fin.fees',
    question: 'how the firm charges',
    triggers: [/\b(fee|cost|charge|commission|aum|percentage|hourly|flat fee)\b/i, /\bhow do you (get paid|make money)\b/i],
    source: 'business_config',
    requires: ['pricing'],
    guidance:
      'Do not quote fees or describe the fee model without configuration — fee structure is a compliance-sensitive disclosure. ' +
      'Say it will be covered fully at the meeting, and note that they asked.',
  },
  {
    id: 'fin.tax_deadline',
    question: 'about tax deadlines or filing',
    triggers: [/\b(deadline|extension|april|file|filing|late|penalty|irs|audit)\b/i],
    source: 'needs_more_info',
    guidance:
      'Do not give tax advice or state deadlines as applying to their situation, and do not comment on penalties or an audit. ' +
      'An IRS notice or an imminent deadline is genuinely time-sensitive though — capture it and escalate rather than booking three weeks out.',
  },
  {
    id: 'fin.minimum_assets',
    question: 'whether they have enough to work with the firm',
    triggers: [/\bminimum\b/i, /\bdo you (work with|take) (people|clients)\b/i, /\bis (that|it) enough\b/i, /\btoo small\b/i],
    source: 'business_config',
    requires: ['services'],
    guidance:
      'Do not state an asset minimum unless configured, and never tell someone they do not qualify — that is a decision for the firm and an embarrassing one to get wrong. ' +
      'Take their details and let a person follow up.',
  },
];

export const PROFESSIONAL_SERVICES_KNOWLEDGE: KnowledgeEntry[] = [
  {
    id: 'prof.what_do_you_do',
    question: 'what the firm actually does',
    triggers: [/\bwhat (do|does) (you|your firm|they) (do|offer|specialise|specialize)\b/i, /\bdo you (do|handle|work with)\b/i],
    source: 'business_config',
    requires: ['services'],
    guidance:
      'Do not describe capabilities that were not configured — overpromising scope at the front door creates a bad first meeting. ' +
      'Ask what they are trying to solve instead; it is more useful and it qualifies them.',
  },
  {
    id: 'prof.rates',
    question: 'about rates or engagement cost',
    triggers: [/\b(rate|fee|cost|budget|proposal|retainer|hourly|how much)\b/i],
    source: 'business_config',
    requires: ['pricing'],
    guidance:
      'Do not quote rates. Ask about scope and timeline instead, which is what a proposal is built from, and route it to a person.',
  },
  {
    id: 'prof.existing_engagement',
    question: 'about work already underway',
    triggers: [/\b(our|the) (project|engagement|contract|proposal|deliverable)\b/i, /\bstatus\b/i, /\bwho'?s? (working on|handling)\b/i],
    source: 'escalate',
    guidance:
      'You cannot see engagement records. Do not confirm status, dates, or who is assigned. Take the company name and the contact, and route it.',
  },
];

export const MANUFACTURING_KNOWLEDGE: KnowledgeEntry[] = [
  {
    id: 'mfg.capabilities',
    question: 'whether the shop can make their part',
    triggers: [/\b(can you (make|do|machine|produce|handle)|capab\w+|tolerance|material|5.axis|cnc|swiss|anodi[sz]|plating|weld)\b/i, /\bwhat (equipment|machines)\b/i],
    source: 'business_config',
    requires: ['services'],
    guidance:
      'Do not assert capabilities, tolerances, or in-house processes that were not configured — an over-promised tolerance becomes a rejected shipment. ' +
      'Capture the part, material, tolerance, and quantity, and get it to an estimator. Ask whether they can send drawings.',
  },
  {
    id: 'mfg.lead_time_price',
    question: 'about lead time or piece price',
    triggers: [/\b(lead ?time|how (long|soon)|price|cost|per (piece|part|unit)|quote)\b/i, /\bexpedite\b/i, /\brush\b/i],
    source: 'needs_more_info',
    guidance:
      'Do not quote price or lead time. Both depend on material, quantity, tolerance, finishing, and current capacity. ' +
      'Gather the RFQ inputs properly — that is the value of this call — and flag anything described as a rush or a line-down situation as urgent.',
  },
  {
    id: 'mfg.quality_issue',
    question: 'about a quality problem with delivered parts',
    triggers: [/\b(out of spec|nonconform\w+|reject\w+|defect\w+|wrong|scrap|failed inspection|line down)\b/i],
    source: 'escalate',
    guidance:
      'A quality escape, especially one stopping a customer\'s line, is the most urgent call this business takes. Do not defend the parts and do not accept blame. ' +
      'Capture the part number, purchase order, quantity affected, and what was found, then escalate to quality immediately.',
  },
];

export const LOGISTICS_KNOWLEDGE: KnowledgeEntry[] = [
  {
    id: 'log.rate_quote',
    question: 'a shipping rate',
    triggers: [/\b(rate|quote|cost|how much|price)\b/i, /\bship\w*\b/i],
    source: 'needs_more_info',
    guidance:
      'Do not quote a rate. Freight pricing depends on lane, weight, dimensions, class, equipment, and timing, and the market moves. ' +
      'Gather those properly: origin and destination, what it is, weight, dimensions, pallet count, equipment type, and pickup date.',
  },
  {
    id: 'log.where_is_shipment',
    question: 'where their shipment is',
    triggers: [/\bwhere('?s| is)\b/i, /\btrack\w*/i, /\b(pro|bol|load) number\b/i, /\bnever (arrived|showed|delivered)\b/i, /\blate\b/i],
    source: 'escalate',
    guidance:
      'You cannot see tracking. Do not state a location, an ETA, or that something is out for delivery — a made-up ETA is worse than no answer. ' +
      'Take the PRO or BOL number and the contact, and get it to dispatch. A shipment that has genuinely failed to arrive is urgent.',
  },
  {
    id: 'log.damage_claim',
    question: 'about damaged or missing freight',
    triggers: [/\b(damage\w*|broken|missing|short|shortage|claim)\b/i],
    source: 'escalate',
    guidance:
      'Do not accept liability, comment on who is at fault, or explain claim outcomes. ' +
      'Capture the PRO number, what was damaged, and whether it was noted on the delivery receipt — that last detail matters a great deal in freight claims and is worth asking for. Escalate.',
  },
];

export const ENERGY_KNOWLEDGE: KnowledgeEntry[] = [
  {
    id: 'energy.gas_leak',
    question: 'a gas smell or a downed power line',
    triggers: [/\b(smell(s|ing)? gas|gas leak|rotten eggs)\b/i, /\b(power ?line|wire|cable)\b[^.]{0,30}\b(down|hanging|sparking|arcing|on the ground)\b/i],
    source: 'escalate',
    guidance:
      'This is a life-safety emergency and it overrides everything. Gas: leave the building now, do not switch anything on or off, do not use a phone indoors, and call 911 or the gas emergency line from outside. ' +
      'Downed line: stay far away, assume it is live, keep others back, and call 911. Do not take details first. Do not continue intake.',
  },
  {
    id: 'energy.outage',
    question: 'about a power outage',
    triggers: [/\b(outage|power (is )?(out|off)|no power|blackout|when will it be back)\b/i],
    source: 'needs_more_info',
    guidance:
      'Do not give a restoration estimate — you have no outage data and a wrong time makes people angrier. ' +
      'Take the service address, ask whether neighbours are also out, and route it. Anyone on life-sustaining medical equipment should be escalated immediately.',
  },
  {
    id: 'energy.project',
    question: 'about an energy project, program, or becoming a supplier',
    triggers: [/\b(efficiency|audit|solar|storage|generation|ppa|demand response|program|incentive|rebate|vendor|supplier|rfp)\b/i],
    source: 'needs_more_info',
    guidance:
      'Do not quote incentives, rebates, or program eligibility — those change and vary by jurisdiction. ' +
      'Capture the organisation, the facility, and what they are trying to achieve, then route it to the right team.',
  },
];

export const DEFENSE_KNOWLEDGE: KnowledgeEntry[] = [
  {
    id: 'def.certifications',
    question: 'about certifications, ITAR, or clearances',
    triggers: [/\b(as9100|iso ?9001|itar|ear|dfars|cmmc|nadcap|clearance|cage code|registered)\b/i, /\bare you (certified|compliant|registered)\b/i],
    source: 'business_config',
    requires: ['licensing'],
    guidance:
      'Never assert a certification, registration, or clearance that was not configured. In this sector a false compliance claim is not a customer-service problem, it is a legal and contractual one. ' +
      'If it is not configured, say you will have it confirmed in writing and take the contact.',
  },
  {
    id: 'def.technical_data',
    question: 'to share drawings or technical specifications',
    triggers: [/\b(drawings?|prints?|specs?|technical data|cad|step file|send you)\b/i, /\bcan i (email|send)\b/i],
    source: 'escalate',
    guidance:
      'Do not invite anyone to send technical data over the phone or to a general address. Export-controlled data has handling requirements and this is not the channel. ' +
      'Take the contact and let the right person establish a compliant route.',
  },
  {
    id: 'def.program_inquiry',
    question: 'about a program, RFI, or supplier qualification',
    triggers: [/\b(rfi|rfp|rfq|program|prime|subcontract|qualif\w+|approved vendor|source)\b/i],
    source: 'needs_more_info',
    guidance:
      'Capture the organisation, the program if they can name it, the timeline, and whether there is a solicitation number. Do not commit to bidding or to capability. Route it to business development.',
  },
];

export const SOLAR_KNOWLEDGE: KnowledgeEntry[] = [
  {
    id: 'solar.savings',
    question: 'how much they will save',
    triggers: [/\b(save|savings|payback|worth it|roi|pay for itself|eliminate my bill|zero)\b/i, /\bhow much (will|would) i save\b/i],
    source: 'needs_more_info',
    guidance:
      'Do not promise savings, a payback period, or eliminating their bill. Solar savings claims are heavily scrutinised and a made-up figure is both dishonest and a compliance risk. ' +
      'Ask what they currently pay and what their usage looks like — a real analysis needs their actual bill, which is a good reason to book the appointment.',
  },
  {
    id: 'solar.tax_credit',
    question: 'about tax credits or incentives',
    triggers: [/\b(tax credit|itc|incentive|rebate|net meter\w*|srec|government|free solar)\b/i],
    source: 'refuse',
    guidance:
      'Do not state credit percentages, eligibility, or what they will receive — incentives change, depend on tax situation, and this edges into tax advice. ' +
      'Say a consultant will go through current incentives and that their accountant should confirm what applies to them. Never say solar is free.',
  },
  {
    id: 'solar.roof_condition',
    question: 'whether their roof can take panels',
    triggers: [/\broof\b/i, /\b(old|age|replace|leak|shade|trees?|angle|direction|hoa)\b/i],
    source: 'industry_general',
    guidance:
      'Fair and generally true: roof age matters, because removing and reinstalling panels later costs money, so an old roof is often replaced first. Shading and orientation affect production. ' +
      'Do not assess their specific roof or tell them it needs replacing. Ask the age and whether there is significant tree cover.',
  },
  {
    id: 'solar.system_down',
    question: 'about a system that has stopped producing',
    triggers: [/\b(not (producing|working|generating)|stopped|offline|down|error|red light|inverter|app)\b/i],
    source: 'needs_more_info',
    guidance:
      'Capture what the monitoring or inverter is showing and how long it has been down — production loss costs them money daily, so it deserves a prompt response. ' +
      'Do not talk them through resetting an inverter; there is real DC voltage involved. Do not confirm warranty coverage.',
  },
];

export const FIBER_KNOWLEDGE: KnowledgeEntry[] = [
  {
    id: 'fiber.availability',
    question: 'whether service is available at their address',
    triggers: [/\b(available|serviceab\w+|at my address|in my (area|neighborhood)|do you (have|offer|cover))\b/i, /\bwhen (will|are) you (be )?(coming|building)\b/i],
    source: 'business_config',
    requires: ['serviceArea'],
    guidance:
      'Do not tell someone service is available, or that it is coming, without configuration. A false yes wastes an install truck; a false no loses a customer permanently. ' +
      'Take the full service address and offer to have it checked and confirmed.',
  },
  {
    id: 'fiber.speed_price',
    question: 'about speeds, plans, or pricing',
    triggers: [/\b(speed|gig|mbps|plan|package|price|cost|per month|promo|contract|data cap)\b/i],
    source: 'business_config',
    requires: ['pricing'],
    guidance:
      'Do not quote plans or prices without configuration; promotional pricing changes constantly and a stale number becomes a billing complaint. ' +
      'Capture what they need it for and how many people use it, and route it.',
  },
  {
    id: 'fiber.outage_troubleshoot',
    question: 'about service being down or slow',
    triggers: [/\b(down|out|not working|slow|dropping|buffering|no internet|keeps disconnecting)\b/i],
    source: 'industry_general',
    guidance:
      'Two safe steps that genuinely fix a good share of these: power-cycle the router and the ONT for thirty seconds, and check whether it affects wired as well as wireless devices. ' +
      'Do not confirm a network outage you cannot see. If they work from home or mention a medical device on the line, treat it with more urgency.',
  },
];

export const ECOMMERCE_KNOWLEDGE: KnowledgeEntry[] = [
  {
    id: 'ecom.where_is_order',
    question: 'where their order is',
    triggers: [/\bwhere('?s| is) my (order|package|stuff|delivery)\b/i, /\btrack\w*/i, /\bhasn'?t (arrived|come|shipped)\b/i, /\bsupposed to be here\b/i],
    source: 'escalate',
    guidance:
      'You cannot see order systems. Do not state a status, a location, or a delivery date, and do not say it has shipped. ' +
      'Take the order number, the name it was placed under, and the email, and route it. If it is well past the promised date, treat it as a priority.',
  },
  {
    id: 'ecom.return_policy',
    question: 'about returns, exchanges, or refunds',
    triggers: [/\b(return|exchange|refund|send it back|money back|restocking|policy)\b/i],
    source: 'business_config',
    requires: ['customFaqs'],
    guidance:
      'Do not state a return window, a restocking fee, or who pays return shipping without configuration — these vary and a wrong answer becomes a chargeback. ' +
      'Do not promise a refund. Capture the order number and the reason, and route it.',
  },
  {
    id: 'ecom.damaged_wrong',
    question: 'about a damaged or incorrect item',
    triggers: [/\b(damaged|broken|cracked|wrong|missing|defective|not what i ordered)\b/i],
    source: 'escalate',
    guidance:
      'Apologise once, briefly, and get the facts: order number, what arrived, and what should have. Ask whether they can photograph it, which almost always speeds up resolution. ' +
      'Do not promise a replacement, a refund, or a shipping label — promise that someone will sort it.',
  },
  {
    id: 'ecom.product_question',
    question: 'a question about a product',
    triggers: [/\b(does (it|this)|will (it|this)|what (size|color|colour|material)|in stock|fit|compatible)\b/i],
    source: 'business_config',
    requires: ['services'],
    guidance:
      'Do not invent specifications, sizing, compatibility, or stock levels. Take what they are asking and route it, or point them to the product page. ' +
      'A confidently wrong spec generates a return.',
  },
];

// ---------------------------------------------------------------------
// Depth added after the quality audit flagged these banks as thin.
// ---------------------------------------------------------------------

INSURANCE_KNOWLEDGE.push(
  {
    id: 'ins.cancel_policy',
    question: 'about cancelling, lapsing, or switching away',
    triggers: [/\b(cancel|cancelling|canceling|lapse|lapsed|switch\w*|leave|non.?renew\w*|drop)\b/i, /\bstop (my )?coverage\b/i],
    source: 'escalate',
    guidance:
      'Do not process, confirm, or discourage a cancellation, and never say a policy has been cancelled — a customer who believes they are covered when they are not is the worst outcome in this industry. ' +
      'Take the policy number and get them to a licensed agent. If they mention a lapse or a missed payment, treat it as urgent.',
  },
  {
    id: 'ins.proof_of_insurance',
    question: 'for an ID card, proof of insurance, or documents',
    triggers: [/\b(id card|insurance card|proof of insurance|declaration|dec page|binder|certificate|coi)\b/i, /\bsend me\b[^.]{0,25}\b(card|proof|paperwork)\b/i],
    source: 'escalate',
    guidance:
      'You cannot issue or email documents. Do not say one has been sent. Take the policy number and what they need it for — a lender, a DMV stop, a new landlord — since that sets the urgency, and route it.',
  },
  {
    id: 'ins.add_vehicle_driver',
    question: 'about adding or removing a vehicle, driver, or property',
    triggers: [/\b(add|remove|take off|put)\b[^.]{0,30}\b(car|vehicle|driver|teenager|son|daughter|house|property|policy)\b/i, /\bnew (car|house|driver)\b/i],
    source: 'escalate',
    guidance:
      'Do not tell them a change is effective, and never imply new coverage is in force — a gap here is a genuine financial exposure. ' +
      'Capture what they want changed and when it needs to be effective, then get it to an agent. A vehicle bought today is time-critical.',
  },
);

LOGISTICS_KNOWLEDGE.push(
  {
    id: 'log.what_can_you_haul',
    question: 'whether the carrier handles a particular type of freight',
    triggers: [/\b(hazmat|hazardous|reefer|refrigerat\w+|frozen|oversize|over.?dimensional|flatbed|liquid|livestock|white glove|residential|liftgate)\b/i, /\bdo you (haul|carry|handle|move)\b/i],
    source: 'business_config',
    requires: ['services'],
    guidance:
      'Equipment and authority genuinely limit this — hazmat, reefer and oversize each need specific capability, and claiming one the carrier lacks is a compliance problem, not just a service one. ' +
      'Do not assume. Capture the commodity, weight, dimensions, and any special handling, and route it.',
  },
  {
    id: 'log.detention_accessorial',
    question: 'about detention, layover, or extra charges',
    triggers: [/\b(detention|layover|accessorial|lumper|fuel surcharge|extra charge|waiting|sat there)\b/i, /\bwhy (was i|am i) (charged|billed)\b/i],
    source: 'escalate',
    guidance:
      'Do not quote accessorial rates, explain a charge, or agree it was wrong. Billing disputes need the record in front of someone. ' +
      'Take the PRO number and the invoice number, and route it. Do not become defensive.',
  },
  {
    id: 'log.delivery_appointment',
    question: 'about scheduling or changing a delivery appointment',
    triggers: [/\b(delivery|appointment|window|dock|receiving hours|reschedul\w*)\b/i, /\bwhen (will|can) (it|they) deliver\b/i],
    source: 'escalate',
    guidance:
      'You cannot see dispatch. Do not commit to a delivery window and do not confirm an appointment was moved. ' +
      'Take the PRO number, the receiving hours, and the contact at the consignee, and route it to dispatch.',
  },
);

MANUFACTURING_KNOWLEDGE.push(
  {
    id: 'mfg.minimum_order',
    question: 'about minimum quantities, prototypes, or one-off parts',
    triggers: [/\b(minimum|moq|prototype|one.?off|single|small run|just one|low volume)\b/i, /\bwill you (do|make|quote)\b[^.]{0,25}\b(one|a few|small)\b/i],
    source: 'business_config',
    requires: ['services'],
    guidance:
      'Do not state a minimum order quantity or turn anyone away — a prototype enquiry is frequently the front end of a production programme, and refusing it at the switchboard is expensive. ' +
      'Capture the part, quantity, and whether more is expected to follow, and route it.',
  },
  {
    id: 'mfg.certifications_quality',
    question: 'about quality certifications, inspection, or documentation',
    triggers: [/\b(iso|as9100|ppap|fai|first article|cofc|certificate of conformance|material cert|inspection report|cmm|traceab\w+)\b/i],
    source: 'business_config',
    requires: ['licensing'],
    guidance:
      'Never assert a certification or a documentation capability that was not configured. A promised PPAP or first article that does not materialise loses the programme, and a claimed registration you do not hold is worse. ' +
      'Take what documentation they require and route it to quality.',
  },
  {
    id: 'mfg.tooling_ip',
    question: 'about tooling ownership, NDAs, or protecting their design',
    triggers: [/\b(tooling|mold|mould|die|fixture|nda|confidential|intellectual property|ip|our design|proprietary)\b/i, /\bwho owns\b/i],
    source: 'escalate',
    guidance:
      'Do not comment on tooling ownership or agree to confidentiality terms — those are contractual and not yours to settle. ' +
      'Say the commercial team will put an agreement in place before anything sensitive changes hands, and do not invite them to send designs to a general address.',
  },
);

ENERGY_KNOWLEDGE.push(
  {
    id: 'energy.high_bill',
    question: 'about an unexpectedly high bill',
    triggers: [/\b(bill|billing|charge|rate|meter)\b[^.]{0,35}\b(high|wrong|double|jumped|spike|expensive|error)\b/i, /\bwhy is my bill\b/i, /\bmeter (reading|is wrong)\b/i],
    source: 'escalate',
    guidance:
      'Do not explain the charge, speculate about a faulty meter, or promise an adjustment. Do not become defensive either — most of these callers are genuinely worried about money. ' +
      'Take the account number and the service address and route it to billing.',
  },
  {
    id: 'energy.tree_line_contact',
    question: 'about vegetation touching lines, or work near lines',
    triggers: [/\b(tree|branch|limb|vegetation)\b[^.]{0,35}\b(line|wire|pole|transformer)\b/i, /\b(dig|digging|excavat\w+|811|call before you dig|trench)\b/i, /\bnear (the )?(line|wire|pole)\b/i],
    source: 'escalate',
    guidance:
      'Anything touching a line is a utility job and nobody else\'s — tell them plainly not to trim it themselves and not to let a landscaper near it. ' +
      'For digging, direct them to the 811 locate service before any excavation. Take the address and route it. If a line is down or arcing, that is 911 first.',
  },
  {
    id: 'energy.medical_equipment',
    question: 'about someone on life-sustaining equipment',
    triggers: [/\b(oxygen|dialysis|ventilator|life support|medical equipment|cpap|insulin|refrigerated medication)\b/i, /\bmedical (need|condition|device)\b/i],
    source: 'escalate',
    guidance:
      'This changes the priority of an outage completely and must be escalated immediately, not logged. ' +
      'Take the service address and the contact, and say it is being flagged as a medical priority. If the equipment is failing now and there is no backup, tell them to call 911.',
  },
);

DEFENSE_KNOWLEDGE.push(
  {
    id: 'def.lead_time_capacity',
    question: 'about lead times, capacity, or delivery schedules',
    triggers: [/\b(lead ?time|capacity|schedule|deliver\w*|when can you|backlog|expedite|aog)\b/i],
    source: 'needs_more_info',
    guidance:
      'Do not commit to a lead time or a delivery date. In this sector a missed schedule commitment carries contractual consequences well beyond a disappointed customer. ' +
      'Capture the part, quantity, and required date, and route it to planning. AOG or line-down situations are urgent.',
  },
  {
    id: 'def.pricing_contract',
    question: 'about pricing, contract terms, or a purchase order',
    triggers: [/\b(price|pricing|cost|quote|contract|terms|purchase order|po|far|dfars clause|payment)\b/i],
    source: 'business_config',
    requires: ['pricing'],
    guidance:
      'Do not quote prices or agree to any contract term, flow-down clause, or payment condition. Those are negotiated positions with legal weight. ' +
      'Take the enquiry and the contact and route it to contracts.',
  },
  {
    id: 'def.security_clearance',
    question: 'about facility clearance, personnel clearance, or classified work',
    triggers: [/\b(clearance|cleared|classified|secret|scif|fso|facility clearance|personnel security)\b/i],
    source: 'refuse',
    guidance:
      'Do not confirm or deny clearance status, discuss classified work, or describe facility security arrangements on an unverified inbound call. ' +
      'That is true even when the question sounds routine. Take a name and a company and route it to the facility security officer.',
  },
);
