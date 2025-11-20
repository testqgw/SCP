import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';

// GET: Fetch a single license
export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { userId } = auth();

    if (!userId) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const license = await prisma.license.findFirst({
      where: {
        id: params.id,
        business: {
          userId: userId,
        },
      },
      include: {
        business: true,
        documents: true,
        reminderSchedules: true,
      },
    });

    if (!license) {
      return new NextResponse("License not found", { status: 404 });
    }

    return NextResponse.json(license);
  } catch (error) {
    console.error('[LICENSE_GET]', error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}

// PUT: Update a license
export async function PUT(
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

    // Verify the license belongs to the user
    const existingLicense = await prisma.license.findFirst({
      where: {
        id: params.id,
        business: {
          userId: userId,
        },
      },
    });

    if (!existingLicense) {
      return new NextResponse("License not found or unauthorized", { status: 403 });
    }

    const updatedLicense = await prisma.license.update({
      where: {
        id: params.id,
      },
      data: {
        licenseType: licenseType || existingLicense.licenseType,
        licenseNumber: licenseNumber !== undefined ? licenseNumber : existingLicense.licenseNumber,
        issuingAuthority: issuingAuthority || existingLicense.issuingAuthority,
        issueDate: issueDate ? new Date(issueDate) : existingLicense.issueDate,
        expirationDate: expirationDate ? new Date(expirationDate) : existingLicense.expirationDate,
        renewalUrl: renewalUrl !== undefined ? renewalUrl : existingLicense.renewalUrl,
        notes: notes !== undefined ? notes : existingLicense.notes,
      },
      include: {
        business: true,
        documents: true,
        reminderSchedules: true,
      },
    });

    return NextResponse.json(updatedLicense);
  } catch (error) {
    console.error('[LICENSE_PUT]', error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}

// DELETE: Delete a license
export async function DELETE(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { userId } = auth();

    if (!userId) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    // Verify the license belongs to the user
    const existingLicense = await prisma.license.findFirst({
      where: {
        id: params.id,
        business: {
          userId: userId,
        },
      },
    });

    if (!existingLicense) {
      return new NextResponse("License not found or unauthorized", { status: 403 });
    }

    await prisma.license.delete({
      where: {
        id: params.id,
      },
    });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('[LICENSE_DELETE]', error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}