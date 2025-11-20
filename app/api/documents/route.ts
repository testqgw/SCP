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
            userId: userId,
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

    // Verify the license belongs to the user
    const license = await prisma.license.findFirst({
      where: {
        id: licenseId,
        business: {
          userId: userId,
        },
      },
    });

    if (!license) {
      return new NextResponse("License not found or unauthorized", { status: 403 });
    }

    const document = await prisma.document.create({
      data: {
        licenseId,
        fileName,
        fileUrl,
        fileType,
      },
    });

    return NextResponse.json(document);
  } catch (error) {
    console.error('[DOCUMENTS_POST]', error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}