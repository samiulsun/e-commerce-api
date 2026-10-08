import { config } from 'dotenv';
import { resolve } from 'node:path';

// Jest sets NODE_ENV=test; make .env.test authoritative for the whole e2e run.
config({ path: resolve(__dirname, '..', '.env.test'), override: true, quiet: true });
