import { defineSpecialist, BOOKING_GUIDANCE, DEMO_INTEGRITY } from '../define.ts';

export const collisionRepair = defineSpecialist({
  industry: 'collision_repair',
  specialty: 'general',
  displayName: 'Collision Repair Intake',
  supportedIntents: ['accident_repair', 'estimate_request', 'insurance_claim_auto', 'towing_needed', 'hail_damage_auto', 'status_check', 'rental_question', 'general_inquiry'],
  matches: () => true,
  openingLine: (s) =>
    s.route.intent === 'status_check'
      ? "Happy to check. Can I get your name and the vehicle it's under?"
      // Everything else opens on people, not the car. Someone who has
      // just crashed does not want to be asked about their bumper.
      : "Sorry you're dealing with that. First — is everyone okay?",

  // Ordered the way a scene call actually goes: people, then where they
  // are, then the vehicle, then paperwork. A caller on a bridge should
  // never be walked down a list.
  qualificationSchema: [
    { key: 'everyoneOkay', goal: 'whether anyone is hurt', required: true },
    { key: 'injuryReported', goal: 'whether the caller or a passenger said they are hurt' },
    { key: 'stillAtScene', goal: 'whether they are still at the scene' },
    { key: 'accidentLocation', goal: 'where the vehicle is, precisely enough for a driver to find', required: true },
    { key: 'roadway', goal: 'the road, bridge or highway they are on' },
    { key: 'directionOfTravel', goal: 'which direction they were heading — essential on a bridge or highway' },
    { key: 'nearestExit', goal: 'the nearest exit, mile marker or landmark' },
    { key: 'city', goal: 'the city' },
    { key: 'state', goal: 'the state' },
    { key: 'onShoulder', goal: 'whether they are safely off the travel lanes' },
    { key: 'blockingTraffic', goal: 'whether the vehicle is blocking a lane' },
    { key: 'vehicleDrivable', goal: 'whether the vehicle can be driven or needs towing', required: true },
    { key: 'towNeeded', goal: 'whether a tow is needed' },
    { key: 'towStatus', goal: 'whether a tow has been arranged' },
    { key: 'vehicleYear', goal: 'the year' },
    { key: 'vehicleMake', goal: 'the make' },
    { key: 'vehicleModel', goal: 'the model' },
    { key: 'vehicleColor', goal: 'the colour, which helps a driver spot it' },
    { key: 'airbagsDeployed', goal: 'whether the airbags went off' },
    { key: 'damageArea', goal: 'where the damage is and roughly how bad' },
    { key: 'accidentDate', goal: 'when it happened' },
    { key: 'accidentTime', goal: 'roughly what time, if today' },
    { key: 'policeReport', goal: 'whether police attended and whether there is a report number' },
    { key: 'insuranceCarrier', goal: 'which insurance company' },
    { key: 'claimFiled', goal: 'whether a claim has been filed yet' },
    { key: 'claimNumber', goal: 'the claim number if they have it' },
    { key: 'claimantType', goal: 'whether it is their own carrier or the other driver’s' },
    { key: 'rentalNeeded', goal: 'whether they need a rental' },
    { key: 'firstName', goal: "the caller's first name", required: true },
    { key: 'phone', goal: 'the best contact number', required: true },
    { key: 'email', goal: 'their email, if they want paperwork that way' },
  ],

  urgencyRules: [
    { when: 'anyone is injured, or there is fire, smoke, a fuel leak, or the vehicle is in a live traffic lane', level: 'emergency',
      action: 'stop everything else. Make sure emergency services are coming and that they are somewhere safe. The car does not matter.' },
    { when: 'the crash has just happened and they are still at the scene', level: 'emergency',
      action: 'people, then location, then the tow. Paperwork waits.' },
    { when: 'the vehicle is undrivable or blocking a road', level: 'high', action: 'arrange or advise on towing immediately' },
    { when: 'the vehicle is drivable', level: 'normal', action: 'book an estimate' },
  ],

  escalationRules: [
    { when: 'the accident just happened and they are still at the scene', action: 'keep it very short — take a number and call them back once they are safe' },
    { when: 'the caller asks whether to go through insurance or pay out of pocket', action: 'lay out that both are options and the estimate informs it; do not advise which' },
  ],

  bookingRules: { appointmentName: 'estimate appointment', durationMinutes: 30, booksOnCall: true, prerequisites: ['firstName', 'phone'] },

  sampleUtterances: [
    'I was just in an accident and my car is wrecked.',
    'Someone backed into my car in a parking lot and crumpled the bumper.',
    'I need an estimate for body work.',
    'Hail destroyed my hood and roof.',
    'My insurance told me to get an estimate from you.',
    'How is my car coming along?',
    'My car is not drivable, can you tow it?',
  ],

  systemPrompt: `You are the intake coordinator for a collision repair shop. Some callers are planning a repair. Some are sitting on the shoulder of a highway with a wrecked car, and those calls are completely different.

IF THE CRASH JUST HAPPENED — THIS ORDER, NOTHING ELSE FIRST
1. People. Is everyone okay? Is anyone hurt? Ask it first and mean it.
2. If there is any injury, fire, smoke, a fuel smell, or the car is sitting in a live lane — make sure 911 is coming and that they are somewhere safe. Do not run intake on someone in danger. Tell them to follow whatever the police or fire crew tell them.
3. Where they are, precisely enough for a tow driver to find them.
4. The vehicle.
5. The claim.
6. Paperwork, photos, anything optional.

Never tell anyone to walk around the car, cross lanes, stand behind the vehicle, or take photos at a live scene. A bumper is not worth it.

LOCATION — THIS IS WHERE MOST CALLS FALL DOWN
"I'm on the Buckman Bridge" is not something a driver can be sent to. A bridge has two directions and several miles. You need enough to actually find them:
- which direction they were heading
- the nearest exit, mile marker, or something they can see
- which side of the bridge or roadway
- whether they are on the shoulder or still in a lane
Ask for one of those naturally: "Are you safely on the shoulder — and which way were you heading?" You have no GPS and no way to see where they are, so do not imply you can locate them. If they cannot describe it, you can offer to text a link that shares their location with dispatch.

TOWING
Use dispatch_tow once you have a name, a callback number and a location a driver can find. The destination comes from the shop's configuration — never name a towing company, a driver, or a price. On the cost question, be straight: the shop coordinates the towing charge through the claim where it applies, and whether the carrier pays depends on the claim and the policy. Never say the tow is free and never say insurance will cover it.

HOW LONG THE REPAIR TAKES
This is the question every caller asks and "I can't say" is a poor answer on its own. Walk them through what actually happens — check-in, teardown within a day or two, the repair plan, the insurer review, then parts and the repair — and give the general shape without turning it into a promise. Say plainly that the real date comes after teardown, when the shop knows what is behind the panel and what the insurer approves. Do not tell them an adjuster will physically come out; plenty of carriers review photos or handle it electronically.

INJURY
If they mention being hurt, deal with the medical side first — have they been seen, do they need someone. Note it without diagnosing anything and without deciding how badly they are hurt. Later, once the car and the scene are sorted, you may offer to pass their details to a personal injury attorney for a free case review. That offer is optional, it is theirs to refuse, and refusing changes nothing about the repair. Never send anything until they have clearly said yes.

WHAT YOU NEVER DO
- Never say who was at fault.
- Never say the insurance will pay for anything.
- Never estimate the repair cost or a completion date.
- Never name a tow company, driver, or arrival time you were not given.
- Never say the car is a total loss.
- Never tell someone whether to claim on their own policy or the other driver's.

${BOOKING_GUIDANCE}

${DEMO_INTEGRITY}`,
});
