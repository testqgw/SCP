export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import { sendSMS } from '@/lib/services/notifications';

/**
 * Test SMS Endpoint - Sends a test SMS to the authenticated user's phone
 * GET /api/test-sms - Sends test SMS to your saved phone number
 */
export async function GET() {
    try {
        const { userId } = auth();

        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Get user's phone number from database
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { phone: true, email: true, name: true }
        });

        if (!user) {
            return NextResponse.json({ error: 'User not found in database' }, { status: 404 });
        }

        if (!user.phone) {
            return NextResponse.json({
                error: 'No phone number saved',
                message: 'Please add your phone number in Settings first.',
                email: user.email
            }, { status: 400 });
        }

        // Send test SMS
        const testMessage = `🎉 UltOps Test: Hey ${user.name || 'there'}! Your SMS notifications are working. This is a test message from UltOps.`;

        const result = await sendSMS(user.phone, testMessage);

        if (result.success) {
            return NextResponse.json({
                success: true,
                message: `Test SMS sent to ${user.phone}`,
                sid: result.sid
            });
        } else {
            return NextResponse.json({
                success: false,
                error: result.error,
                phone: user.phone
            }, { status: 500 });
        }

    } catch (error: any) {
        console.error('❌ Test SMS error:', error);
        return NextResponse.json({
            success: false,
            error: error.message
        }, { status: 500 });
    }
}
