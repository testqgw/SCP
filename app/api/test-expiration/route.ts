import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { addDays } from 'date-fns';
import { getExpiringLicenses } from '@/lib/services/license-checker';

export async function GET() {
    try {
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

        // 4. Create test licenses
        const today = new Date();
        const in30Days = addDays(today, 30);
        const in31Days = addDays(today, 31);
        const in60Days = addDays(today, 60);

        // Clear old test licenses first
        await prisma.license.deleteMany({
            where: {
                businessId: testBusiness.id,
                licenseType: {
                    startsWith: "Test License"
                }
            }
        });

        const license30 = await prisma.license.create({
            data: {
                businessId: testBusiness.id,
                licenseType: "Test License expiring in 30 days",
                issuingAuthority: "Test Authority",
                issueDate: today,
                expirationDate: in30Days,
            }
        });

        const license31 = await prisma.license.create({
            data: {
                businessId: testBusiness.id,
                licenseType: "Test License expiring in 31 days",
                issuingAuthority: "Test Authority",
                issueDate: today,
                expirationDate: in31Days,
            }
        });

        const license60 = await prisma.license.create({
            data: {
                businessId: testBusiness.id,
                licenseType: "Test License expiring in 60 days",
                issuingAuthority: "Test Authority",
                issueDate: today,
                expirationDate: in60Days,
            }
        });

        // 5. Test the expiration logic
        const expiring30 = await getExpiringLicenses(30);
        const expiring31 = await getExpiringLicenses(31);
        const expiring60 = await getExpiringLicenses(60);

        return NextResponse.json({
            success: true,
            message: "Expiration logic test completed",
            results: {
                testUser: testUser.email,
                testBusiness: testBusiness.name,
                licensesCreated: [
                    { type: license30.licenseType, expiresIn: "30 days" },
                    { type: license31.licenseType, expiresIn: "31 days" },
                    { type: license60.licenseType, expiresIn: "60 days" }
                ],
                tests: [
                    {
                        query: "Licenses expiring in 30 days",
                        found: expiring30.length,
                        expected: 1,
                        passed: expiring30.length === 1
                    },
                    {
                        query: "Licenses expiring in 31 days",
                        found: expiring31.length,
                        expected: 1,
                        passed: expiring31.length === 1
                    },
                    {
                        query: "Licenses expiring in 60 days",
                        found: expiring60.length,
                        expected: 1,
                        passed: expiring60.length === 1
                    }
                ]
            }
        });

    } catch (error: any) {
        console.error('[TEST_EXPIRATION]', error);
        return NextResponse.json({
            success: false,
            error: error.message
        }, { status: 500 });
    }
}
