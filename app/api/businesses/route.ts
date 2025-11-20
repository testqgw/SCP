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