"use server";

import { auth, currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { absoluteUrl } from "@/lib/utils";

export async function onSubscribe(priceId: string, mode: "subscription" | "payment" = "subscription") {
    const { userId } = auth();
    const user = await currentUser();

    if (!userId || !user) {
        return { error: "Unauthorized" };
    }

    // 1. Find the DB User to get their Stripe Customer ID (if it exists)
    const dbUser = await prisma.user.findUnique({
        where: { id: userId },
    });

    if (!dbUser) {
        return { error: "User not found in database" };
    }

    // 2. Define where they return after payment
    const billingUrl = absoluteUrl("/dashboard/settings");
    const successUrl = absoluteUrl("/dashboard/success");
    const cancelUrl = absoluteUrl("/dashboard/upgrade");

    try {
        // 3. IF they already have a Stripe Customer ID AND this is a subscription, create a portal session
        if (dbUser.stripeCustomerId && dbUser.stripePriceId && mode === "subscription") {
            const stripeSession = await stripe.billingPortal.sessions.create({
                customer: dbUser.stripeCustomerId,
                return_url: billingUrl,
            });

            return { url: stripeSession.url };
        }

        // 4. Create a Checkout Session (subscription or one-time payment)
        const stripeSession = await stripe.checkout.sessions.create({
            success_url: successUrl,
            cancel_url: cancelUrl,
            payment_method_types: ["card"],
            mode: mode,
            billing_address_collection: "auto",
            customer_email: user.emailAddresses[0].emailAddress,
            line_items: [
                {
                    price: priceId,
                    quantity: 1,
                },
            ],
            metadata: {
                userId: userId,
                mode: mode, // Track if this was subscription or one-time
            },
        });

        return { url: stripeSession.url };
    } catch (error: any) {
        console.error("[STRIPE_CHECKOUT_ERROR]", {
            message: error.message,
            code: error.code,
            type: error.type,
            priceId: priceId,
            userId: userId,
        });

        // Return user-friendly error message
        if (error.code === 'resource_missing') {
            return { error: "Invalid price configuration. Please contact support." };
        }
        if (error.code === 'api_key_expired' || error.code === 'invalid_api_key') {
            return { error: "Payment system configuration error. Please contact support." };
        }

        return { error: `Failed to create checkout: ${error.message}` };
    }
}
