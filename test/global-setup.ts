import { execSync } from 'node:child_process';
import { config } from 'dotenv';
import { resolve } from 'node:path';

/**
 * Resets the dedicated e2e database (ecom_test) to the current schema before
 * the suite runs. Requires the Postgres server from docker-compose.yml or
 * `npm run db:start` to be reachable.
 */
export default function globalSetup(): void {
  const root = resolve(__dirname, '..');
  config({ path: resolve(root, '.env.test'), override: true, quiet: true });
  execSync('npx prisma db push --force-reset --skip-generate', {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  });
}
