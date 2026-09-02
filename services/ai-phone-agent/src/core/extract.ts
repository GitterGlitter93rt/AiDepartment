// Deterministic extraction of details a caller volunteers.
//
// Callers do not answer questions one at a time. Asked whether there
// are children involved, they say "yeah two, seven and eleven, and she
// took them to her mother's in Jacksonville last week" — four facts,
// one of which was the answer.
//
// Two mechanisms capture that. The model can call `capture_details`
// when it notices something worth keeping, which costs no extra round
// trip because the tool exchange already exists. And this module runs
// on every caller turn with no model at all, catching the shapes a
// regex genuinely nails: phone numbers, email addresses, ZIP codes.
//
// The deterministic half exists because the model half is not
// reliable enough on its own. A caller who gives a phone number and
// then hangs up before booking must not leave an empty record — that
// is a lost lead, and the number was said out loud.
//
// The bar for capturing here is deliberately high. A wrong phone
// number is worse than no phone number: somebody calls it back, gets a
// stranger, and the real lead never hears from anyone.

import type { ContactRecord } from './types.ts';

export interface Extracted {
  contact: Partial<ContactRecord>;
  /** Which fields were found, for logging. */
  fields: string[];
}

// Spoken numbers arrive from speech-to-text in wildly varying shapes:
// "904-555-0142", "904 555 0142", "(904) 555-0142", "9045550142".
const PHONE = /(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})(?!\d)/;
const EMAIL = /\b([A-Za-z0-9._%+-]+)\s*(?:@|\bat\b)\s*([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/;
const ZIP = /\b(\d{5})(?:-\d{4})?\b/;

/** Words that mean digits nearby are NOT a phone number. */
const ADDRESS_CONTEXT = /\b(street|st\b|road|rd\b|avenue|ave\b|lane|ln\b|drive|dr\b|court|ct\b|boulevard|blvd|way|circle|place|apartment|apt|suite|unit|#)\b/i;

/** Words that mean digits nearby are a year, a price, or a count. */
const NON_PHONE_CONTEXT = /\b(year|years|dollars?|\$|square feet|sq ?ft|miles?|degrees|bedrooms?|units?|pallets?|parts?)\b/i;

/**
 * A correction overrides whatever was captured before.
 *
 * "Actually, use my other number" is the caller fixing our record, and
 * the fix has to win silently — asking them to confirm which of two
 * numbers they meant, after they just told us, is the kind of thing
 * that makes people hang up.
 */
const CORRECTION = /\b(actually|sorry|no wait|i mean|scratch that|use my|instead|correction|let me correct|that'?s wrong|not that one)\b/i;

export function isCorrection(utterance: string): boolean {
  return CORRECTION.test(utterance);
}

/**
 * Pulls high-confidence details out of one caller turn.
 *
 * Returns only what it is sure about. Names and addresses are
 * deliberately NOT extracted here: "I'm at the end of my rope" is not
 * an address, and "I'm calling about my mother" is not a name. Those
 * are left to the model, which has the context to tell the difference.
 */
export function extractFromUtterance(utterance: string): Extracted {
  const contact: Partial<ContactRecord> = {};
  const fields: string[] = [];
  const text = utterance.trim();

  // --- email ---
  const email = text.match(EMAIL);
  if (email) {
    // Speech-to-text renders "at" for "@" often enough to be worth
    // handling, and "dot" for "." occasionally.
    const normalised = `${email[1]}@${email[2]}`.toLowerCase().replace(/\s+/g, '');
    if (normalised.length <= 254) {
      contact.email = normalised;
      fields.push('email');
    }
  }

  // --- phone ---
  // Skip when the sentence is plainly about an address or a quantity;
  // "123 Main Street" and "we need 5,000 units" both contain digit runs
  // that a loose pattern would happily read as a phone number.
  const phone = text.match(PHONE);
  if (phone) {
    const around = contextAround(text, phone.index ?? 0, 40);
    const looksLikeAddress = ADDRESS_CONTEXT.test(around) && !/\b(call|phone|number|reach|text|cell|mobile)\b/i.test(around);
    if (!looksLikeAddress && !NON_PHONE_CONTEXT.test(around)) {
      contact.phone = `+1${phone[1]}${phone[2]}${phone[3]}`;
      fields.push('phone');
    }
  }

  // --- ZIP ---
  // Only when something in the sentence is actually about location. A
  // bare five-digit number is far more often a year, a price, or a
  // part number.
  if (/\b(zip|postcode|postal|address|live|located|city|county|area)\b/i.test(text)) {
    const zip = text.match(ZIP);
    // A five-digit run that is part of a longer phone number is not a ZIP.
    if (zip && !(contact.phone && text.replace(/\D/g, '').includes(zip[1]) && (text.match(/\d/g) ?? []).length >= 10)) {
      contact.zip = zip[1];
      fields.push('zip');
    }
  }

  return { contact, fields };
}

function contextAround(text: string, index: number, radius: number): string {
  return text.slice(Math.max(0, index - radius), index + radius);
}

/**
 * Merges extracted details into a session's contact record.
 *
 * A later value always replaces an earlier one. That is the rule
 * callers expect: the last number they said is the one they want used,
 * and a system that keeps the first one is broken in a way nobody will
 * report — they will just never get the call back.
 */
export function mergeContact(
  existing: ContactRecord,
  found: Partial<ContactRecord>,
): { merged: ContactRecord; changed: string[]; corrected: string[] } {
  const changed: string[] = [];
  const corrected: string[] = [];

  for (const [key, value] of Object.entries(found) as [keyof ContactRecord, string][]) {
    if (!value) continue;
    const before = existing[key];
    if (before === value) continue;
    if (before) corrected.push(key);
    else changed.push(key);
    existing[key] = value;
  }

  return { merged: existing, changed, corrected };
}
