export const dynamic = 'force-dynamic'; // Force dynamic rendering for cron jobs

import { NextResponse } from 'next/server';
import { getExpiringLicenses } from '@/lib/services/license-checker';
import { sendSMS, sendEmail, formatExpirationMessage, generateExpirationEmailHtml } from '@/lib/services/notifications';
import { prisma } from '@/lib/prisma';

/**
 * Cron Job API Route
 * This should be called daily by Vercel Cron or an external cron service
 * 
 * Set up in vercel.json:
 * {
 *   "crons": [{
 *     "path": "/api/cron/check-expirations",
 *     "schedule": "0 9 * * *"
 *   }]
 * }
 */

export async function GET(request: Request) {
    try {
        // Verify the request is from a cron service (optional but recommended)
        const authHeader = request.headers.get('authorization');
        if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        console.log('🔔 Starting expiration check cron job...');

        // Check for licenses expiring at 30, 60, and 90 days
        const milestones = [30, 60, 90];
        let totalNotificationsSent = 0;
        const results: any[] = [];

        for (const days of milestones) {
            console.log(`\n📅 Checking for licenses expiring in ${days} days...`);

            const expiringLicenses = await getExpiringLicenses(days);

            for (const license of expiringLicenses) {
                const { business, licenseType, renewalUrl } = license;

                // Get all OWNER and ADMIN members for this business
                const recipients = business.memberships.map(m => m.user);

                console.log(`\n📬 License: ${licenseType} for ${business.name}`);
                console.log(`   Recipients: ${recipients.length} (${recipients.map(r => r.email).join(', ')})`);

                for (const user of recipients) {
                    const message = formatExpirationMessage(
                        licenseType,
                        business.name,
                        days,
                        renewalUrl || undefined
                    );

                    // Generate HTML email
                    const htmlEmail = generateExpirationEmailHtml(
                        licenseType,
                        business.name,
                        days,
                        renewalUrl || undefined
                    );

                    // Send SMS if user has a phone number (optional - future feature)
                    if (user.phone) {
                        const smsResult = await sendSMS(user.phone, message);
                        if (smsResult.success) {
                            totalNotificationsSent++;

                            // Log to ReminderSchedule (optional)
                            await prisma.reminderSchedule.create({
                                data: {
                                    licenseId: license.id,
                                    daysBeforeExpiration: days,
                                    reminderType: 'sms',
                                    sentAt: new Date(),
                                    status: 'sent'
                                }
                            }).catch(err => {
                                // Handle unique constraint violation (already sent today)
                                if (err.code === 'P2002') {
                                    console.log(`   ⏭️  Already sent SMS for this license at ${days} days`);
                                }
                            });
                        }
                    }

                    // Send Email with HTML template
                    const emailResult = await sendEmail(
                        user.email,
                        `⚠️ License Expiring Soon: ${licenseType}`,
                        message,
                        htmlEmail
                    );

                    if (emailResult.success) {
                        totalNotificationsSent++;

                        // Log to ReminderSchedule
                        await prisma.reminderSchedule.create({
                            data: {
                                licenseId: license.id,
                                daysBeforeExpiration: days,
                                reminderType: 'email',
                                sentAt: new Date(),
                                status: 'sent'
                            }
                        }).catch(err => {
                            if (err.code === 'P2002') {
                                console.log(`   ⏭️  Already sent email for this license at ${days} days`);
                            }
                        });
                    }
                }

                results.push({
                    license: licenseType,
                    business: business.name,
                    daysUntilExpiration: days,
                    recipientsNotified: recipients.length
                });
            }
        }

        console.log(`\n✅ Cron job complete. Sent ${totalNotificationsSent} notifications.`);

        return NextResponse.json({
            success: true,
            timestamp: new Date().toISOString(),
            notificationsSent: totalNotificationsSent,
            results
        });

    } catch (error: any) {
        console.error('❌ Cron job error:', error);
        return NextResponse.json({
            success: false,
            error: error.message
        }, { status: 500 });
    }
}
