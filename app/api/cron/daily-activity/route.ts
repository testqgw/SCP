export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendActivitySummaryEmail } from '@/lib/services/notifications';

/**
 * Daily Activity Summary Cron
 * Runs at 8:00 PM local time (adjust in vercel.json)
 * Finds all businesses and licenses added "today" and sends a batched summary to the user.
 */
export async function GET(request: Request) {
    try {
        // Verify Cron Secret
        const authHeader = request.headers.get('authorization');
        if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        console.log('📊 Starting daily activity summary cron job...');

        // Define "Today" (from midnight to now)
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // 1. Get businesses added today
        const newBusinesses = await prisma.business.findMany({
            where: { createdAt: { gte: today } },
            include: { user: true }
        });

        // 2. Get licenses added today
        const newLicenses = await prisma.license.findMany({
            where: { createdAt: { gte: today } },
            include: { business: { include: { user: true } } }
        });

        // 3. Group by User
        const userActivity = new Map<string, {
            user: any,
            businessCount: number,
            licenseCount: number
        }>();

        // Count businesses
        for (const biz of newBusinesses) {
            const userId = biz.userId;
            const existing = userActivity.get(userId) || { user: biz.user, businessCount: 0, licenseCount: 0 };
            existing.businessCount++;
            userActivity.set(userId, existing);
        }

        // Count licenses
        for (const lic of newLicenses) {
            // Note: In our schema, License doesn't have direct userId, we go through Business owner
            // This assumes the business owner is the one who cares
            const userId = lic.business.userId;
            const existing = userActivity.get(userId) || { user: lic.business.user, businessCount: 0, licenseCount: 0 };
            existing.licenseCount++;
            userActivity.set(userId, existing);
        }

        // 4. Send Emails (Batched)
        let emailsSent = 0;

        for (const [userId, activity] of userActivity.entries()) {
            const { user, businessCount, licenseCount } = activity;

            if (businessCount === 0 && licenseCount === 0) continue;

            console.log(`📤 Sending summary to ${user.email} (Biz: ${businessCount}, Lic: ${licenseCount})`);

            const result = await sendActivitySummaryEmail(
                user.email,
                user.firstName,
                businessCount,
                licenseCount
            );

            if (result.success) emailsSent++;
        }

        return NextResponse.json({
            success: true,
            summary: {
                usersNotified: emailsSent,
                totalNewBusinesses: newBusinesses.length,
                totalNewLicenses: newLicenses.length
            }
        });

    } catch (error: any) {
        console.error('❌ Daily activity cron error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
