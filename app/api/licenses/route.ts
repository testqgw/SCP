export const dynamic = 'force-dynamic'; // Force dynamic route for Vercel build
import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';

// GET: Fetch all licenses for the logged-in user (across all businesses)
export async function GET() {
  try {
    const { userId } = auth();

    if (!userId) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const licenses = await prisma.license.findMany({
      where: {
        business: {
          userId: userId,
        },
      },
      include: {
        business: true,
        documents: true,
        reminderSchedules: true,
      },
      orderBy: {
        expirationDate: 'asc',
      },
    });

    return NextResponse.json(licenses);
  } catch (error) {
    console.error('[LICENSES_GET]', error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}

// POST: Create a new license
export async function POST(req: Request) {
  try {
    const { userId } = auth();
    const body = await req.json();
    const {
      businessId,
      licenseType,
      licenseNumber,
      issuingAuthority,
      issueDate,
      expirationDate,
      renewalUrl,
      notes
    } = body;

    if (!userId) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    if (!businessId || !licenseType || !issuingAuthority || !issueDate || !expirationDate) {
      return new NextResponse("Missing required fields", { status: 400 });
    }

    // 1. Fetch User Tier
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { subscriptionTier: true }
    });

    // 2. Count Current Licenses
    const licenseCount = await prisma.license.count({
      where: {
        business: { userId: userId }
      }
    });

    // 3. THE GATEKEEPER LOGIC 🛡️
    // If User is 'starter' AND they already have 1 or more licenses... BLOCK THEM.
    const isFreeUser = user?.subscriptionTier === 'starter';
    
    if (isFreeUser && licenseCount >= 1) {
      return NextResponse.json(
        { error: "LIMIT_REACHED", message: "Free plan is limited to 1 license. Please upgrade." },
        { status: 403 }
      );
    }

    // Verify the business belongs to the user
    const business = await prisma.business.findFirst({
      where: {
        id: businessId,
        userId: userId,
      },
    });

    if (!business) {
      return new NextResponse("Business not found or unauthorized", { status: 403 });
    }

    const license = await prisma.license.create({
      data: {
        businessId,
        licenseType,
        licenseNumber: licenseNumber || '',
        issuingAuthority,
        issueDate: new Date(issueDate),
        expirationDate: new Date(expirationDate),
        renewalUrl: renewalUrl || '',
        notes: notes || '',
      },
    });

    return NextResponse.json(license);
  } catch (error) {
    console.error('[LICENSES_POST]', error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}