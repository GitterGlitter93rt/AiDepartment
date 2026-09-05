/**
 * What a failure is allowed to say out loud.
 *
 * A job that fails stores its error text in `jobs.last_error` and `outcome_reason`,
 * and both are rendered on the Mining page. That text is whatever an exception
 * carried: a provider client that puts an Authorization header in its message, a
 * driver that echoes a connection string, a fetch that includes a signed URL. None
 * of those are hypothetical shapes -- they are the ordinary way libraries report
 * failure -- and the page they land on is one an operator screenshots.
 *
 * Redaction happens at the boundary where the text becomes durable, not at the
 * point where it is displayed, because by then it is already in the database and in
 * whatever was backed up.
 */

/**
 * Environment values that must never appear in stored text.
 *
 * Read at call time rather than captured at import, so a credential added after
 * start-up is still redacted.
 */
function configuredSecrets(env: NodeJS.ProcessEnv = process.env): string[] {
  const secrets: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (!value || value.length < 8) continue;
    if (!/KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|DSN|DATABASE_URL/i.test(key)) continue;
    secrets.push(value);
    // A connection string's password is a secret in its own right, and an error is
    // far more likely to quote that than the whole URL.
    const password = /^[a-z+]+:\/\/[^:/@]+:([^@]+)@/i.exec(value)?.[1];
    if (password && password.length >= 6) secrets.push(password);
  }
  return secrets;
}

/** Shapes that are credentials whatever they are set to. */
const SECRET_PATTERNS: { pattern: RegExp; replacement: string }[] = [
  { pattern: /\b(Authorization|authorization)\s*[:=]\s*(Basic|Bearer)\s+[A-Za-z0-9._~+/=-]+/g,
    replacement: '$1: $2 [redacted]' },
  { pattern: /\b(Basic|Bearer)\s+[A-Za-z0-9._~+/=-]{12,}/g, replacement: '$1 [redacted]' },
  // A URL carrying credentials, including the one the database is reached through.
  { pattern: /([a-z+]+:\/\/)[^:/@\s]+:[^@\s]+@/gi, replacement: '$1[redacted]@' },
  { pattern: /\b(password|passwd|pwd|api[_-]?key|secret|token)\s*[:=]\s*("?)[^\s"&,;]{6,}\2/gi,
    replacement: '$1=[redacted]' },
  // Query-string credentials, which is how a signed URL leaks.
  { pattern: /([?&](?:key|token|sig|signature|access_token|api_key)=)[^&\s]+/gi,
    replacement: '$1[redacted]' },
];

/**
 * Removes credentials from text that is about to be stored or shown.
 *
 * Deliberately blunt. A redaction that occasionally hides something harmless costs
 * an operator one extra look at the logs; one that misses a token costs a
 * credential rotation.
 */
export function redactSecrets(
  text: string | null | undefined, env: NodeJS.ProcessEnv = process.env,
): string {
  let output = String(text ?? '');
  if (!output) return output;

  for (const secret of configuredSecrets(env)) {
    if (!secret) continue;
    output = output.split(secret).join('[redacted]');
  }
  for (const { pattern, replacement } of SECRET_PATTERNS) {
    output = output.replace(pattern, replacement);
  }
  return output;
}

/**
 * What an operator should read when a job has run out of attempts.
 *
 * The exception text is for whoever reads the logs. This is for whoever opens the
 * Mining page at eight in the morning and needs to know whether to do something.
 */
export function terminalFailureReason(jobType: string, message: string): string {
  const detail = redactSecrets(message).slice(0, 300);
  switch (jobType) {
    case 'market_mine':
      return `This market search failed and will not be retried automatically. `
        + `Nothing about the market has been learned from it. Reason: ${detail}`;
    case 'account_research':
    case 'contact_research':
      return `Research on this company failed and will not be retried automatically. `
        + `The company is still in inventory and can be researched again by hand. `
        + `Reason: ${detail}`;
    default:
      return `This job failed and will not be retried automatically. Reason: ${detail}`;
  }
}
