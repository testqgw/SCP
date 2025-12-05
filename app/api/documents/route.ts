import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';

// GET: Fetch all documents for the logged-in user (across all licenses)
export async function GET() {
  try {
    const { userId } = auth();

    if (!userId) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const documents = await prisma.document.findMany({
      where: {
        license: {
          business: {
            memberships: {
              some: {
                userId: userId,
              },
            },
          },
        },
      },
      include: {
        license: {
          include: {
            business: true,
          },
        },
      },
      orderBy: {
        uploadedAt: 'desc',
      },
    });

    return NextResponse.json(documents);
  } catch (error) {
    console.error('[DOCUMENTS_GET]', error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}

// POST: Create a new document
export async function POST(req: Request) {
  try {
    const { userId } = auth();
    const body = await req.json();
    const {
      licenseId,
      fileName,
      fileUrl,
      fileType
    } = body;

    if (!userId) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    if (!licenseId || !fileName || !fileUrl || !fileType) {
      return new NextResponse("Missing required fields", { status: 400 });
    }

    // Verify the license belongs to a business the user is a member of (ADMIN or OWNER)
    const license = await prisma.license.findUnique({
      where: {
        id: licenseId,
      },
      include: {
        business: true
      }
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
      return new NextResponse("Forbidden: You do not have permission to add documents to this license.", { status: 403 });
    }

    const document = await prisma.document.create({
      data: {
        licenseId,
        fileName,
        fileUrl,
        fileType,
      },
      include: {
        license: {
          include: {
            business: true,
          },
        },
      },
    });

    return NextResponse.json(document);
  } catch (error) {
    console.error('[DOCUMENTS_POST]', error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}

// DELETE: Delete a document
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

    // Verify ownership via license -> business
    const document = await prisma.document.findUnique({
      where: { id },
      include: { license: { include: { business: true } } }
    });

    if (!document) {
      return new NextResponse("Document not found", { status: 404 });
    }

    // Check membership
    const membership = await prisma.businessMember.findUnique({
      where: {
        userId_businessId: {
          userId,
          businessId: document.license.businessId,
        },
      },
    });

    if (!membership || (membership.role !== 'OWNER' && membership.role !== 'ADMIN')) {
      return new NextResponse("Forbidden: You do not have permission to delete documents.", { status: 403 });
    }

    await prisma.document.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DOCUMENTS_DELETE]', error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}