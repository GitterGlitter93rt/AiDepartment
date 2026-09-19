import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Must be imported before anything that reads src/config.
 *
 * Points the process at `yad_sales_scale`, a database that exists only to hold
 * synthetic fixtures. Working inventory lives in `yad_sales` and the automated test
 * database is `yad_sales_test`; neither is ever the target of a scale run, and the
 * generator refuses a database whose name does not say what it is for.
 */
if (!process.env.SCALE_DB_CONFIGURED) {
  const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '.env');
  const values = new Map<string, string>();
  if (existsSync(envPath)) {
    for (const rawLine of readFileSync(envPath, 'utf8').split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq > 0) values.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
    }
  }
  const baseUrl = process.env.SCALE_DATABASE_URL
    ?? process.env.DATABASE_URL ?? values.get('DATABASE_URL') ?? '';
  if (!baseUrl) {
    throw new Error('No DATABASE_URL available. Create services/sales-brain/.env first.');
  }
  const scaleUrl = baseUrl.replace(/\/[^/?]*(\?|$)/, '/yad_sales_scale$1');
  if (!scaleUrl.includes('yad_sales_scale')) {
    throw new Error(`Refusing to run: could not derive a scale database URL from ${baseUrl}`);
  }
  process.env.DATABASE_URL = scaleUrl;
  process.env.SESSION_SECRET = values.get('SESSION_SECRET') ?? 'scale-session-secret-only';
  process.env.SCALE_DB_CONFIGURED = '1';
}
export {};
