import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';

export async function POST(req: Request) {
    try {
        const { userId } = auth();
        const body = await req.json();
        const { type, message, email } = body;

        if (!message) {
            return NextResponse.json({ error: 'Message is required' }, { status: 400 });
        }

        // Store feedback in database
        const feedback = await prisma.feedback.create({
            data: {
                userId: userId || null,
                type,
                message,
                email: email || null,
                status: 'new',
            },
        });

        // TODO: Optional - Send email notification to support team
        // await sendEmail('masterq@ultops.com', `New ${type}: ${message}`);

        console.log(`📝 New ${type} received from ${userId || 'anonymous'}`);

        return NextResponse.json({
            success: true,
            message: 'Feedback received',
            id: feedback.id
        });

    } catch (error: any) {
        console.error('[FEEDBACK_POST]', error);
        return NextResponse.json({
            error: 'Failed to submit feedback'
        }, { status: 500 });
    }
}
