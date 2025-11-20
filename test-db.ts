// test-db.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: "file:./prisma/dev.db"
    }
  }
});

async function main() {
  console.log("⏳ Attempting to connect to SQLite...");
  try {
    const count = await prisma.user.count();
    console.log(`✅ SUCCESS! Connected. Found ${count} users.`);
  } catch (e) {
    console.error("❌ FAILURE:", e);
  }
}

main();