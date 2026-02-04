import { headers } from "next/headers";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { sendVIPPurchaseNotification } from "@/lib/services/notifications";

// VIP Onboarding Price ID
const VIP_ONBOARDING_PRICE_ID = "price_1SxAl49HXJ0MifVdQe1szxsa";

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
        const priceId = session.metadata?.priceId;

        console.log(`[STRIPE_WEBHOOK] Checkout completed for user ${userId}, mode: ${paymentMode}, priceId: ${priceId}`);

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
                        stripePriceId: priceId || "one_time_purchase",
                        subscriptionStatus: "active",
                        subscriptionTier: "professional", // Upgrade to pro on purchase
                    },
                });

                console.log(`[STRIPE_WEBHOOK] One-time purchase completed for user ${userId}`);

                // Check if this is a VIP Onboarding purchase
                if (priceId === VIP_ONBOARDING_PRICE_ID) {
                    console.log(`[STRIPE_WEBHOOK] 🎉 VIP Onboarding purchased by user ${userId}!`);

                    // Get customer email from session or database
                    const user = await prisma.user.findUnique({
                        where: { id: userId },
                        select: { email: true, name: true }
                    });

                    if (user?.email) {
                        await sendVIPPurchaseNotification(user.email, user.name || undefined);
                    } else {
                        // Fallback: use email from Stripe session
                        const customerEmail = session.customer_details?.email || session.customer_email;
                        const customerName = session.customer_details?.name;
                        if (customerEmail) {
                            await sendVIPPurchaseNotification(customerEmail, customerName || undefined);
                        }
                    }
                }
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

