"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReminderJob = void 0;
exports.generateReminderSchedulesForWindow = generateReminderSchedulesForWindow;
// @ts-ignore
const node_cron_1 = __importDefault(require("node-cron"));
const client_1 = require("@prisma/client");
const date_fns_1 = require("date-fns");
const prisma = new client_1.PrismaClient();
const OFFSETS = [90, 60, 30, 14, 7, 1];
async function generateReminderSchedulesForWindow() {
    const now = new Date();
    const in90 = (0, date_fns_1.addDays)(now, 90);
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
                results.push(prisma.reminderSchedule.upsert({
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
                }));
            }
        }
    }
    return prisma.$transaction(results);
}
class ReminderJob {
    static start() {
        // Run daily at 6:00 AM UTC
        node_cron_1.default.schedule('0 6 * * *', async () => {
            console.log('[cron] Running daily reminder schedule generation at 06:00 UTC');
            try {
                await generateReminderSchedulesForWindow();
                console.log('[cron] Generated schedules successfully');
            }
            catch (e) {
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
exports.ReminderJob = ReminderJob;
exports.default = ReminderJob;
//# sourceMappingURL=reminderJob.js.map