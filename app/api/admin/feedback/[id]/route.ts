import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAdminAccess } from '@/lib/admin';

export async function PATCH(
    req: Request,
    { params }: { params: { id: string } }
) {
    try {
        // Verify admin access
        await getAdminAccess();

        const body = await req.json();
        const { status, adminReply } = body;

        const updateData: any = {};
        if (status) updateData.status = status;
        if (adminReply !== undefined) updateData.adminReply = adminReply;

        const feedback = await prisma.feedback.update({
            where: { id: params.id },
            data: updateData,
        });

        return NextResponse.json(feedback);
    } catch (error) {
        console.error('[ADMIN_FEEDBACK_PATCH]', error);
        return new NextResponse("Internal Error", { status: 500 });
    }
}

export async function GET(
    req: Request,
    { params }: { params: { id: string } }
) {
    try {
        await getAdminAccess();

        const feedback = await prisma.feedback.findUnique({
            where: { id: params.id },
        });

        if (!feedback) {
            return new NextResponse("Not Found", { status: 404 });
        }

        return NextResponse.json(feedback);
    } catch (error) {
        console.error('[ADMIN_FEEDBACK_GET]', error);
        return new NextResponse("Internal Error", { status: 500 });
    }
}
