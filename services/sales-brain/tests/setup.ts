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
export {};
