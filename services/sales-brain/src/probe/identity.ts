import { randomBytes } from 'node:crypto';
import { normalizeEmail } from '../domain/normalize.js';

/**
 * How an email reply finds its probe, without buying a mailbox per probe.
 * Authority: outbound-sales-brain-speed-to-lead-probe-spec.md §10.
 *
 * The precedent is already in the product: `src/email/inbound.ts` carries
 * `enrollmentId` -- "the correlation id we supplied on export. Preferred over the
 * address." This is the same idea keyed to a probe, and it produces the strongest
 * attribution signal in the subsystem, because only one company was ever given a
 * given address.
 *
 * The token is random rather than derived from `probe_id`, and rather than
 * sequential. It is handed to a third party, and a sequential token tells that third
 * party how many audits we run and in what order. That is not information a probe
 * should leak about the programme.
 */

/** 16 hex characters. Collision-safe for this volume and short enough for a form field. */
const TOKEN_BYTES = 8;

export function newProbeToken(): string {
  return randomBytes(TOKEN_BYTES).toString('hex');
}

export type AliasStyle =
  /** `probe+<token>@domain`. Free, exact, and rejected by some form validators. */
  | 'SUB_ADDRESSING'
  /** `<token>@probes.domain`. Needs a catch-all, survives validators that reject `+`. */
  | 'CATCH_ALL_SUBDOMAIN';

export interface AliasPlan {
  style: AliasStyle;
  address: string;
  token: string;
}

/**
 * Build the address a probe submits.
 *
 * Sub-addressing is preferred where it survives, because it needs no DNS. It does
 * not always survive: rejecting `+` in an email field is a common validator bug, and
 * a probe that cannot submit its own address measures nothing. The fallback is a
 * catch-all on a dedicated subdomain, which is also why that subdomain must carry
 * its own SPF/DKIM/DMARC -- a probe must not be able to affect sales deliverability.
 */
export function planAlias(input: {
  token: string; aliasDomain: string; plusAddressingAllowed: boolean;
}): AliasPlan {
  const domain = input.aliasDomain.trim().toLowerCase().replace(/^@+/, '');
  if (input.plusAddressingAllowed) {
    // The mailbox part is fixed so one inbox receives every probe reply.
    const base = domain.startsWith('probes.') ? domain.slice('probes.'.length) : domain;
    return {
      style: 'SUB_ADDRESSING', token: input.token,
      address: `probe+${input.token}@${base}`,
    };
  }
  const subdomain = domain.startsWith('probes.') ? domain : `probes.${domain}`;
  return {
    style: 'CATCH_ALL_SUBDOMAIN', token: input.token,
    address: `${input.token}@${subdomain}`,
  };
}

/**
 * Recover the probe token from an address a reply was sent to.
 *
 * Both shapes are understood regardless of which one was issued, because a mail
 * system may rewrite one into the other and the token is what matters. Returns null
 * rather than guessing: an address with no recoverable token attributes nothing, and
 * that is a fact about our addressing, not about the company that replied.
 */
export function tokenFromAddress(address: string | null | undefined): string | null {
  const normalized = normalizeEmail(address);
  if (!normalized) return null;
  const [local, domain] = normalized.split('@');
  if (!local || !domain) return null;

  const plus = local.indexOf('+');
  if (plus >= 0) {
    const candidate = local.slice(plus + 1);
    return isTokenShaped(candidate) ? candidate : null;
  }
  if (domain.startsWith('probes.') && isTokenShaped(local)) return local;
  return null;
}

function isTokenShaped(value: string): boolean {
  return new RegExp(`^[0-9a-f]{${TOKEN_BYTES * 2}}$`).test(value);
}

/**
 * What a probe is allowed to say about itself on a form.
 *
 * Deliberately thin. A detailed life situation is a fabricated substantive fact, and
 * §12.5 forbids inventing one: the identity exists to fill a name field, not to be a
 * character. The free text is a neutral request for information, which is the only
 * intent V1 submits.
 */
export interface ProbeIdentity {
  probeIdentityId: string;
  fullName: string;
  version: number;
}

export const NEUTRAL_INQUIRY_BY_VERTICAL: Record<string, string> = {
  hvac: 'I would like information about replacing my AC. Please call me.',
  plumbing: 'I would like to speak with someone about your service and pricing. Please call me.',
  roofing: 'I would like information about getting an estimate for my roof. Please call me.',
  'collision-repair': 'I would like information about getting an estimate. Please call me.',
  'real-estate-brokerages': 'I would like to speak with an agent about homes in the area. Please call me.',
};

/** The wording used when a vertical has no specific line. Still neutral, still no facts. */
export const NEUTRAL_INQUIRY_DEFAULT =
  'I would like information about your service and pricing. Please call me.';

export function neutralInquiryFor(verticalProfileId: string | null | undefined): string {
  if (!verticalProfileId) return NEUTRAL_INQUIRY_DEFAULT;
  return NEUTRAL_INQUIRY_BY_VERTICAL[verticalProfileId] ?? NEUTRAL_INQUIRY_DEFAULT;
}
