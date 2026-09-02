// Turning action policies into the section of the prompt that tells the
// agent what this business can actually do, and in whose words.
//
// Rendered rather than written into prompt prose so a real client's
// policy replaces the demo's without anyone editing a specialist.

import {
  policiesFor, packetById, purposeById, partnerById, type ActionPolicies,
} from './policies.ts';
import type { Industry } from '../core/taxonomy.ts';

export interface PolicyRelevance {
  /**
   * Whether the caller has asked how long a repair will take.
   *
   * The repair timeline is a page of explanation that the block itself
   * says to use "when they ask how long it will take" — so carrying it
   * on every turn of every call pays for an answer to a question
   * nobody asked. Once asked, it stays: withdrawing it mid-call would
   * leave the agent unable to finish explaining what it started.
   */
  repairTimeline?: boolean;
}

export function renderActionPolicies(industry: Industry | null, modes: {
  tow: string; esign: string; uploadLink: string; referral: string;
}, relevance: PolicyRelevance = {}): string | null {
  const p: ActionPolicies = policiesFor(industry);
  const blocks: string[] = [];

  if (p.tow?.available) {
    blocks.push([
      'TOWING',
      `The shop arranges towing ${p.tow.availabilityDescription}. Vehicles go to ${p.tow.destinations.map((d) => d.name).join(' or ')} — you do not choose anywhere else, and you never name a towing company, a driver or a price.`,
      p.tow.billingLanguage,
      `Before dispatching you need a name, a callback number, and a location precise enough for a driver to find. On a bridge or a highway that means the direction of travel as well. Use dispatch_tow — do not describe a truck as sent until it comes back successful.`,
    ].join('\n'));
  }

  if (p.collisionRepair && relevance.repairTimeline) {
    const r = p.collisionRepair;
    blocks.push([
      'HOW THE REPAIR ACTUALLY GOES — use this when they ask how long it will take',
      ...r.steps.map((s, i) => `  ${i + 1}. ${s.title}: ${s.detail}`),
      `Typical shape: teardown within about ${r.teardownMinDays} to ${r.teardownMaxDays} business days of arrival, and many ordinary repairs land somewhere around ${r.repairMinWeeks} to ${r.repairMaxWeeks} weeks once approvals and parts are sorted.`,
      r.unknownsLanguage,
      'Give them the process, not a date. "I cannot say" on its own is a worse answer than explaining what happens and why the date comes after teardown.',
      r.rentalLanguage,
    ].join('\n'));
  }

  if (p.esignPacketIds.length > 0) {
    const packets = p.esignPacketIds.map(packetById).filter(Boolean);
    blocks.push([
      'PAPERWORK YOU CAN SEND',
      ...packets.map((k) => `  ${k!.id} — ${k!.label} (needs: ${k!.requires.join(', ')})`),
      'Use send_esign_packet with one of those ids. You do not write, name or describe the forms — the business wrote them. Never characterise what the paperwork says.',
      `Modes: e-sign is currently ${modes.esign}.`,
    ].join('\n'));
  }

  if (p.upload?.enabled) {
    const purposes = p.upload.allowedPurposes.map(purposeById).filter(Boolean);
    blocks.push([
      'SECURE UPLOADS',
      ...purposes.map((u) => `  ${u!.id} — ${u!.guidance}${u!.safetyPrecondition ? `\n     SAFETY: ${u!.safetyPrecondition}` : ''}`),
      'Use create_upload_link. You cannot supply a web address and must never read one out — the system builds and texts it.',
      'A photo is never worth a risk. If they are in traffic, near live electrics, or in an unsafe building, deal with that first and offer the link later.',
    ].join('\n'));
  }

  if (p.referral?.enabled) {
    const partners = p.referral.allowedPartnerIds.map(partnerById).filter(Boolean);
    blocks.push([
      'OPTIONAL REFERRAL',
      ...partners.map((r) => `  ${r!.id} — ${r!.label}\n     ${r!.offerLanguage}`),
      'Only offer this once the immediate situation is handled. Never turn an accident scene into a pitch.',
      'Their agreement has to be explicit and on this call. Mentioning that they are hurt is NOT agreement. Use create_partner_referral only after a clear yes.',
      'If they say no, drop it entirely and carry on — it changes nothing about the work.',
    ].join('\n'));
  }

  if (blocks.length === 0) return null;

  const mocked = Object.entries(modes).filter(([, m]) => m === 'mock').map(([k]) => k);
  if (mocked.length > 0) {
    blocks.push([
      'DEMONSTRATION MODE',
      `These are not connected to a live provider yet: ${mocked.join(', ')}.`,
      'When a tool result says it was not actually sent, do NOT say you sent it. Say what the system does — "I can text you a secure link" rather than "I\'ve sent you a link". The workflow is real; the delivery is not yet, and claiming otherwise is the one thing that would embarrass us in front of a prospect.',
    ].join('\n'));
  }

  return blocks.join('\n\n');
}
