import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding dev user...');
  
  // Create dev user if it doesn't exist
  const devUser = await prisma.user.upsert({
    where: {
      id: 'dev-user-id-123',
    },
    update: {
      // Update if exists
      email: 'dev@example.com',
      name: 'Dev User',
    },
    create: {
      id: 'dev-user-id-123',
      email: 'dev@example.com',
      name: 'Dev User',
      subscriptionTier: 'professional',
      subscriptionStatus: 'active',
    },
  });
  
  console.log(`✅ Dev user created/updated: ${devUser.email} (ID: ${devUser.id})`);
}

main()
  .catch((e) => {
    console.error('❌ Error seeding dev user:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });