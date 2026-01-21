import { SQL } from "bun";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing from .env");
}

const dbUrl = new URL(process.env.DATABASE_URL);
const dbHost = dbUrl.hostname;
const dbName = dbUrl.pathname.replace("/", "");

console.log(`[db] Connecting to database "${dbName}" at ${dbHost}...`);

export const sql = new SQL(process.env.DATABASE_URL, {
  tls: {
    rejectUnauthorized: false,
  },
});

const [connectionTest] = await sql`SELECT 1 as connected`;
if (connectionTest?.connected === 1) {
  console.log(`[db] Connection successful`);
} else {
  throw new Error("[db] Connection test failed");
}

const [tableCheck] = await sql`
  SELECT EXISTS (
    SELECT FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'questions'
  ) as exists
`;

const tableExisted = tableCheck?.exists;

await sql`
  CREATE TABLE IF NOT EXISTS questions (
    id SERIAL PRIMARY KEY,
    question TEXT NOT NULL,
    options JSONB NOT NULL,
    answer TEXT NOT NULL,
    topic TEXT NOT NULL,
    parent_set TEXT,
    explanation TEXT,
    explanation_sources JSONB
  )
`;

// Migration: Add parent_set if it doesn't exist
await sql`
  ALTER TABLE questions ADD COLUMN IF NOT EXISTS parent_set TEXT
`;

if (tableExisted) {
  console.log(`[db] Table "questions" already exists, skipping creation`);
} else {
  console.log(`[db] Created table "questions"`);
}

const [countResult] = await sql`SELECT COUNT(*) as count FROM questions`;
console.log(`[db] Table "questions" contains ${countResult?.count || 0} rows`);

const [visitorsTableCheck] = await sql`
  SELECT EXISTS (
    SELECT FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'visitors'
  ) as exists
`;

const visitorsTableExisted = visitorsTableCheck?.exists;

await sql`
  CREATE TABLE IF NOT EXISTS visitors (
    id SERIAL PRIMARY KEY,
    fingerprint TEXT UNIQUE NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    device_type TEXT,
    browser TEXT,
    os TEXT,
    country TEXT,
    city TEXT,
    visit_count INTEGER DEFAULT 1,
    first_seen TIMESTAMP DEFAULT NOW(),
    last_seen TIMESTAMP DEFAULT NOW()
  )
`;

if (visitorsTableExisted) {
  console.log(`[db] Table "visitors" already exists, skipping creation`);
} else {
  console.log(`[db] Created table "visitors"`);
}

const [visitorsCount] = await sql`SELECT COUNT(*) as count FROM visitors`;
console.log(`[db] Table "visitors" contains ${visitorsCount?.count || 0} rows`);

console.log(`[db] Initialization complete`);
