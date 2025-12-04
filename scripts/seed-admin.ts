// Script to upgrade admin user and create sample data
// Run with: npx ts-node scripts/seed-admin.ts

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function addDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}

async function main() {
    const adminEmail = 'quincygw@gmail.com';

    // 1. Find and upgrade the admin user
    const user = await prisma.user.findUnique({
        where: { email: adminEmail }
    });

    if (!user) {
        console.log('❌ User not found with email:', adminEmail);
        console.log('   Make sure you have signed up first.');
        return;
    }

    console.log('✅ Found user:', user.email);

    // 2. Upgrade to ADMIN role and professional tier
    await prisma.user.update({
        where: { email: adminEmail },
        data: {
            role: 'ADMIN',
            subscriptionTier: 'multi_location',
            subscriptionStatus: 'active'
        }
    });

    console.log('✅ Upgraded user to ADMIN with multi_location tier');

    // 3. Create a sample business
    const sampleBusiness = await prisma.business.create({
        data: {
            userId: user.id,
            name: "Joe's Atlanta Food Truck",
            businessType: 'food_truck',
            city: 'Atlanta',
            state: 'GA',
            phone: '(404) 555-1234'
        }
    });

    console.log('✅ Created sample business:', sampleBusiness.name);

    // 4. Create licenses with various expiration statuses
    const today = new Date();

    const licenses = [
        {
            businessId: sampleBusiness.id,
            licenseType: 'Health Permit',
            licenseNumber: 'HP-2024-4821',
            issuingAuthority: 'Fulton County Health Dept',
            issueDate: addDays(today, -365),
            expirationDate: addDays(today, -15),
            status: 'expired',
            renewalUrl: 'https://fultoncountyga.gov/health-permits'
        },
        {
            businessId: sampleBusiness.id,
            licenseType: 'Food Handler Certificate',
            licenseNumber: 'FHC-88492',
            issuingAuthority: 'ServSafe',
            issueDate: addDays(today, -730),
            expirationDate: addDays(today, -5),
            status: 'expired',
            gracePeriodDays: 30,
            renewalUrl: 'https://servsafe.com/renew'
        },
        {
            businessId: sampleBusiness.id,
            licenseType: 'Fire Safety Inspection',
            licenseNumber: 'FS-2024-1192',
            issuingAuthority: 'Atlanta Fire Rescue',
            issueDate: addDays(today, -180),
            expirationDate: addDays(today, 3),
            status: 'expiring_soon',
            renewalUrl: 'https://atlantaga.gov/fire-inspections'
        },
        {
            businessId: sampleBusiness.id,
            licenseType: 'Business License',
            licenseNumber: 'BL-ATL-2024-7723',
            issuingAuthority: 'City of Atlanta',
            issueDate: addDays(today, -300),
            expirationDate: addDays(today, 7),
            status: 'expiring_soon',
            renewalUrl: 'https://atlantaga.gov/business-license'
        },
        {
            businessId: sampleBusiness.id,
            licenseType: 'Mobile Vendor Permit',
            licenseNumber: 'MVP-2024-3344',
            issuingAuthority: 'Fulton County',
            issueDate: addDays(today, -60),
            expirationDate: addDays(today, 45),
            status: 'current',
            renewalUrl: 'https://fultoncountyga.gov/mobile-vendor'
        },
        {
            businessId: sampleBusiness.id,
            licenseType: 'Vehicle Registration',
            licenseNumber: 'ATL-8934-FT',
            issuingAuthority: 'GA DMV',
            issueDate: addDays(today, -200),
            expirationDate: addDays(today, 120),
            status: 'current',
            renewalUrl: 'https://dor.georgia.gov/motor-vehicles'
        }
    ];

    for (const license of licenses) {
        await prisma.license.create({ data: license });
        console.log(`  📄 Created license: ${license.licenseType} (${license.status})`);
    }

    console.log('\n🎉 Done! Your account has been upgraded and sample data created.');
    console.log('   - 2 expired licenses');
    console.log('   - 2 expiring soon (3 and 7 days)');
    console.log('   - 2 current licenses');
}

main()
    .catch((e) => {
        console.error('Error:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
