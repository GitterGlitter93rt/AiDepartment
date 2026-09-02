import type { KnowledgeEntry } from './types.ts';

export const REAL_ESTATE_KNOWLEDGE: KnowledgeEntry[] = [
  {
    id: 're.what_is_it_worth',
    question: 'what their home is worth',
    triggers: [
      /\bwhat (is|would|could)\b[^.]{0,35}\b(worth|sell for|get for it|value)\b/i,
      /\bhow much (is|would) (my|the) (house|home|place|condo)\b/i,
      /\bmarket value\b/i, /\bzillow\b/i, /\bzestimate\b/i,
    ],
    source: 'needs_more_info',
    guidance:
      'Do not give a number, and do not endorse or dispute a Zestimate. You have no MLS access and any figure you produce is invented. ' +
      'Say honestly that a real number needs someone to look at the property and the recent comparable sales, and that this is exactly what the valuation appointment is for. ' +
      'Capture the address, beds and baths, and roughly when they are thinking of selling. The address is the single most valuable thing on this call.',
  },
  {
    id: 're.listing_details',
    question: 'details about a specific listing they saw',
    triggers: [
      /\b(saw|drove by|found|looking at)\b[^.]{0,40}\b(house|listing|property|place|sign)\b/i,
      /\bon (zillow|realtor|redfin|your website|the sign)\b/i,
      /\bthe (house|one) on\b/i,
      /\bhow (much|many)\b[^.]{0,25}\b(bedrooms?|bathrooms?|square feet|asking)\b/i,
      /\bis it still available\b/i,
    ],
    source: 'needs_more_info',
    guidance:
      'You do not have MLS access, so do not confirm a price, a status, square footage, or whether it is still available — and do not say it is under contract either. Inventing listing data is a fast way to lose the caller. ' +
      'Get the address or the sign number, then convert it: offer to have an agent pull the details and set up a showing. ' +
      'A caller who has physically driven past a house is a strong lead — get their name and number before anything else.',
  },
  {
    id: 're.commission',
    question: 'what the commission or fees are',
    triggers: [
      /\b(commission|your (fee|cut|percentage)|what do you charge|how much do you take)\b/i,
      /\b(\d+) ?(%|percent)\b/i,
      /\bclosing costs?\b/i,
    ],
    source: 'business_config',
    requires: ['pricing'],
    guidance:
      'Do not quote a percentage. Commission is negotiable, varies by brokerage and market, and has been the subject of significant change — a number you invent could be flatly wrong. ' +
      'If pricing is configured, answer from it. Otherwise say the agent will go through it fully at the appointment. Note that they asked, because it means fees matter to them.',
  },
  {
    id: 're.preapproval',
    question: 'about financing, pre-approval, or what they can afford',
    triggers: [
      /\b(pre.?approv\w+|pre.?qualif\w+|mortgage|lender|loan|down payment|credit score|afford)\b/i,
      /\bhow much (can|could) i (get|borrow|afford)\b/i,
      /\bfha|va loan|conventional\b/i,
    ],
    source: 'industry_general',
    guidance:
      'Do not quote rates, do not estimate what they qualify for, and do not comment on their credit. ' +
      'Safe and genuinely useful: pre-approval from a lender is normally what makes an offer competitive, and sellers routinely expect it. ' +
      'Ask whether they have spoken to a lender yet — the answer tells the agent how ready this buyer actually is, which is the most important qualifying fact on the call.',
  },
  {
    id: 're.showing_request',
    question: 'to see a property',
    triggers: [
      /\b(see|view|tour|look at|walk through|show me)\b[^.]{0,30}\b(it|the (house|place|property|home)|tomorrow|this weekend|today)\b/i,
      /\bset up a (showing|viewing|tour)\b/i,
      /\bopen house\b/i,
      /\bwhen can i see\b/i,
    ],
    source: 'schedule',
    guidance:
      'This is the conversion moment — treat it as one. Do not promise a specific property will be available, since that is not yours to promise. ' +
      'Get the address or listing, their name and number, when they can go, and whether they are working with another agent already — that last one matters and is easy to forget to ask. ' +
      'Then check availability and offer real times.',
  },
  {
    id: 're.underwater',
    question: 'about owing more than the property is worth',
    triggers: [
      /\b(owe more|underwater|upside down|short sale|behind on (my )?(payments|mortgage)|foreclosure)\b/i,
      /\bcan'?t afford (my|the) (mortgage|payments)\b/i,
    ],
    source: 'escalate',
    guidance:
      'Handle this gently — it is a stressful thing to admit on a cold call. Do not advise on short sales, foreclosure, credit consequences, or whether to stop paying. ' +
      'Say an agent who handles these situations should talk it through with them, capture the address and the situation in one line, and get it to a person quickly. ' +
      'Do not treat it as a routine listing lead.',
  },
  {
    id: 're.inherited',
    question: 'about selling an inherited property',
    triggers: [
      /\binherit\w+/i,
      /\b(my|our) (mother|father|mom|dad|parents?|aunt|uncle|grandmother|grandfather)\b[^.]{0,35}\b(died|passed|left)\b/i,
      /\bestate sale\b/i,
      /\bprobate\b/i,
    ],
    source: 'needs_more_info',
    guidance:
      'Acknowledge the loss briefly and sincerely before anything transactional. Then establish the practical points an agent needs: whether the estate has been through probate, ' +
      'whether the caller has authority to sell, whether there are other heirs, and whether the property is occupied. ' +
      'Do not advise on probate, taxes, or how to split proceeds — if the legal side is unresolved, that is a lawyer\'s question, not yours.',
  },
  {
    id: 're.relocating',
    question: 'about moving to the area',
    triggers: [
      /\b(relocat\w+|moving (to|here)|transferred|new job)\b/i,
      /\bwhat'?s? (it|the area) like\b/i,
      /\bgood (schools|neighborhoods?|areas?)\b/i,
      /\bwhere should i live\b/i,
    ],
    source: 'industry_general',
    guidance:
      'General area character is fine to discuss briefly and it builds rapport. But do NOT rank schools, describe neighbourhoods as good or bad, or characterise who lives where — ' +
      'steering is a genuine fair-housing violation, not merely bad manners, and it applies to an AI answering the phone exactly as it does to an agent. ' +
      'Redirect to what they need from the home: budget, timing, size, commute. Let them name areas rather than naming them yourself.',
  },
  {
    id: 're.investor',
    question: 'about investment or rental property',
    triggers: [
      /\b(investment|rental|income|cash flow|cap rate|roi|flip|portfolio|doors)\b/i,
      /\bbuy (and )?hold\b/i,
      /\bsection 8\b/i,
    ],
    source: 'needs_more_info',
    guidance:
      'Investors qualify differently from homebuyers and know it, so ask like one who has done this before: purchase criteria, cash or financed, how many they already hold, and their target market. ' +
      'Do not estimate rents, cap rates or returns — those are made-up numbers if you produce them. Do not discourage them either; experienced investors are repeat clients.',
  },
  {
    id: 're.dual_agency',
    question: 'whether they need their own agent',
    triggers: [
      /\bdo i need (my own |an )?agent\b/i,
      /\b(listing|seller'?s) agent\b/i,
      /\bcan i (just )?(buy|deal) direct\b/i,
      /\bworking with (another|an)? ?agent\b/i,
    ],
    source: 'industry_general',
    guidance:
      'If they are already under a buyer agreement with another agent, say plainly that the firm would not want to interfere with that, and note it — this is professional courtesy and in many places a rule. ' +
      'Otherwise explain generally that a buyer\'s agent represents the buyer\'s interests, without disparaging anyone. Do not offer legal opinions about their agreement.',
  },
];
