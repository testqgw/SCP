// @ts-ignore
import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';
import { addDays, startOfDay, differenceInCalendarDays } from 'date-fns';
import { sendSMS } from '../utils/twilio';
import { sendEmail } from '../utils/email';

const prisma = new PrismaClient();

const OFFSETS = [90, 60, 30, 14, 7, 1];

export async function generateReminderSchedulesForWindow() {
  const now = new Date();
  const in90 = addDays(now, 90);

  const licenses = await prisma.license.findMany({
    where: {
      expirationDate: { gt: now, lte: in90 },
      status: { in: ['current', 'expiring_soon'] },
    },
    select: { id: true, expirationDate: true },
  });

  const results = [];
  for (const lic of licenses) {
    for (const d of OFFSETS) {
      for (const type of ['sms', 'email']) {
        results.push(
          prisma.reminderSchedule.upsert({
            where: {
              licenseId_daysBeforeExpiration_reminderType: {
                licenseId: lic.id,
                daysBeforeExpiration: d,
                reminderType: type,
              },
            },
            update: {}, // idempotent
            create: {
              licenseId: lic.id,
              daysBeforeExpiration: d,
              reminderType: type,
              status: 'pending',
            },
          })
        );
      }
    }
  }

  return prisma.$transaction(results);
}

export class ReminderJob {
  static start() {
    // Run daily at 6:00 AM UTC
    cron.schedule('0 6 * * *', async () => {
      console.log('[cron] Running daily reminder schedule generation at 06:00 UTC');
      try {
        await generateReminderSchedulesForWindow();
        console.log('[cron] Generated schedules successfully');
      } catch (e) {
        console.error('[cron] Error generating schedules', e);
      }
    }, { timezone: 'UTC' });

    console.log('Reminder job scheduled to run daily at 6:00 AM UTC');
  }

  static async triggerManually() {
    console.log('Manually triggering reminder schedule generation...');
    const result = await generateReminderSchedulesForWindow();
    console.log(`Generated or verified ${result.length} reminder schedules`);
    return result;
  }
}

export default ReminderJob;