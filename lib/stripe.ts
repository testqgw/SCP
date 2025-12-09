import Stripe from "stripe";

export const stripe = new Stripe(process.env.STRIPE_API_KEY || process.env.STRIPE_SECRET_KEY || 'sk_test_dummy', {
    apiVersion: "2025-02-24.acacia",
    typescript: true,
});
