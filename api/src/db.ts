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
    explanation TEXT,
    explanation_sources JSONB
  )
`;

if (tableExisted) {
  console.log(`[db] Table "questions" already exists, skipping creation`);
} else {
  console.log(`[db] Created table "questions"`);
}

const [countResult] = await sql`SELECT COUNT(*) as count FROM questions`;
console.log(`[db] Table "questions" contains ${countResult?.count || 0} rows`);

console.log(`[db] Initialization complete`);
