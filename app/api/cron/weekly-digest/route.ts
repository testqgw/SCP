export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendEmail } from '@/lib/services/notifications';
import { differenceInDays } from 'date-fns';

/**
 * Weekly Digest Cron Job
 * Sends every Monday at 9 AM UTC with a summary of all licenses
 * 
 * Schedule in vercel.json: "0 9 * * 1" (every Monday at 9 AM)
 */

export async function GET(request: Request) {
    try {
        // Verify cron secret
        const authHeader = request.headers.get('authorization');
        if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        console.log('📬 Starting weekly digest job...');

        // Get all users with their businesses and licenses
        const users = await prisma.user.findMany({
            where: {
                businesses: {
                    some: {} // Only users with at least one business
                }
            },
            include: {
                businesses: {
                    include: {
                        licenses: true
                    }
                }
            }
        });

        let emailsSent = 0;

        for (const user of users) {
            // Collect all licenses across all businesses
            const allLicenses = user.businesses.flatMap(b =>
                b.licenses.map(l => ({
                    ...l,
                    businessName: b.name
                }))
            );

            if (allLicenses.length === 0) continue;

            // Categorize licenses
            const today = new Date();
            const expired: typeof allLicenses = [];
            const urgent: typeof allLicenses = []; // 0-30 days
            const upcoming: typeof allLicenses = []; // 31-90 days
            const healthy: typeof allLicenses = []; // 90+ days

            for (const license of allLicenses) {
                const daysUntil = differenceInDays(license.expirationDate, today);

                if (daysUntil < 0) {
                    expired.push(license);
                } else if (daysUntil <= 30) {
                    urgent.push(license);
                } else if (daysUntil <= 90) {
                    upcoming.push(license);
                } else {
                    healthy.push(license);
                }
            }

            // Generate HTML digest
            const html = generateWeeklyDigestHtml(
                user.name || user.email,
                { expired, urgent, upcoming, healthy }
            );

            // Send email
            const result = await sendEmail(
                user.email,
                `📊 Your Weekly License Status Report`,
                `You have ${allLicenses.length} licenses tracked. ${urgent.length} need attention soon.`,
                html
            );

            if (result.success) {
                emailsSent++;
            }
        }

        console.log(`✅ Weekly digest complete. Sent ${emailsSent} emails.`);

        return NextResponse.json({
            success: true,
            emailsSent,
            usersProcessed: users.length
        });

    } catch (error: any) {
        console.error('❌ Weekly digest error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

function generateWeeklyDigestHtml(
    userName: string,
    licenses: {
        expired: any[];
        urgent: any[];
        upcoming: any[];
        healthy: any[];
    }
): string {
    const total = licenses.expired.length + licenses.urgent.length + licenses.upcoming.length + licenses.healthy.length;

    const formatLicenseRow = (license: any, color: string) => `
        <tr>
            <td style="padding: 12px; border-bottom: 1px solid #e2e8f0;">${license.licenseType}</td>
            <td style="padding: 12px; border-bottom: 1px solid #e2e8f0;">${license.businessName}</td>
            <td style="padding: 12px; border-bottom: 1px solid #e2e8f0;">
                <span style="color: ${color}; font-weight: 600;">
                    ${new Date(license.expirationDate).toLocaleDateString()}
                </span>
            </td>
        </tr>
    `;

    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f1f5f9; margin: 0; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
            
            <!-- Header -->
            <div style="background: linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%); padding: 30px; text-align: center;">
                <h1 style="color: white; margin: 0; font-size: 24px;">📊 Weekly License Report</h1>
                <p style="color: #94a3b8; margin: 10px 0 0 0;">Hey ${userName}, here's your status update</p>
            </div>
            
            <!-- Summary Cards -->
            <div style="padding: 20px; display: flex; gap: 10px; flex-wrap: wrap;">
                <div style="flex: 1; min-width: 120px; background: #fef2f2; border-radius: 8px; padding: 15px; text-align: center;">
                    <div style="font-size: 28px; font-weight: bold; color: #dc2626;">${licenses.expired.length}</div>
                    <div style="font-size: 12px; color: #991b1b;">Expired</div>
                </div>
                <div style="flex: 1; min-width: 120px; background: #fef3c7; border-radius: 8px; padding: 15px; text-align: center;">
                    <div style="font-size: 28px; font-weight: bold; color: #d97706;">${licenses.urgent.length}</div>
                    <div style="font-size: 12px; color: #92400e;">Urgent (≤30d)</div>
                </div>
                <div style="flex: 1; min-width: 120px; background: #dbeafe; border-radius: 8px; padding: 15px; text-align: center;">
                    <div style="font-size: 28px; font-weight: bold; color: #2563eb;">${licenses.upcoming.length}</div>
                    <div style="font-size: 12px; color: #1e40af;">Upcoming</div>
                </div>
                <div style="flex: 1; min-width: 120px; background: #dcfce7; border-radius: 8px; padding: 15px; text-align: center;">
                    <div style="font-size: 28px; font-weight: bold; color: #16a34a;">${licenses.healthy.length}</div>
                    <div style="font-size: 12px; color: #166534;">All Good</div>
                </div>
            </div>

            <!-- Action Items -->
            ${(licenses.expired.length > 0 || licenses.urgent.length > 0) ? `
            <div style="padding: 0 20px 20px 20px;">
                <h3 style="color: #1e293b; margin: 0 0 15px 0; font-size: 16px;">⚠️ Needs Your Attention</h3>
                <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                    <thead>
                        <tr style="background: #f8fafc;">
                            <th style="padding: 12px; text-align: left; border-bottom: 2px solid #e2e8f0;">License</th>
                            <th style="padding: 12px; text-align: left; border-bottom: 2px solid #e2e8f0;">Business</th>
                            <th style="padding: 12px; text-align: left; border-bottom: 2px solid #e2e8f0;">Expires</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${licenses.expired.map(l => formatLicenseRow(l, '#dc2626')).join('')}
                        ${licenses.urgent.map(l => formatLicenseRow(l, '#d97706')).join('')}
                    </tbody>
                </table>
            </div>
            ` : `
            <div style="padding: 20px; text-align: center;">
                <div style="font-size: 48px; margin-bottom: 10px;">✅</div>
                <h3 style="color: #16a34a; margin: 0;">All caught up!</h3>
                <p style="color: #64748b; margin: 10px 0 0 0;">No urgent licenses need attention this week.</p>
            </div>
            `}

            <!-- CTA -->
            <div style="padding: 20px; text-align: center;">
                <a href="https://ultops.com/dashboard" style="display: inline-block; background: #3b82f6; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600;">
                    View Full Dashboard →
                </a>
            </div>
            
            <!-- Footer -->
            <div style="background: #f8fafc; padding: 20px; text-align: center; border-top: 1px solid #e2e8f0;">
                <p style="color: #94a3b8; font-size: 12px; margin: 0;">
                    You're receiving this weekly digest from UltOps.<br>
                    <a href="https://ultops.com/settings" style="color: #3b82f6;">Manage email preferences</a>
                </p>
            </div>
        </div>
    </body>
    </html>
    `;
}
