
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('🚀 Starting migration: Owners -> BusinessMembers');

    // 1. Fetch all businesses
    const businesses = await prisma.business.findMany();
    console.log(`Found ${businesses.length} businesses to migrate.`);

    let successCount = 0;
    let errorCount = 0;

    for (const business of businesses) {
        try {
            // 2. Check if member already exists (idempotency)
            const existingMember = await prisma.businessMember.findUnique({
                where: {
                    userId_businessId: {
                        userId: business.userId,
                        businessId: business.id,
                    },
                },
            });

            if (existingMember) {
                console.log(`ℹ️ Member already exists for Business ${business.name} (${business.id}). Skipping.`);
                continue;
            }

            // 3. Create the Owner member
            await prisma.businessMember.create({
                data: {
                    userId: business.userId,
                    businessId: business.id,
                    role: 'OWNER',
                },
            });

            console.log(`✅ Migrated Business: ${business.name}`);
            successCount++;
        } catch (error) {
            console.error(`❌ Failed to migrate Business ${business.id}:`, error);
            errorCount++;
        }
    }

    console.log('-----------------------------------');
    console.log(`Migration Complete.`);
    console.log(`Success: ${successCount}`);
    console.log(`Skipped/Failed: ${errorCount}`);
    console.log('-----------------------------------');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
