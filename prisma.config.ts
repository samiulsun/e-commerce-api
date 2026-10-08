import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

// Loads the same .env file the Prisma CLI used to auto-load before config
// files existed. Values already present in process.env are never overridden.
config();

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    seed: 'ts-node prisma/seed.ts',
  },
});