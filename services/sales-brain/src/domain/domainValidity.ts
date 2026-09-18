/**
 * Whether a domain can ever be a company's public website.
 *
 * Production carries `proofroof.invalid` on a live, workable Account called Proof
 * Roofing. `.invalid` is reserved by RFC 2606 precisely so that it never resolves, which
 * means fixture data reached the live estate and then sat there being retried.
 *
 * Two costs, and the second is the reason this is a guard rather than a cleanup. A
 * reserved domain is not a website, so an Account built on one is not a prospect. And the
 * V3 recovery campaign would spend ten hours an Account asking DNS about a name that is
 * guaranteed not to exist.
 *
 * Existing records keep their domain as historical evidence. This decides what may be
 * treated as a usable website from here on, not what may be remembered.
 */

/** Reserved by RFC 2606 and RFC 6761: guaranteed never to resolve publicly. */
const RESERVED_TLDS = new Set(['invalid', 'test', 'example', 'localhost', 'local']);

/** Names reserved for documentation. A real company is not at example.com. */
const RESERVED_NAMES = new Set([
  'example.com', 'example.net', 'example.org', 'example.edu',
  'localhost.localdomain', 'domain.com', 'yourdomain.com', 'yourcompany.com',
  'mysite.com', 'website.com', 'site.com', 'company.com',
]);

export type DomainValidity =
  | 'PUBLIC'
  | 'RESERVED_TLD'
  | 'RESERVED_NAME'
  | 'NOT_A_DOMAIN'
  | 'IP_ADDRESS';

export interface DomainValidityVerdict {
  validity: DomainValidity;
  usableAsWebsite: boolean;
  /** Worth spending hours of retries on. Reserved names never are. */
  worthRecovering: boolean;
  reason: string;
}

export function judgeDomain(raw: string | null | undefined): DomainValidityVerdict {
  const host = (raw ?? '').trim().toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/^[^/@]*@/, '')
    .split(/[/?#]/)[0]!
    .split(':')[0]!
    .replace(/\.$/, '');

  if (!host || !host.includes('.')) {
    return { validity: 'NOT_A_DOMAIN', usableAsWebsite: false, worthRecovering: false,
      reason: `"${raw ?? ''}" is not a domain name` };
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return { validity: 'IP_ADDRESS', usableAsWebsite: false, worthRecovering: false,
      reason: 'a bare IP address is not a company website' };
  }
  const tld = host.split('.').pop()!;
  if (RESERVED_TLDS.has(tld)) {
    return { validity: 'RESERVED_TLD', usableAsWebsite: false, worthRecovering: false,
      reason: `.${tld} is reserved and can never resolve publicly (RFC 2606/6761), so this `
        + 'is fixture data rather than a website' };
  }
  const registrable = host.replace(/^www\./, '');
  if (RESERVED_NAMES.has(registrable)) {
    return { validity: 'RESERVED_NAME', usableAsWebsite: false, worthRecovering: false,
      reason: `${registrable} is a documentation or placeholder name, not a company's site` };
  }
  return { validity: 'PUBLIC', usableAsWebsite: true, worthRecovering: true,
    reason: 'a publicly resolvable domain name' };
}

export function isUsableWebsiteDomain(raw: string | null | undefined): boolean {
  return judgeDomain(raw).usableAsWebsite;
}
