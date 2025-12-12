import type { Config } from 'drizzle-kit';
import 'dotenv/config';

// Production database configuration
// Uses TURSO_PROD_URL and TURSO_PROD_TOKEN environment variables
if (!process.env.TURSO_PROD_URL || !process.env.TURSO_PROD_TOKEN) {
  throw new Error('TURSO_PROD_URL and TURSO_PROD_TOKEN must be set for production migrations');
}

const config: Config = {
  schema: './app/db/schema.ts',
  out: './drizzle',
  dialect: 'turso',
  dbCredentials: {
    url: process.env.TURSO_PROD_URL,
    authToken: process.env.TURSO_PROD_TOKEN,
  },
};

console.log('🚀 Drizzle config: PRODUCTION (Turso)');

export default config;
