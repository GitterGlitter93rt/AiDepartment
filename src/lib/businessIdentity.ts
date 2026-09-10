// The single place the site states who it legally is.
//
// ---------------------------------------------------------------------
// WHY THIS FILE EXISTS
// ---------------------------------------------------------------------
//
// Twilio rejected the A2P 10DLC campaign with error 30907: the website
// brand did not match the registered sender. The site said "Your AI
// Department LLC" in its Privacy Policy and Terms while the Twilio Brand
// was registered to Catastrophic Solutions LLC, so a reviewer comparing
// the two saw two different companies.
//
// Fixing that once is easy. Keeping it fixed is the hard part, because
// the legal entity is expected to change again shortly (see CUTOVER
// below), and a legal name pasted into thirty templates is a name that
// will be half-changed next time. Every rendered statement of legal
// identity now reads from here.
//
// ---------------------------------------------------------------------
// WHAT IS TRUE TODAY
// ---------------------------------------------------------------------
//
//   Customer-facing brand   Your AI Department
//   Legal operating entity  Catastrophic Solutions LLC
//   Twilio registered Brand Catastrophic Solutions LLC
//
// The brand is NOT described as a DBA anywhere. A DBA / fictitious-name
// registration is a specific legal filing, and no evidence of one exists
// in this repository. "A business brand operated by" states the
// relationship without asserting a registration nobody has confirmed.
//
// ---------------------------------------------------------------------
// CUTOVER — DO NOT PRE-EMPT IT HERE
// ---------------------------------------------------------------------
//
// The entity is expected to become "Your AI Department LLC" within
// days. That name MUST NOT appear in rendered output as the active
// operator until the Twilio Brand registration actually changes —
// publishing it early recreates exactly the mismatch that caused the
// rejection, in the opposite direction.
//
// So there is deliberately no `futureLegalEntity` field here. A future
// value sitting in the active config is a value someone renders by
// accident. The cutover is a documented procedure, not a flag:
// see docs/legal-entity-cutover.md.
//
// tests/twilioA2pCompliance.test.ts asserts that the built site never
// names the future entity as the active operator.

/** The consumer-facing brand. This does not change at cutover. */
export const BRAND_NAME = 'Your AI Department';

/** The legal entity that operates the brand and is registered with
 * Twilio as the A2P Brand. Changes at cutover. */
export const LEGAL_ENTITY = 'Catastrophic Solutions LLC';

/**
 * The one sentence that establishes the relationship, used verbatim in
 * the footer, the Privacy Policy, the Terms, and the SMS consent page.
 *
 * Consistency is the point: a Twilio reviewer reading four pages should
 * see the same sentence, not four paraphrases that raise the question of
 * whether these are the same company.
 */
export const LEGAL_RELATIONSHIP =
  `${BRAND_NAME} is a business brand operated by ${LEGAL_ENTITY}.`;

/** How the sender identifies itself in an SMS body and in the Twilio
 * campaign's sample messages. */
export const SMS_SENDER_DISPLAY_NAME = `${BRAND_NAME} (${LEGAL_ENTITY})`;

/** A2P use case. CUSTOMER_CARE constrains what may be sent: no
 * promotions, no cold prospecting, no newsletters. */
export const SMS_USE_CASE = 'CUSTOMER_CARE';

export const SMS_PROGRAM_NAME = `${BRAND_NAME} customer-care SMS program`;

/**
 * Version stamped onto every consent record.
 *
 * The point of versioning consent is evidentiary: months later we need
 * to be able to say exactly which disclosure a given person agreed to.
 * Bump it whenever the disclosure wording OR the legal sender changes —
 * the cutover to a new entity changes who the person consented to
 * receive messages from, which is a material change to what they
 * accepted, not a cosmetic one.
 *
 * Format: sms_<use case>_v<n>_<yyyy>_<mm>
 *
 * NOT bumped for the 30923 fix (2026-09-10). That change made declining
 * a valid outcome of the form and split the required Terms agreement
 * out into its own control — but SMS_CONSENT_DISCLOSURE_LEAD below, the
 * text a consenting person actually agreed to, is byte-identical. A
 * bump would assert that existing opt-ins agreed to different wording
 * than they did, which is the precise thing this field exists to make
 * verifiable. Mechanics changing is not the disclosure changing.
 */
export const SMS_CONSENT_VERSION = 'sms_customer_care_v1_2026_09';

/** Postal address and contact email, as already published on the
 * Privacy, Terms and Contact pages. Not invented here — centralised so
 * the four legal pages cannot drift apart. */
export const BUSINESS_ADDRESS_LINES = [
  '2220 County Road 210 W, STE 108-504',
  'Jacksonville, Florida 32259',
] as const;

export const SUPPORT_EMAIL = 'michael@youraidepartment.ai';

export const WEBSITE_DOMAIN = 'https://youraidepartment.ai';

/** Routes a compliance reviewer must be able to reach. Kept here so the
 * Twilio submission document, the site footer and the consent
 * disclosure all point at the same paths. */
export const LEGAL_ROUTES = {
  privacy: '/privacy/',
  terms: '/terms/',
  smsConsent: '/sms-consent/',
  /** Stable in-page anchors the Twilio reviewer is pointed at directly. */
  smsPrivacyAnchor: '/privacy/#sms-privacy',
  smsTermsAnchor: '/terms/#sms-terms',
} as const;

/**
 * The exact disclosure shown beside the SMS opt-in checkbox.
 *
 * Rendered on /sms-consent/ and reproduced verbatim in
 * docs/twilio-a2p-resubmission.md. A reviewer comparing the submitted
 * text against the live page must find them identical, so this is
 * generated from one string rather than typed twice — and a test
 * asserts the document still matches the code.
 *
 * The link markup is deliberately NOT part of this constant: the page
 * renders Privacy and Terms as real anchors, while the Twilio field is
 * plain text. `SMS_CONSENT_DISCLOSURE_PLAIN` is the plain-text form.
 */
export const SMS_CONSENT_DISCLOSURE_LEAD =
  `I agree to receive customer-care text messages from ${BRAND_NAME}, operated by ${LEGAL_ENTITY}, at the mobile number provided. ` +
  'Messages may include requested follow-up, appointment coordination or reminders, and support. ' +
  'Message frequency varies. Msg & data rates may apply. Reply STOP to opt out or HELP for help. ' +
  'Consent is not a condition of purchase. See our ';

export const SMS_CONSENT_DISCLOSURE_PLAIN =
  `${SMS_CONSENT_DISCLOSURE_LEAD}Privacy Policy and Terms of Use.`;

/**
 * The line shown beside every OTHER phone field on the site.
 *
 * Twilio error 30896 was about the opt-in flow not demonstrating
 * consent. Part of demonstrating it honestly is being explicit about
 * where consent is NOT being collected: the contact form and both
 * assessments take a phone number for a callback, and that is all they
 * take it for.
 */
export const PHONE_FIELD_SMS_NOTICE =
  'A phone number alone does not opt you in to text messages.';
