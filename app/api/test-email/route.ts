export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import { sendEmail, generateExpirationEmailHtml } from '@/lib/services/notifications';

/**
 * Test Email Endpoint - Sends a test email to the authenticated user
 * GET /api/test-email - Sends test email to your saved email address
 */
export async function GET() {
    try {
        const { userId } = auth();

        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Get user's email from database
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { email: true, name: true }
        });

        if (!user) {
            return NextResponse.json({ error: 'User not found in database' }, { status: 404 });
        }

        // Generate a sample expiration email
        const testHtml = generateExpirationEmailHtml(
            'Health Permit',
            'Sample Food Truck',
            30,
            'https://ultops.com/dashboard'
        );

        // Send test email
        const result = await sendEmail(
            user.email,
            '🧪 UltOps Test Email - Your Reminders Are Working!',
            `Hey ${user.name || 'there'}! This is a test email from UltOps. Your email reminders are working correctly.`,
            testHtml
        );

        if (result.success) {
            return NextResponse.json({
                success: true,
                message: `Test email sent to ${user.email}`,
                id: result.id
            });
        } else {
            return NextResponse.json({
                success: false,
                error: result.error,
                email: user.email
            }, { status: 500 });
        }

    } catch (error: any) {
        console.error('❌ Test Email error:', error);
        return NextResponse.json({
            success: false,
            error: error.message
        }, { status: 500 });
    }
}
