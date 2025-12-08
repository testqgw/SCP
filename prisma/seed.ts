import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Your seed logic goes here
  // For example:
  /*
  const user = await prisma.user.upsert({
    where: { email: 'admin@ultops.com' },
    update: {},
    create: {
      email: 'admin@ultops.com',
      clerkId: 'user_mock_id',
      role: 'ADMIN',
    },
  })
  console.log({ user })
  */
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });