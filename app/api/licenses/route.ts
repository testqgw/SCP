export const dynamic = 'force-dynamic'; // Force dynamic route for Vercel build
import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import { isInBetaPeriod } from '@/lib/utils';

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

    if (!businessId || !licenseType || !issueDate || !expirationDate) {
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
    const ownerTier = owner.subscriptionTier || 'starter';

    // BETA BYPASS: Check if owner is in beta period
    const isBetaUser = isInBetaPeriod(owner.trialEndsAt);

    // Count licenses for this business
    const businessLicenseCount = await prisma.license.count({
      where: {
        businessId
      }
    });

    // Count TOTAL licenses owned by the Business Owner (across all their businesses)
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

    // License limits by tier
    const LICENSE_LIMITS: Record<string, number> = {
      'starter': 3,
      'owner_operator': 20,
      'fleet_manager': 100,
      'commissary': Infinity, // Unlimited
    };

    const limit = LICENSE_LIMITS[ownerTier] || 3;

    // BETA BYPASS: Skip limit if owner is in beta period
    if (!isBetaUser && totalOwnerLicenses >= limit) {
      const tierNames: Record<string, string> = {
        'starter': 'Owner Operator',
        'owner_operator': 'Fleet Manager',
        'fleet_manager': 'Commissary',
      };
      const nextTier = tierNames[ownerTier] || 'a higher plan';

      return NextResponse.json(
        {
          error: "LIMIT_REACHED",
          message: `You've reached the ${limit} license limit for your plan. Upgrade to ${nextTier} to add more!`,
          currentCount: totalOwnerLicenses,
          limit: limit
        },
        { status: 403 }
      );
    }

    // Parse dates at noon UTC to avoid timezone off-by-one issues
    const parseDate = (dateStr: string) => {
      const [year, month, day] = dateStr.split('-').map(Number);
      return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    };

    const license = await prisma.license.create({
      data: {
        businessId,
        licenseType,
        licenseNumber: licenseNumber || '',
        issuingAuthority: issuingAuthority || '',
        issueDate: parseDate(issueDate),
        expirationDate: parseDate(expirationDate),
        renewalUrl: renewalUrl || '',
        notes: notes || '',
      },
      include: {
        business: true,
        documents: true,
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
