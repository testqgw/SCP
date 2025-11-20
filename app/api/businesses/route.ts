export const dynamic = 'force-dynamic'; // Force dynamic route for Vercel build
import { NextResponse } from 'next/server';
import { auth, currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';

// GET: Fetch all businesses for the logged-in user
export async function GET() {
  try {
    const { userId } = auth();

    if (!userId) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const businesses = await prisma.business.findMany({
      where: {
        userId: userId,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return NextResponse.json(businesses);
  } catch (error) {
    console.error('[BUSINESSES_GET]', error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}

// POST: Create a new business
export async function POST(req: Request) {
  try {
    const user = await currentUser();
    const body = await req.json();
    const { name, businessType, address, city, state, zip, phone } = body;

    if (!user || !user.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    if (!name) {
      return new NextResponse("Name is required", { status: 400 });
    }

    // THE FIX: Lazy Sync - Ensure user exists in database before creating business
    // This fixes the Foreign Key constraint violation on new databases
    await prisma.user.upsert({
      where: {
        id: user.id,
      },
      update: {}, // If user exists, do nothing
      create: {
        id: user.id,
        email: user.emailAddresses[0]?.emailAddress || "no-email@example.com",
        name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || "User",
        phone: "",
        subscriptionStatus: "active",
        subscriptionTier: "starter"
      },
    });

    // 🚪 BUSINESS LIMIT ENFORCER: Check tier and existing count
    const userRecord = await prisma.user.findUnique({
      where: { id: user.id },
      select: { subscriptionTier: true }
    });

    const businessCount = await prisma.business.count({
      where: { userId: user.id }
    });

    // If starter tier and already has 1+ businesses, block creation
    if (userRecord?.subscriptionTier === 'starter' && businessCount >= 1) {
      return NextResponse.json(
        { error: "LIMIT_REACHED", message: "Free plan limited to 1 Business." },
        { status: 403 }
      );
    }

    const business = await prisma.business.create({
      data: {
        userId: user.id,
        name,
        businessType: businessType || 'other',
        address: address || '',
        city: city || '',
        state: state || '',
        zip: zip || '',
        phone: phone || '',
      },
    });

    return NextResponse.json(business);
  } catch (error) {
    console.error('[BUSINESSES_POST]', error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}

// DELETE: Delete a business
export async function DELETE(req: Request) {
  try {
    const { userId } = auth();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!userId) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    if (!id) {
      return new NextResponse("ID is required", { status: 400 });
    }

    const business = await prisma.business.delete({
      where: {
        id,
        userId, // Ensure user owns the business
      },
    });

    return NextResponse.json(business);
  } catch (error) {
    console.error('[BUSINESSES_DELETE]', error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}