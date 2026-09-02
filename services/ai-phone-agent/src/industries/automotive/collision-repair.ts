import { speakLaborRates } from '../../business/collision-shop.ts';
import type { Session } from '../../core/types.ts';
import { defineSpecialist, BOOKING_GUIDANCE, DEMO_INTEGRITY } from '../define.ts';

/**
 * What the shop says first.
 *
 * A body shop takes two different calls. One is a crash, and it opens
 * on people. The other is ordinary shop business — rates, custom work,
 * a restoration — and it opens by ANSWERING, because the caller asked
 * a question and "is the car still drivable?" is not an answer to it.
 *
 * The published facts are answered here rather than by the model: they
 * do not vary, so the caller gets them in about a tenth of a second
 * with no model call at all. Anything needing judgement gets a
 * confident yes and the right next question, then the model takes over.
 */
function openingFor(s: Session): string {
  switch (s.route.intent) {
    case 'status_check':
      return "Happy to check. Can I get your name and the vehicle it's under?";

    // They already told you it needs a truck. Asking "is it drivable?"
    // is asking them to repeat themselves, and the answer changes
    // nothing — the next useful thing is where the vehicle is.
    case 'towing_needed':
      return 'Of course — we can get a truck out to you. Whereabouts is the vehicle?';

    // Published, so simply said. No intake first.
    case 'labor_rate_question':
      return `${speakLaborRates()} Is there something specific you're looking to have done?`;

    case 'insurance_repair':
      return 'Yes, we work with insurance companies, and we can work directly with them on the estimate and the repair. What happened to the vehicle?';

    case 'custom_work':
      return 'Yes, we do custom work. What are you looking to have done?';

    case 'restoration':
      return 'Yes, we do full restoration work. Tell me about the car — what is it?';

    case 'paint_color_match':
      return "Yes — we're one of the strongest paint and color-matching shops in the area, and in most cases we can match the existing finish extremely closely. What's the vehicle?";

    // A price question. Never answerable on the phone, so it goes
    // straight to what CAN answer it rather than stalling.
    case 'general_estimate':
      return "That depends on where the damage is and how far it goes, so I wouldn't want to guess at a number. What's the vehicle, and what are we looking at?";

    case 'service_question':
      return 'Happy to help — what are you looking to get done?';

    default:
      // A fresh crash opens on people. Everything else opens on the
      // thing they actually rang about, which is the car.
      // No safety questionnaire, whatever the urgency. Someone ringing
      // a body shop about a crash wants the car dealt with; being
      // asked whether everyone is okay by an intake line is not
      // reassuring, it is a delay.
      return s.route.urgency === 'emergency'
        ? "Sorry you're dealing with that — let's get the car sorted. Whereabouts is it?"
        : 'Absolutely, we can help you get that sorted. Is the car still drivable?';
  }
}

/**
 * Fields worth pursuing, given why they rang.
 *
 * The schema is written for a crash — people, scene, location, tow —
 * and it is the right list for exactly one kind of call. Handing it to
 * a caller asking about a repaint is how an agent ends up asking a man
 * with a 1955 Mustang whether anyone is hurt.
 *
 * Named field goals rather than keys so this stays readable against
 * the schema above; anything not listed is still tracked, just not put
 * in front of the model.
 */
const SHOP_BUSINESS_GOALS = [
  'the year',
  'the make',
  'the model',
  'what they want done, in their own words',
  'their name',
  'a good number to reach them on',
  'an email for the advisor to send to',
];

/** The intents that are ordinary shop business, not a crash. */
const SHOP_BUSINESS_INTENTS = new Set([
  'labor_rate_question', 'custom_work', 'restoration', 'paint_color_match',
  'general_estimate', 'service_question', 'insurance_repair', 'mechanical_repair',
]);

/**
 * The scene fields, which are captured if volunteered and never led on.
 *
 * They sat at the top of the schema, so the model was shown "whether
 * anyone is hurt" as the first outstanding item on every crash call
 * and duly asked it. A collision centre does not triage.
 */
const SAFETY_GOALS = [
  'whether anyone is hurt',
  'whether the caller or a passenger said they are hurt',
  'whether they are still at the scene',
  'whether they are safely off the travel lanes',
  'whether the vehicle is blocking a lane',
];

function goalsForIntent(s: Session): string[] {
  const all = collisionRepair.qualificationSchema
    .map((f) => f.goal)
    // Still tracked, simply never put in front of the model as the
    // next thing to ask.
    .filter((g) => !SAFETY_GOALS.includes(g));
  if (!SHOP_BUSINESS_INTENTS.has(s.route.intent ?? '')) return all;
  // Shop business first, then the rest — still available if the call
  // turns out to involve damage after all.
  const rest = all.filter((g) => !SHOP_BUSINESS_GOALS.includes(g));
  return [...SHOP_BUSINESS_GOALS, ...rest];
}

export const collisionRepair = defineSpecialist({
  industry: 'collision_repair',
  specialty: 'general',
  displayName: 'Collision Repair Intake',
  supportedIntents: [
    // Accident work.
    'accident_repair', 'estimate_request', 'insurance_claim_auto', 'towing_needed', 'hail_damage_auto', 'status_check',
    // Ordinary shop business. A body shop is not only a crash line.
    'labor_rate_question', 'insurance_repair', 'custom_work', 'restoration',
    'paint_color_match', 'general_estimate', 'mechanical_repair', 'service_question',
    'rental_question', 'general_inquiry',
  ],
  matches: () => true,
  openingLine: (s) => openingFor(s),
  qualificationGoalsFor: (s: Session) => goalsForIntent(s),

  // Ordered the way a scene call actually goes: people, then where they
  // are, then the vehicle, then paperwork. A caller on a bridge should
  // never be walked down a list.
  qualificationSchema: [
    { key: 'everyoneOkay', goal: 'whether anyone is hurt' },
    { key: 'injuryReported', goal: 'whether the caller or a passenger said they are hurt' },
    { key: 'stillAtScene', goal: 'whether they are still at the scene' },
    { key: 'accidentLocation', goal: 'where the vehicle is, precisely enough for a driver to find', required: true },
    { key: 'roadway', goal: 'the road, bridge or highway they are on' },
    { key: 'directionOfTravel', goal: 'which direction they were heading — essential on a bridge or highway' },
    { key: 'nearestExit', goal: 'the nearest exit, mile marker or landmark' },
    { key: 'mileMarker', goal: 'a mile marker, if there is one visible' },
    { key: 'landmark', goal: 'anything they can see that a driver would recognise' },
    { key: 'bridgeSegment', goal: 'which part of the bridge or span, if relevant' },
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
    { key: 'policeResponded', goal: 'whether police attended' },
    { key: 'policeAgency', goal: 'which agency, if they know' },
    { key: 'policeReportNumber', goal: 'the report number, if they have it yet' },
    { key: 'licensePlate', goal: 'their own plate, if volunteered' },
    // Their own policy.
    { key: 'insuranceCarrier', goal: 'which insurance company is handling their side' },
    { key: 'policyNumber', goal: 'their policy number, if they have the card to hand' },
    { key: 'claimFiled', goal: 'whether a claim has been opened yet' },
    { key: 'claimNumber', goal: 'the claim number, if one exists' },
    { key: 'claimNumberStatus', goal: 'known, pending, not_filed or unknown — never guess a number' },
    { key: 'policyholderName', goal: 'the policyholder, if it is not the caller' },

    // What the caller SAYS about responsibility. Never a conclusion.
    { key: 'faultPosition', goal: "the caller's own account: caller_reports_self, caller_reports_other_party, disputed, unclear or unknown" },
    { key: 'citationIssued', goal: 'whether the officer issued a citation, if they mentioned it' },
    { key: 'citedParty', goal: 'who was cited, as the caller reported it' },
    { key: 'repairPaymentPath', goal: 'first_party, third_party, self_pay or undetermined' },

    // The other driver, when there is one.
    { key: 'otherPartyFirstName', goal: "the other driver's first name" },
    { key: 'otherPartyLastName', goal: "the other driver's surname" },
    { key: 'otherPartyPhone', goal: "the other driver's phone number" },
    { key: 'otherPartyVehicleYear', goal: "the other vehicle's year" },
    { key: 'otherPartyVehicleMake', goal: "the other vehicle's make" },
    { key: 'otherPartyVehicleModel', goal: "the other vehicle's model" },
    { key: 'otherPartyVehicleColor', goal: "the other vehicle's colour" },
    { key: 'otherPartyLicensePlate', goal: "the other vehicle's plate" },

    // Their insurance, kept strictly apart from the caller's own.
    { key: 'otherPartyInsuranceCarrier', goal: "the other driver's insurance company" },
    { key: 'otherPartyPolicyNumber', goal: "the other driver's policy number — NOT a claim number" },
    { key: 'otherPartyClaimFiled', goal: 'whether their carrier has opened a claim' },
    { key: 'otherPartyClaimNumber', goal: 'the claim number their carrier gave, if any' },
    { key: 'otherPartyClaimNumberStatus', goal: 'known, pending, not_filed or unknown' },

    { key: 'repairIntentConfirmed', goal: 'whether they have actually agreed the vehicle comes to this shop' },
    { key: 'rentalNeeded', goal: 'whether they need a rental' },
    { key: 'firstName', goal: "the caller's first name", required: true },
    { key: 'phone', goal: 'the best contact number', required: true },
    { key: 'email', goal: 'their email, if they want paperwork that way' },
  ],

  urgencyRules: [
    // Urgency changes the ORDER and the pace. It never changes what
    // the business needs: a stranded caller still has to have a way of
    // paying for the truck, and "we'll sort that out later" is how an
    // unfunded tow gets sent.
    { when: 'the caller says the vehicle is on fire, they are in a live lane, they smell fuel, or someone is unconscious', level: 'emergency',
      action: 'one short line — get clear of the vehicle and call 911 — then carry on with the tow. Do not ask further safety questions and do not skip the payment path.' },
    { when: 'the vehicle is undrivable, blocking a road, or the caller says they are stranded', level: 'high',
      action: 'move straight to the tow: location, vehicle, how it has to be lifted, who is paying. Be quick, not shorter on the essentials.' },
    { when: 'the vehicle is drivable', level: 'normal', action: 'book an estimate' },
  ],

  escalationRules: [
    { when: 'the caller reports an immediate danger to themselves', action: 'one line telling them to get clear and call 911, then continue with the vehicle. Never end the call or defer the intake because of it' },
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

DO NOT RUN SAFETY TRIAGE
You are a collision centre's intake coordinator, not an emergency dispatcher. Someone who has taken the trouble to ring a body shop and is talking to you calmly does not need to be asked whether they are safe — they need their car dealt with.
Never open with, or volunteer, any of these: "are you somewhere safe", "is everyone okay", "is anyone hurt", "are you out of traffic", "do you need medical attention". "I've been in an accident", "I need a tow" and "I'm stranded" are business signals, not distress signals.

THE ONE EXCEPTION — AND IT IS NARROW
Only if the CALLER THEMSELVES describes an unmistakable immediate danger — the car is on fire, they are standing in a live lane, they smell fuel, somebody is unconscious — say ONE short thing and nothing more: "If you can do that safely, get away from the vehicle and call 911." Then carry straight on with the vehicle and the tow. Do not ask follow-up safety questions, do not run a safety workflow, and do not use it as a reason to skip anything the business needs.
If they mention an injury themselves, note it, say you are sorry, and keep going. You do not assess it and you never send anyone away.

WHAT THE CALL IS ACTUALLY FOR
Where the vehicle is, what it is, how it has to be moved, who is paying, and getting the paperwork out. In roughly that order, skipping whatever they have already told you.

Never tell anyone to walk around the car, cross lanes, stand behind the vehicle, or take photos at a live scene. A bumper is not worth it.

LOCATION — THIS IS WHERE MOST CALLS FALL DOWN
"I'm on the Buckman Bridge" is not something a driver can be sent to. A bridge has two directions and several miles. You need enough to actually find them:
- which direction they were heading
- the nearest exit, mile marker, or something they can see
- which side of the bridge or roadway
- whether they are on the shoulder or still in a lane
Ask for one of those naturally: "Which way were you heading, and what's the nearest exit?" You have no GPS and no way to see where they are, so do not imply you can locate them. If they cannot describe it, you can offer to text a link that shares their location with dispatch.

TOWING
Use dispatch_tow once you have a name, a callback number and a location a driver can find. The destination comes from the shop's configuration — never name a towing company, a driver, or a price. On the cost question, be straight: the shop coordinates the towing charge through the claim where it applies, and whether the carrier pays depends on the claim and the policy. Never say the tow is free and never say insurance will cover it.

THEY RANG TO GET THE CAR FIXED
That is the goal, and every turn should move toward it: is it drivable, what is it, where is it, whose claim, and then either a truck or a time to bring it in. Finish it on this call.
Do not send them to a website. Do not tell them to ring back. Do not raise medical care unless they say they are hurt — someone whose bumper is crumpled did not call for health advice.
If a link genuinely helps, offer it ONCE: "I can text that to you as well, but we can sort it all out right here." If it has already been offered or sent, do not mention it again. Repeating it is the fastest way to sound like a machine.

LOCATION — THE SECURE LINK
If they cannot tell you an exit, a mile marker or a landmark, stop asking and offer the link instead: "I can text you a secure link — you can share your current location, or drop a pin right where the car is." Use create_location_link. Once a location comes back, you have it and you stop asking; "I've got the vehicle location" is all they need to hear. Never read a link, a token or coordinates out loud, and never imply you can see where they are without it.

INSURANCE — TWO SEPARATE SETS OF DETAILS
Their insurance and the other driver's insurance are different records and must never be mixed. If they say their own carrier is State Farm and the other driver is with GEICO, those are two carriers, two policy numbers and potentially two claim numbers.
A POLICY NUMBER is not a CLAIM NUMBER. The policy number is on the card. The claim number only exists once a claim has been opened, and after a crash on a bridge it usually has not been. If there is no claim number, say so plainly — "no problem, we can get everything started and add the claim number once it's open" — and carry on. Never invent one, and never let a missing one hold up a tow, the intake, or the paperwork.

WHO WAS RESPONSIBLE — RECORD IT, DO NOT DECIDE IT
You need to know which claim this is likely going through, so ask naturally: "Are you expecting this to go through your insurance or the other driver's?" If they mention the officer, "did the officer say who they thought caused it?" is fine too.
Record what the CALLER SAYS. Nothing more. "The caller says the other driver rear-ended them" is a fact about the call. "The other driver is at fault" is a legal conclusion you are not qualified to reach and have no business stating. A citation is not a liability determination either — plenty of cited drivers are later found not liable, and plenty of uncited ones are.
Never say who is at fault, never agree that someone "definitely" is, never tell them whose insurance should pay, and never say a carrier has to accept anything.

HOW LONG THE REPAIR TAKESHOW LONG THE REPAIR TAKES
This is the question every caller asks and "I can't say" is a poor answer on its own. Walk them through what actually happens — check-in, teardown within a day or two, the repair plan, the insurer review, then parts and the repair — and give the general shape without turning it into a promise. Say plainly that the real date comes after teardown, when the shop knows what is behind the panel and what the insurer approves. Do not tell them an adjuster will physically come out; plenty of carriers review photos or handle it electronically.

INJURY — ONLY IF THEY RAISE IT
Never ask. If they volunteer that they are hurt, say you are sorry to hear it, note it, and carry on with the vehicle. You do not ask whether they have been seen, you do not assess how bad it is, and you never suggest they call back. Later, once the car and the scene are sorted, you may offer to pass their details to a personal injury attorney for a free case review. That offer is optional, it is theirs to refuse, and refusing changes nothing about the repair. Never send anything until they have clearly said yes.

PAPERWORK
Once they have agreed the car is coming to the shop — and not before — you can offer the authorisation packet. It contains the repair and teardown authorisation, and a Direction to Pay. Describe those at a high level only: the authorisation lets the shop take it apart far enough to see the real damage, and the Direction to Pay lets eligible claim payments go straight to the shop rather than leaving them to pass the money along. That is all you say about it. Do not say insurance has to pay the shop, that it guarantees anything, or that it signs their claim over — the document decides that, not you.
Ask before sending: "Would you like me to send that over?" An email address is not a yes. Once they agree, use send_esign_packet with consentConfirmed.
No claim number is needed for this. Somebody standing on a bridge has not opened a claim yet.

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
