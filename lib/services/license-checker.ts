import { prisma } from "@/lib/prisma";
import { addDays, startOfDay, endOfDay } from "date-fns";

/**
 * Find licenses expiring in exactly X days from now
 * @param daysFromNow - Number of days in the future to check (e.g., 30, 60, 90)
 * @returns Array of licenses with their business and owner/admin details
 */
export async function getExpiringLicenses(daysFromNow: number) {
    // 1. Calculate the target window (Start & End of that specific day)
    const targetDate = addDays(new Date(), daysFromNow);
    const startWindow = startOfDay(targetDate);
    const endWindow = endOfDay(targetDate);

    console.log(`🔍 Checking for licenses expiring on: ${startWindow.toISOString()}`);

    // 2. Query the DB
    const licenses = await prisma.license.findMany({
        where: {
            expirationDate: {
                gte: startWindow, // Greater than or equal to start of day
                lte: endWindow,   // Less than or equal to end of day
            },
        },
        include: {
            business: {
                include: {
                    memberships: {
                        where: {
                            role: { in: ["OWNER", "ADMIN"] } // Only notify Owners/Admins
                        },
                        include: {
                            user: true // Get the email/phone of the user
                        }
                    }
                }
            }
        }
    });

    console.log(`✅ Found ${licenses.length} license(s) expiring in ${daysFromNow} days`);

    return licenses;
}

/**
 * Find all licenses expiring within a range of days
 * @param minDays - Minimum days from now (inclusive)
 * @param maxDays - Maximum days from now (inclusive)
 * @returns Array of licenses with their business and owner/admin details
 */
export async function getExpiringLicensesInRange(minDays: number, maxDays: number) {
    const startDate = addDays(new Date(), minDays);
    const endDate = addDays(new Date(), maxDays);

    const startWindow = startOfDay(startDate);
    const endWindow = endOfDay(endDate);

    console.log(`🔍 Checking for licenses expiring between: ${startWindow.toISOString()} and ${endWindow.toISOString()}`);

    const licenses = await prisma.license.findMany({
        where: {
            expirationDate: {
                gte: startWindow,
                lte: endWindow,
            },
        },
        include: {
            business: {
                include: {
                    memberships: {
                        where: {
                            role: { in: ["OWNER", "ADMIN"] }
                        },
                        include: {
                            user: true
                        }
                    }
                }
            }
        },
        orderBy: {
            expirationDate: 'asc'
        }
    });

    console.log(`✅ Found ${licenses.length} license(s) expiring in ${minDays}-${maxDays} days`);

    return licenses;
}
