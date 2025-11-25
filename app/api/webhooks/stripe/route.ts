import { headers } from "next/headers";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";

export async function POST(req: Request) {
    const body = await req.text();
    const signature = headers().get("Stripe-Signature") as string;

    let event: Stripe.Event;

    try {
        event = stripe.webhooks.constructEvent(
            body,
            signature,
            process.env.STRIPE_WEBHOOK_SECRET!
        );
    } catch (error: any) {
        return new NextResponse(`Webhook Error: ${error.message}`, { status: 400 });
    }

    const session = event.data.object as Stripe.Checkout.Session;

    // EVENT 1: User completed checkout
    if (event.type === "checkout.session.completed") {
        const subscription = await stripe.subscriptions.retrieve(
            session.subscription as string
        );

        if (!session?.metadata?.userId) {
            return new NextResponse("User ID is missing in metadata", { status: 400 });
        }

        await prisma.user.update({
            where: {
                id: session.metadata.userId,
            },
            data: {
                stripeCustomerId: subscription.customer as string,
                stripeSubscriptionId: subscription.id,
                stripePriceId: subscription.items.data[0].price.id,
                stripeCurrentPeriodEnd: new Date(
                    subscription.current_period_end * 1000
                ),
                subscriptionStatus: "active",
                // Map price ID to tier name if needed, or rely on price ID
                subscriptionTier: "professional" // Default to pro for now, can be dynamic
            },
        });
    }

    // EVENT 2: Subscription renewed (Monthly auto-billing)
    if (event.type === "invoice.payment_succeeded") {
        const subscription = await stripe.subscriptions.retrieve(
            session.subscription as string
        );

        await prisma.user.update({
            where: {
                stripeSubscriptionId: subscription.id,
            },
            data: {
                stripePriceId: subscription.items.data[0].price.id,
                stripeCurrentPeriodEnd: new Date(
                    subscription.current_period_end * 1000
                ),
                subscriptionStatus: "active",
            },
        });
    }

    return new NextResponse(null, { status: 200 });
}
