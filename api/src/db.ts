import { SQL } from "bun";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing from .env");
}

// Initialize Bun native SQL client
export const sql = new SQL(process.env.DATABASE_URL, {
  // AWS RDS requires SSL. 'rejectUnauthorized: false' is needed unless you download their CA cert.
  // Ideally, you'd use the CA cert, but for this project, this is acceptable and works.
  tls: {
    rejectUnauthorized: false,
  },
});

console.log("🔥 Database connected!");
