"use server";

import { auth, currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { absoluteUrl } from "@/lib/utils";
import { redirect } from "next/navigation";

export async function onSubscribe(priceId: string) {
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

    // 3. IF they already have a Stripe Customer ID, create a portal session (Manage Subscription)
    if (dbUser.stripeCustomerId && dbUser.stripePriceId) {
        const stripeSession = await stripe.billingPortal.sessions.create({
            customer: dbUser.stripeCustomerId,
            return_url: billingUrl,
        });

        return { url: stripeSession.url };
    }

    // 4. IF NOT, create a Checkout Session (New Purchase)
    const stripeSession = await stripe.checkout.sessions.create({
        success_url: successUrl,
        cancel_url: cancelUrl,
        payment_method_types: ["card"],
        mode: "subscription",
        billing_address_collection: "auto",
        customer_email: user.emailAddresses[0].emailAddress,
        line_items: [
            {
                price: priceId,
                quantity: 1,
            },
        ],
        metadata: {
            userId: userId, // CRITICAL: This lets us know WHO paid in the webhook
        },
    });

    return { url: stripeSession.url };
}
