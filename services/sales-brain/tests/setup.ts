import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Must be imported before anything that reads src/config.
 * Reads the real .env, then redirects the process at the throwaway test database
 * so a test run can never write to working inventory.
 */
if (!process.env.TEST_DB_CONFIGURED) {
  const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env');
  const values = new Map<string, string>();
  if (existsSync(envPath)) {
    for (const rawLine of readFileSync(envPath, 'utf8').split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq > 0) values.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
    }
  }
  const baseUrl = process.env.DATABASE_URL ?? values.get('DATABASE_URL') ?? '';
  if (!baseUrl) throw new Error('No DATABASE_URL available for tests. Create services/sales-brain/.env first.');

  const testUrl = baseUrl.replace(/\/[^/?]*(\?|$)/, '/yad_sales_test$1');
  if (!testUrl.includes('yad_sales_test')) {
    throw new Error(`Refusing to run tests: could not derive a test database URL from ${baseUrl}`);
  }
  process.env.DATABASE_URL = testUrl;
  process.env.SESSION_SECRET = values.get('SESSION_SECRET') ?? 'test-session-secret-value-only';
  process.env.TEST_DB_CONFIGURED = '1';

  /**
   * A test run must not inherit the operator's live spending ceiling.
   *
   * `src/config.ts` loads the whole .env into the process, so a box with
   * `DISCOVERY_DAILY_BUDGET_USD=0.30` set for production gave the suite a real
   * ceiling: the sixth mined market in one test exhausted it and every later search
   * was refused by our own budget, so a test asserting how a *provider* refusal is
   * reported read DISCOVERY_BLOCKED instead. The same suite passed on a box with no
   * ceiling configured, which is the worst shape a failure can have.
   *
   * Setting it here rather than deleting it: the loader skips any key already in the
   * environment, and 0 is how "no ceiling" is spelled. A test about spend controls
   * sets its own value and is unaffected.
   */
  if (process.env.DISCOVERY_DAILY_BUDGET_USD === undefined) {
    process.env.DISCOVERY_DAILY_BUDGET_USD = '0';
  }

}

/**
 * Nor the operator's provider configuration.
 *
 * The same shape of problem as the ceiling above, found the same way. A box with real
 * DataForSEO credentials and a signed governance review in its .env gave the suite a
 * live provider, and two tests whose whole subject is "this build cannot reach
 * DataForSEO" failed -- on a machine where the product was behaving correctly. One of
 * them says so in its own assertion message: an adapter registered in a test process
 * means the assertion is measuring the harness rather than the product.
 *
 * Only the discovery provider is neutralised, and deliberately only that. Pinning the
 * outbound and integration keys as well looked like the same tidy idea and broke four
 * unrelated tests that configure those themselves: the fix for a leak is to stop the
 * leak that was found, not to sterilise everything within reach.
 *
 * `config.ts` skips any key already present in the environment, so an empty string
 * here keeps the .env value out, and a test that needs a credential sets its own.
 */
const neutralised: Record<string, string> = {
  DATAFORSEO_ENABLED: 'false',
  DATAFORSEO_GOVERNANCE_REVIEWED: 'false',
  DATAFORSEO_LOGIN: '',
  DATAFORSEO_PASSWORD: '',
};
for (const [key, value] of Object.entries(neutralised)) {
  if (process.env[key] === undefined) process.env[key] = value;
}


export {};
