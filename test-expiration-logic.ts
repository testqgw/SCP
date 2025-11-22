import { prisma } from "@/lib/prisma";
import { addDays } from "date-fns";
import { getExpiringLicenses } from "@/lib/services/license-checker";

async function main() {
    console.log("🧪 Testing License Expiration Logic\n");

    // 1. Find or create a test user
    const testUser = await prisma.user.upsert({
        where: { email: "test@example.com" },
        update: {},
        create: {
            id: "test-user-id",
            email: "test@example.com",
            name: "Test User"
        }
    });

    console.log(`✅ Test user: ${testUser.email}`);

    // 2. Create a test business
    const testBusiness = await prisma.business.upsert({
        where: { id: "test-business-id" },
        update: {},
        create: {
            id: "test-business-id",
            userId: testUser.id,
            name: "Test Business",
            businessType: "other"
        }
    });

    console.log(`✅ Test business: ${testBusiness.name}`);

    // 3. Create BusinessMember (OWNER role)
    await prisma.businessMember.upsert({
        where: {
            userId_businessId: {
                userId: testUser.id,
                businessId: testBusiness.id
            }
        },
        update: {},
        create: {
            userId: testUser.id,
            businessId: testBusiness.id,
            role: "OWNER"
        }
    });

    console.log(`✅ BusinessMember created (OWNER)`);

    // 4. Create test licenses
    const today = new Date();
    const in30Days = addDays(today, 30);
    const in31Days = addDays(today, 31);
    const in60Days = addDays(today, 60);

    await prisma.license.create({
        data: {
            businessId: testBusiness.id,
            licenseType: "Test License expiring in 30 days",
            issuingAuthority: "Test Authority",
            issueDate: today,
            expirationDate: in30Days,
        }
    });

    await prisma.license.create({
        data: {
            businessId: testBusiness.id,
            licenseType: "Test License expiring in 31 days",
            issuingAuthority: "Test Authority",
            issueDate: today,
            expirationDate: in31Days,
        }
    });

    await prisma.license.create({
        data: {
            businessId: testBusiness.id,
            licenseType: "Test License expiring in 60 days",
            issuingAuthority: "Test Authority",
            issueDate: today,
            expirationDate: in60Days,
        }
    });

    console.log(`✅ Created 3 test licenses (30, 31, 60 days)\n`);

    // 5. Test the expiration logic
    console.log("🔍 Testing: Find licenses expiring in exactly 30 days...");
    const expiring30 = await getExpiringLicenses(30);
    console.log(`Result: ${expiring30.length} license(s) found`);
    console.log(`Expected: 1 license\n`);

    console.log("🔍 Testing: Find licenses expiring in exactly 31 days...");
    const expiring31 = await getExpiringLicenses(31);
    console.log(`Result: ${expiring31.length} license(s) found`);
    console.log(`Expected: 1 license\n`);

    console.log("🔍 Testing: Find licenses expiring in exactly 60 days...");
    const expiring60 = await getExpiringLicenses(60);
    console.log(`Result: ${expiring60.length} license(s) found`);
    console.log(`Expected: 1 license\n`);

    console.log("✅ Test complete!");
}

main()
    .catch((e) => {
        console.error("❌ Error:", e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
