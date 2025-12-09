import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
    try {
        const { userId } = auth();

        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Get user's feedback messages
        const messages = await prisma.feedback.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
        });

        return NextResponse.json(messages);
    } catch (error) {
        console.error('[MY_MESSAGES_GET]', error);
        return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 });
    }
}
