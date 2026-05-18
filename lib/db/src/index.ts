import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Supabase direct connection uses a self-signed cert on the pooler.
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30000,
  idleTimeoutMillis: 50000,    // 50s — discard before NAT kills idle connections
  keepAlive: true,             // TCP keepalive prevents NAT from silently closing connections
  keepAliveInitialDelayMillis: 10000,
  max: 4,
});

export const db = drizzle(pool, { schema });

export * from "./schema";
