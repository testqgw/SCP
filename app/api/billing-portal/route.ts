import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import Stripe from "stripe";

// Force dynamic to avoid build-time initialization
export const dynamic = 'force-dynamic';

export async function POST() {
    try {
        const { userId } = auth();

        if (!userId) {
            return new NextResponse("Unauthorized", { status: 401 });
        }

        // Initialize Stripe inside the function to avoid build-time errors
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
            apiVersion: "2025-02-24.acacia",
        });

        // Get user's Stripe customer ID from database
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { stripeCustomerId: true, email: true }
        });

        if (!user) {
            return new NextResponse("User not found", { status: 404 });
        }

        let customerId = user.stripeCustomerId;

        // If no customer ID, try to find by email
        if (!customerId) {
            const customers = await stripe.customers.list({
                email: user.email,
                limit: 1
            });

            if (customers.data.length > 0) {
                customerId = customers.data[0].id;
                await prisma.user.update({
                    where: { id: userId },
                    data: { stripeCustomerId: customerId }
                });
            } else {
                return NextResponse.json({
                    error: "NO_SUBSCRIPTION",
                    message: "No active subscription found. Please upgrade your plan first."
                }, { status: 400 });
            }
        }

        // Create billing portal session
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://ultops.com';
        const session = await stripe.billingPortal.sessions.create({
            customer: customerId,
            return_url: `${appUrl}/dashboard/settings`,
        });

        return NextResponse.json({ url: session.url });
    } catch (error) {
        console.error("[BILLING_PORTAL_ERROR]", error);
        return new NextResponse("Internal Error", { status: 500 });
    }
}
