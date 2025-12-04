export const dynamic = 'force-dynamic'; // Force dynamic route for Vercel build
import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';

// GET: Fetch all licenses for the logged-in user (across all businesses they are a member of)
export async function GET() {
  try {
    const { userId } = auth();

    if (!userId) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const licenses = await prisma.license.findMany({
      where: {
        business: {
          memberships: {
            some: {
              userId: userId,
            },
          },
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

    // 1. Verify Membership & Role (Must be ADMIN or OWNER)
    const membership = await prisma.businessMember.findUnique({
      where: {
        userId_businessId: {
          userId,
          businessId,
        },
      },
      include: {
        business: true // Get business details if needed
      }
    });

    if (!membership || (membership.role !== 'OWNER' && membership.role !== 'ADMIN')) {
      return new NextResponse("Forbidden: You do not have permission to add licenses to this business.", { status: 403 });
    }

    // 2. Fetch User Tier (of the current user adding the license)
    // Note: Ideally this should check the Business Owner's tier, but for now we check the actor's tier
    // or we assume if you are an ADMIN of a business, you are operating under that business's limits.
    // Let's keep it simple: Check the ACTOR'S tier for now, OR skip limit if they are just an ADMIN.
    // Actually, let's check the BUSINESS OWNER'S tier.

    // Find the owner of the business
    const ownerMembership = await prisma.businessMember.findFirst({
      where: {
        businessId,
        role: 'OWNER'
      },
      include: {
        user: true
      }
    });

    if (!ownerMembership) {
      return new NextResponse("Business has no owner", { status: 500 });
    }

    const owner = ownerMembership.user;
    const isFreeAccount = owner.subscriptionTier === 'starter';

    // Count licenses for this business
    const businessLicenseCount = await prisma.license.count({
      where: {
        businessId
      }
    });

    // Limit Logic: Free accounts (Owners) can only have 1 license per business? 
    // Or 1 license TOTAL? The prompt said "Free plan limited to 3 licenses. Upgrade to add more!".
    // Let's assume 1 license TOTAL for the Owner across all businesses?
    // Or 1 license per business?
    // The previous code counted `where: { business: { userId } }` which is TOTAL licenses for that user.
    // So we should count all licenses owned by the Business Owner.

    const totalOwnerLicenses = await prisma.license.count({
      where: {
        business: {
          memberships: {
            some: {
              userId: owner.id,
              role: 'OWNER'
            }
          }
        }
      }
    });

    if (isFreeAccount && totalOwnerLicenses >= 3) {
      return NextResponse.json(
        { error: "LIMIT_REACHED", message: "Business Owner's free plan is limited to 3 licenses. Upgrade to add more!." },
        { status: 403 }
      );
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

// DELETE: Delete a license
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

    // Verify ownership/admin via business
    const license = await prisma.license.findUnique({
      where: { id },
      include: { business: true }
    });

    if (!license) {
      return new NextResponse("License not found", { status: 404 });
    }

    // Check membership
    const membership = await prisma.businessMember.findUnique({
      where: {
        userId_businessId: {
          userId,
          businessId: license.businessId,
        },
      },
    });

    if (!membership || (membership.role !== 'OWNER' && membership.role !== 'ADMIN')) {
      return new NextResponse("Forbidden: You do not have permission to delete licenses.", { status: 403 });
    }

    await prisma.license.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[LICENSES_DELETE]', error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
