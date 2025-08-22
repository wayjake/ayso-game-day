import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './schema';

// 🚀 Use Turso if credentials are available, otherwise use local SQLite
const useTurso = process.env.TURSO_URL && process.env.TURSO_TOKEN;

const client = createClient({
  url: useTurso ? process.env.TURSO_URL! : (process.env.DATABASE_URL || 'file:./local.db'),
  authToken: useTurso ? process.env.TURSO_TOKEN : undefined,
});

// Log which database we're using (helpful for debugging)
if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
  console.log(`📊 Database: ${useTurso ? 'Turso (remote)' : 'SQLite (local)'}`);
}

export const db = drizzle(client, { schema });

export * from './schema';