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
