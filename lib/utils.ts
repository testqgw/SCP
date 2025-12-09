import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

export function absoluteUrl(path: string) {
    // Prioritize custom domain over Vercel's auto-generated URL
    if (process.env.NEXT_PUBLIC_APP_URL) {
        return `${process.env.NEXT_PUBLIC_APP_URL}${path}`;
    }
    if (process.env.VERCEL_URL) {
        return `https://${process.env.VERCEL_URL}${path}`;
    }
    return `http://localhost:3000${path}`;
}

/**
 * Check if a user is in an active beta/trial period
 * @param trialEndsAt - The trial end date from the user record
 * @returns true if the trial is still active
 */
export function isInBetaPeriod(trialEndsAt: Date | null | undefined): boolean {
    if (!trialEndsAt) return false;
    return new Date(trialEndsAt) > new Date();
}

/**
 * Get the number of days remaining in the beta period
 * @param trialEndsAt - The trial end date from the user record
 * @returns Number of days remaining, or 0 if expired/not set
 */
export function getBetaDaysRemaining(trialEndsAt: Date | null | undefined): number {
    if (!trialEndsAt) return 0;
    const endDate = new Date(trialEndsAt);
    const now = new Date();
    if (endDate <= now) return 0;
    const diffMs = endDate.getTime() - now.getTime();
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Get trial end date for new signups (3 months from now)
 */
export function getNewTrialEndDate(): Date {
    const date = new Date();
    date.setMonth(date.getMonth() + 3);
    return date;
}
