import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';

// GET: Fetch a single document
export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { userId } = auth();

    if (!userId) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const document = await prisma.document.findFirst({
      where: {
        id: params.id,
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
    });

    if (!document) {
      return new NextResponse("Document not found", { status: 404 });
    }

    return NextResponse.json(document);
  } catch (error) {
    console.error('[DOCUMENT_GET]', error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}

// PUT: Update a document
export async function PUT(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { userId } = auth();
    const body = await req.json();
    const { 
      fileName, 
      fileUrl, 
      fileType 
    } = body;

    if (!userId) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    // Verify the document belongs to the user
    const existingDocument = await prisma.document.findFirst({
      where: {
        id: params.id,
        license: {
          business: {
            userId: userId,
          },
        },
      },
    });

    if (!existingDocument) {
      return new NextResponse("Document not found or unauthorized", { status: 403 });
    }

    const updatedDocument = await prisma.document.update({
      where: {
        id: params.id,
      },
      data: {
        fileName: fileName || existingDocument.fileName,
        fileUrl: fileUrl || existingDocument.fileUrl,
        fileType: fileType || existingDocument.fileType,
      },
      include: {
        license: {
          include: {
            business: true,
          },
        },
      },
    });

    return NextResponse.json(updatedDocument);
  } catch (error) {
    console.error('[DOCUMENT_PUT]', error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}

// DELETE: Delete a document
export async function DELETE(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { userId } = auth();

    if (!userId) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    // Verify the document belongs to the user
    const existingDocument = await prisma.document.findFirst({
      where: {
        id: params.id,
        license: {
          business: {
            userId: userId,
          },
        },
      },
    });

    if (!existingDocument) {
      return new NextResponse("Document not found or unauthorized", { status: 403 });
    }

    await prisma.document.delete({
      where: {
        id: params.id,
      },
    });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('[DOCUMENT_DELETE]', error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}