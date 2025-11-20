import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';

// GET: Fetch all licenses for a specific business
export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { userId } = auth();

    if (!userId) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    // Verify the business belongs to the user
    const business = await prisma.business.findFirst({
      where: {
        id: params.id,
        userId: userId,
      },
    });

    if (!business) {
      return new NextResponse("Business not found or unauthorized", { status: 403 });
    }

    const licenses = await prisma.license.findMany({
      where: {
        businessId: params.id,
      },
      include: {
        documents: true,
        reminderSchedules: true,
      },
      orderBy: {
        expirationDate: 'asc',
      },
    });

    return NextResponse.json(licenses);
  } catch (error) {
    console.error('[BUSINESS_LICENSES_GET]', error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}

// POST: Create a license for a specific business
export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { userId } = auth();
    const body = await req.json();
    const { 
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

    if (!licenseType || !issuingAuthority || !issueDate || !expirationDate) {
      return new NextResponse("Missing required fields", { status: 400 });
    }

    // Verify the business belongs to the user
    const business = await prisma.business.findFirst({
      where: {
        id: params.id,
        userId: userId,
      },
    });

    if (!business) {
      return new NextResponse("Business not found or unauthorized", { status: 403 });
    }

    const license = await prisma.license.create({
      data: {
        businessId: params.id,
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
    console.error('[BUSINESS_LICENSES_POST]', error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}