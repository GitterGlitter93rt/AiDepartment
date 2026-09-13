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
}
export {};
