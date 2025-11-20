import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic'; // Prevent Next.js from caching this route

export async function GET(request: Request) {
  // 1. Security Check
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Normalize to start of day

    // The intervals we want to check (in days)
    const intervals = [90, 60, 30, 14, 7, 1];
    
    const results = {
      processedAt: new Date().toISOString(),
      foundReminders: 0,
      details: [] as any[],
    };

    // 2. Loop through each interval
    for (const days of intervals) {
      const targetDate = new Date(today);
      targetDate.setDate(targetDate.getDate() + days);

      // Calculate start/end of that target day for database query
      const startOfTarget = new Date(targetDate);
      startOfTarget.setHours(0, 0, 0, 0);
      
      const endOfTarget = new Date(targetDate);
      endOfTarget.setHours(23, 59, 59, 999);

      // 3. Find licenses expiring on that specific day
      const licenses = await prisma.license.findMany({
        where: {
          expirationDate: {
            gte: startOfTarget,
            lte: endOfTarget,
          },
          // Optional: Only check active licenses
          // status: { not: 'canceled' } 
        },
        include: {
          business: {
            include: {
              user: true, // We need the user's email/phone later!
            },
          },
        },
      });

      if (licenses.length > 0) {
        results.foundReminders += licenses.length;
        results.details.push({
          daysUntilExpiration: days,
          count: licenses.length,
          licenses: licenses.map(l => ({
            id: l.id,
            type: l.licenseType,
            number: l.licenseNumber,
            business: l.business.name,
            userEmail: l.business.user.email, // This is where we send the email!
            expirationDate: l.expirationDate,
          }))
        });
      }
    }

    // 4. Return the summary
    return NextResponse.json({ success: true, data: results });

  } catch (error) {
    console.error('Reminder Job Error:', error);
    return NextResponse.json({ success: false, error: 'Job Failed' }, { status: 500 });
  }
}