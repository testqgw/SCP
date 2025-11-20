import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import twilio from 'twilio';

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) return new NextResponse('Unauthorized', { status: 401 });

  try {
    const today = new Date();
    const intervals = [90, 60, 30, 14, 7, 1];
    let smsSent = 0;

    for (const days of intervals) {
      const targetDate = new Date();
      targetDate.setDate(today.getDate() + days);
      const start = new Date(targetDate.setHours(0, 0, 0, 0));
      const end = new Date(targetDate.setHours(23, 59, 59, 999));

      const licenses = await prisma.license.findMany({
        where: { expirationDate: { gte: start, lte: end } },
        include: { business: { include: { user: true } } }
      });

      for (const license of licenses) {
        const phone = license.business.user.phone;
        if (phone) {
          await client.messages.create({
            body: `⚠️ SafeOps Alert: Your license "${license.licenseType}" expires in ${days} days. Renew now.`,
            from: process.env.TWILIO_PHONE_NUMBER,
            to: phone
          });
          smsSent++;
        }
      }
    }
    return NextResponse.json({ success: true, smsSent });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Job Failed' }, { status: 500 });
  }
}