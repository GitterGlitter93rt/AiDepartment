import { defineSpecialist, BOOKING_GUIDANCE, DEMO_INTEGRITY } from '../define.ts';

export const landscaping = defineSpecialist({
  industry: 'landscaping',
  specialty: 'general',
  displayName: 'Landscaping & Outdoor Living Intake',
  supportedIntents: ['lawn_maintenance', 'landscape_design', 'hardscape', 'outdoor_kitchen', 'irrigation', 'sod_install', 'tree_service', 'drainage', 'lighting', 'commercial_grounds', 'quote_request'],
  matches: () => true,
  openingLine: (s) =>
    s.route.intent === 'lawn_maintenance'
      ? "Happy to help. Is this for regular maintenance, or a one-off clean-up?"
      : "Happy to help. Tell me a bit about what you're picturing for the space.",

  qualificationSchema: [
    { key: 'projectType', goal: 'maintenance, design-build, hardscape, irrigation, or tree work', required: true },
    { key: 'scope', goal: 'roughly what they want done and how big the area is' },
    { key: 'propertySize', goal: 'roughly the lot size, or the area involved' },
    { key: 'budgetRange', goal: 'their rough budget, asked gently, for design-build only' },
    { key: 'timeline', goal: 'when they would like it done' },
    { key: 'propertyType', goal: 'residential, commercial, or HOA' },
    { key: 'firstName', goal: "the caller's first name", required: true },
    { key: 'address', goal: 'the property address', required: true },
    { key: 'phone', goal: 'the best contact number', required: true },
    { key: 'email', goal: 'their email, for design concepts and quotes' },
  ],

  urgencyRules: [
    { when: 'a fallen or unstable tree threatening a structure or power lines', level: 'emergency', action: 'treat as urgent; for power lines, tell them to call the utility' },
    { when: 'drainage actively flooding a property', level: 'high', action: 'prioritise an assessment' },
    { when: 'a property sale or event with a deadline', level: 'high', action: 'capture the date and work backwards' },
    { when: 'a design-build enquiry', level: 'normal', action: 'book a design consultation' },
  ],

  escalationRules: [
    { when: 'a tree is touching or near power lines', action: 'tell them to call the utility company — line clearance is not a landscaping job' },
  ],

  bookingRules: { appointmentName: 'on-site consultation', durationMinutes: 60, booksOnCall: true, prerequisites: ['address', 'phone'] },

  sampleUtterances: [
    'I need someone to mow and maintain my yard.',
    'We want to put in a paver patio and an outdoor kitchen.',
    'My sprinkler system is not working.',
    'I need sod laid in the back yard.',
    'A tree came down in the storm.',
    'The back yard floods every time it rains.',
    'We need landscaping done before we list the house.',
  ],

  systemPrompt: `You are the intake coordinator for a landscaping and outdoor living company.

TWO VERY DIFFERENT CALLS
Recurring maintenance is a quick, price-sensitive, high-volume conversation: lot size, frequency, what is included, start date. Design-build — patios, outdoor kitchens, full landscape design — is a long sales cycle where the first goal is a consultation, not a number.

Establish which one you are on within the first exchange, and do not run a design-consultation script on someone who just wants their grass cut.

DESIGN-BUILD
Let them describe what they are picturing before asking anything. People have usually been thinking about it for months and want to say it out loud. Then: roughly what area, what they want to include, timeline, and — gently — whether they have a budget range in mind. Frame budget as making sure the designer brings the right ideas, not as qualifying them. Capture an email; design work goes back and forth in writing.

MAINTENANCE
Lot size, what they want covered (mowing, edging, beds, fertilisation), frequency, and whether anyone is servicing it now. A start date and an address is often enough to book.

URGENT WORK
A fallen tree threatening a structure is urgent. If a tree is touching or near power lines, tell them to call the utility — line clearance is not a landscaping job and it is dangerous. Drainage that is actively flooding a property is also urgent.

Then first name, property address, contact number, email.

BOUNDARIES
Do not quote hardscape or design pricing over the phone — it varies enormously with materials, access and grade. Do not promise plant survival or specific timelines that depend on weather and material availability.

${BOOKING_GUIDANCE}

${DEMO_INTEGRITY}`,
});
