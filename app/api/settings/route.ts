import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';

// GET: Fetch current user profile from YOUR database
export async function GET() {
  try {
    const { userId } = auth();
    if (!userId) return new NextResponse("Unauthorized", { status: 401 });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        name: true,
        email: true,
        phone: true,
        subscriptionTier: true,
        subscriptionStatus: true,
      }
    });

    return NextResponse.json(user);
  } catch (error) {
    console.error('[SETTINGS_GET]', error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}

// PUT: Update user profile (Phone & Name)
export async function PUT(req: Request) {
  try {
    const { userId } = auth();
    if (!userId) return new NextResponse("Unauthorized", { status: 401 });

    const body = await req.json();
    const { name, phone } = body;

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        name,
        phone,
      }
    });

    return NextResponse.json(updatedUser);
  } catch (error) {
    console.error('[SETTINGS_PUT]', error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}