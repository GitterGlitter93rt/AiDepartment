/**
 * Production build: compile TypeScript, then copy the static assets tsc does not know
 * about. Without the copy step the portal serves a 404 for its own stylesheet, which
 * is exactly the kind of break that only shows up in production.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(packageRoot, 'dist');

rmSync(dist, { recursive: true, force: true });
execFileSync('npx', ['tsc', '-p', 'tsconfig.build.json'], { cwd: packageRoot, stdio: 'inherit' });

for (const relative of ['src/web/assets', 'migrations']) {
  const from = resolve(packageRoot, relative);
  if (!existsSync(from)) continue;
  const to = resolve(dist, relative.replace(/^src\//, ''));
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true });
  console.log(`copied ${relative} -> dist/${relative.replace(/^src\//, '')}`);
}
console.log('build complete: dist/bin/{api,worker,migrate}.js');
