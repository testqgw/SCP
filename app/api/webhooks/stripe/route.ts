import { headers } from "next/headers";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";

export const dynamic = 'force-dynamic';

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
        console.error("[STRIPE_WEBHOOK_ERROR]", error.message);
        return new NextResponse(`Webhook Error: ${error.message}`, { status: 400 });
    }

    const session = event.data.object as Stripe.Checkout.Session;

    // EVENT 1: User completed checkout (subscription OR one-time payment)
    if (event.type === "checkout.session.completed") {
        if (!session?.metadata?.userId) {
            console.error("[STRIPE_WEBHOOK] Missing userId in metadata");
            return new NextResponse("User ID is missing in metadata", { status: 400 });
        }

        const userId = session.metadata.userId;
        const paymentMode = session.metadata.mode || "subscription";

        console.log(`[STRIPE_WEBHOOK] Checkout completed for user ${userId}, mode: ${paymentMode}`);

        try {
            if (session.subscription) {
                // SUBSCRIPTION: Handle recurring payment
                const subscription = await stripe.subscriptions.retrieve(
                    session.subscription as string
                );

                await prisma.user.update({
                    where: { id: userId },
                    data: {
                        stripeCustomerId: subscription.customer as string,
                        stripeSubscriptionId: subscription.id,
                        stripePriceId: subscription.items.data[0].price.id,
                        stripeCurrentPeriodEnd: new Date(
                            subscription.current_period_end * 1000
                        ),
                        subscriptionStatus: "active",
                        subscriptionTier: "professional",
                    },
                });

                console.log(`[STRIPE_WEBHOOK] Subscription activated for user ${userId}`);
            } else {
                // ONE-TIME PAYMENT: Handle single purchase
                await prisma.user.update({
                    where: { id: userId },
                    data: {
                        stripeCustomerId: session.customer as string,
                        stripePriceId: session.metadata?.priceId || "one_time_purchase",
                        subscriptionStatus: "active",
                        subscriptionTier: "professional", // Upgrade to pro on purchase
                    },
                });

                console.log(`[STRIPE_WEBHOOK] One-time purchase completed for user ${userId}`);
            }
        } catch (dbError: any) {
            console.error("[STRIPE_WEBHOOK] Database update failed:", dbError.message);
            return new NextResponse(`Database Error: ${dbError.message}`, { status: 500 });
        }
    }

    // EVENT 2: Subscription renewed (Monthly auto-billing)
    if (event.type === "invoice.payment_succeeded") {
        // Only process if this is a subscription invoice
        if (session.subscription) {
            try {
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

                console.log(`[STRIPE_WEBHOOK] Subscription renewed: ${subscription.id}`);
            } catch (error: any) {
                console.error("[STRIPE_WEBHOOK] Renewal update failed:", error.message);
            }
        }
    }

    // EVENT 3: Subscription canceled
    if (event.type === "customer.subscription.deleted") {
        const subscription = event.data.object as Stripe.Subscription;

        try {
            await prisma.user.update({
                where: {
                    stripeSubscriptionId: subscription.id,
                },
                data: {
                    subscriptionStatus: "canceled",
                    subscriptionTier: "starter", // Downgrade to free tier
                },
            });

            console.log(`[STRIPE_WEBHOOK] Subscription canceled: ${subscription.id}`);
        } catch (error: any) {
            console.error("[STRIPE_WEBHOOK] Cancel update failed:", error.message);
        }
    }

    return new NextResponse(null, { status: 200 });
}

