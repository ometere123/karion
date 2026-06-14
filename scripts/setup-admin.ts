// Run with: npx tsx scripts/setup-admin.ts
// Sets the ADMIN_EMAIL user's role to ADMIN in the database.
// Usage: ADMIN_EMAIL=you@example.com npx tsx scripts/setup-admin.ts

import "dotenv/config";

async function main() {
  const email = process.env.ADMIN_EMAIL;
  if (!email) {
    console.error("Set ADMIN_EMAIL in your .env file first.");
    process.exit(1);
  }
  console.log(`Admin setup script ready for: ${email}`);
  console.log("This will be functional after Stage 2 (auth + database).");
}

main();
