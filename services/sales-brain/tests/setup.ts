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
  // The crawler refuses private and loopback addresses, which is what stops research
  // reading a cloud metadata service or this product's own API. The suite stands up
  // fixture HTTP servers on 127.0.0.1 to exercise the real fetcher against robots
  // rules and login walls, so the guard is relaxed here and only here. No deployed
  // environment sets this, and tests/fetcherSafety.test.ts turns it back off to prove
  // the guard still refuses.
  process.env.RESEARCH_ALLOW_PRIVATE_ADDRESSES = '1';
}
export {};
