export const dynamic = 'force-dynamic'; // Force dynamic route for Vercel build
import { NextResponse } from 'next/server';
import { auth, currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import { isInBetaPeriod, getNewTrialEndDate } from '@/lib/utils';

// GET: Fetch all businesses for the logged-in user
export async function GET() {
  try {
    const { userId } = auth();

    if (!userId) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const businesses = await prisma.business.findMany({
      where: {
        memberships: {
          some: {
            userId: userId,
          },
        },
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
    // NEW: Set trialEndsAt for 3-month free beta for new users
    const existingUser = await prisma.user.findUnique({ where: { id: user.id } });

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
        subscriptionTier: "starter",
        trialEndsAt: getNewTrialEndDate(), // 3-month free beta!
      },
    });

    // BUSINESS LIMIT ENFORCER: Check tier and existing count
    const userRecord = await prisma.user.findUnique({
      where: { id: user.id },
      select: { subscriptionTier: true, trialEndsAt: true }
    });

    // Check membership count instead of ownership
    const businessCount = await prisma.businessMember.count({
      where: {
        userId: user.id,
        role: 'OWNER' // Only count businesses they OWN against the limit
      }
    });

    // BETA BYPASS: Skip limit if user is in beta period
    const isBetaUser = isInBetaPeriod(userRecord?.trialEndsAt);

    // If starter tier and already has 1+ businesses AND not in beta, block creation
    if (!isBetaUser && userRecord?.subscriptionTier === 'starter' && businessCount >= 1) {
      return NextResponse.json(
        { error: "LIMIT_REACHED", message: "Free plan limited to 1 Business." },
        { status: 403 }
      );
    }

    // Create Business + Membership in Transaction
    const business = await prisma.$transaction(async (tx) => {
      const newBusiness = await tx.business.create({
        data: {
          userId: user.id, // Keep for schema compatibility for now
          name,
          businessType: businessType || 'other',
          address: address || '',
          city: city || '',
          state: state || '',
          zip: zip || '',
          phone: phone || '',
        },
      });

      await tx.businessMember.create({
        data: {
          userId: user.id,
          businessId: newBusiness.id,
          role: 'OWNER',
        },
      });

      return newBusiness;
    });

    return NextResponse.json(business);
  } catch (error) {
    console.error('[BUSINESSES_POST]', error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}

// PUT: Update a business
export async function PUT(req: Request) {
  try {
    const { userId } = auth();
    const body = await req.json();
    const { id, name, businessType, address, city, state, zip, phone } = body;

    if (!userId) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    if (!id) {
      return new NextResponse("Business ID is required", { status: 400 });
    }

    // Check if user is an OWNER or ADMIN of this business
    const membership = await prisma.businessMember.findUnique({
      where: {
        userId_businessId: {
          userId,
          businessId: id,
        },
      },
    });

    if (!membership || (membership.role !== 'OWNER' && membership.role !== 'ADMIN')) {
      return new NextResponse("Forbidden: Only Owners/Admins can edit businesses", { status: 403 });
    }

    // Update the business - trim city to remove trailing commas
    const updatedBusiness = await prisma.business.update({
      where: { id },
      data: {
        name: name?.trim() || undefined,
        businessType: businessType || undefined,
        address: address?.trim() || undefined,
        city: city?.trim().replace(/,+$/, '') || undefined,
        state: state?.trim() || undefined,
        zip: zip?.trim() || undefined,
        phone: phone?.trim() || undefined,
      },
    });

    return NextResponse.json(updatedBusiness);
  } catch (error) {
    console.error('[BUSINESSES_PUT]', error);
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

    // Check if user is an OWNER of this business
    const membership = await prisma.businessMember.findUnique({
      where: {
        userId_businessId: {
          userId,
          businessId: id,
        },
      },
    });

    if (!membership || membership.role !== 'OWNER') {
      return new NextResponse("Forbidden: Only Owners can delete businesses", { status: 403 });
    }

    const business = await prisma.business.delete({
      where: {
        id,
      },
    });

    return NextResponse.json(business);
  } catch (error) {
    console.error('[BUSINESSES_DELETE]', error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}