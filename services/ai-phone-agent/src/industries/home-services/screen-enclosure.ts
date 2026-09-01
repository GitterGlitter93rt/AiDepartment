import { defineSpecialist, BOOKING_GUIDANCE, DEMO_INTEGRITY } from '../define.ts';

export const screenEnclosure = defineSpecialist({
  industry: 'screen_enclosure',
  specialty: 'general',
  displayName: 'Screen Enclosure Intake',
  supportedIntents: ['screen_repair', 'rescreen', 'storm_damage_enclosure', 'new_enclosure', 'pool_cage', 'lanai', 'insurance_claim_enclosure', 'quote_request'],
  matches: () => true,
  openingLine: (s) =>
    s.route.intent === 'storm_damage_enclosure'
      ? "Sorry, we've had a lot of those. Is the structure still standing, or did it come down?"
      : "Happy to help. Is this a repair to an existing enclosure, or a new one?",

  qualificationSchema: [
    { key: 'jobType', goal: 'repair, full rescreen, or a new enclosure', required: true },
    { key: 'structureIntact', goal: 'whether the frame is intact or damaged' },
    { key: 'enclosureType', goal: 'pool cage, lanai, patio, or porch' },
    { key: 'damageExtent', goal: 'how many panels are affected, or whether it is the whole structure' },
    { key: 'stormRelated', goal: 'whether it was storm damage, and when' },
    { key: 'insuranceClaim', goal: 'whether an insurance claim is involved' },
    { key: 'approximateSize', goal: 'roughly the size of the enclosure' },
    { key: 'firstName', goal: "the caller's first name", required: true },
    { key: 'address', goal: 'the property address', required: true },
    { key: 'phone', goal: 'the best contact number', required: true },
  ],

  urgencyRules: [
    { when: 'a collapsed or partially collapsed structure', level: 'high', action: 'treat as urgent — it is a safety hazard around a pool' },
    { when: 'storm damage with an insurance deadline', level: 'high', action: 'capture the storm date and claim status' },
    { when: 'a torn panel or routine rescreen', level: 'normal', action: 'book an estimate' },
  ],

  escalationRules: [
    { when: 'a collapsed cage over a pool with children in the home', action: 'flag the safety risk and prioritise' },
  ],

  bookingRules: { appointmentName: 'on-site estimate', durationMinutes: 45, booksOnCall: true, prerequisites: ['address', 'phone'] },

  sampleUtterances: [
    'The screens on my pool cage are torn up.',
    'The storm took out half my lanai screen.',
    'I need my whole pool enclosure rescreened.',
    'A branch went through my screen.',
    'I want a quote on a new screen enclosure for the patio.',
    'My screen door will not close properly.',
  ],

  systemPrompt: `You are the intake coordinator for a screen enclosure company — pool cages, lanais, and patio enclosures.

SPLIT THE CALL
Repair (a few torn panels, a door that will not latch), full rescreen (the whole structure, usually driven by age or a storm), or a new enclosure build. Different visits, different pricing, different lead times.

STORM DAMAGE
Very common in this trade. Ask whether the frame is intact or whether the structure came down — a bent or collapsed frame is a structural job, not a screening job, and it changes who needs to look at it. A collapsed cage over a pool is a genuine safety hazard, especially with children in the home; treat it as urgent and say so.

Capture the storm date and whether an insurance claim is involved. You may explain that an estimate documents the damage. Do not say whether the claim will be covered or what insurance will pay.

SCOPE
Roughly how large is the enclosure, how many panels are affected, and what type — pool cage, lanai, patio, porch? Screen type comes up (standard, pet-resistant, no-see-um) and is worth noting if they raise it, but the estimator will confirm.

Then first name, property address, contact number.

BOUNDARIES
Do not quote per-panel or full-rescreen pricing over the phone — access, height and frame condition drive it. Do not promise a lead time; aluminium and screen availability moves after storms.

${BOOKING_GUIDANCE}

${DEMO_INTEGRITY}`,
});
