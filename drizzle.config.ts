import type { Config } from 'drizzle-kit';
import 'dotenv/config';

// 🚀 Use Turso if credentials are available, otherwise use local SQLite
const useTurso = process.env.TURSO_URL && process.env.TURSO_TOKEN;

const config: Config = {
  schema: './app/db/schema.ts',
  out: './drizzle',
  dialect: 'turso',
  dbCredentials: useTurso ? {
    url: process.env.TURSO_URL!,
    authToken: process.env.TURSO_TOKEN!,
  } : {
    url: process.env.DATABASE_URL || 'file:./local.db',
  },
};

// Log which database we're configuring (helpful for migrations)
console.log(`🔧 Drizzle config: ${useTurso ? 'Turso (remote)' : 'SQLite (local)'}`);

export default config;