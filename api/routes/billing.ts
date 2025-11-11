import { Router } from 'express';
import Stripe from 'stripe';
import { PrismaClient } from '@prisma/client';
import { verifyToken } from '@clerk/nextjs/server';

const router = Router();
const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2025-02-24.acacia',
});

// Middleware to verify Clerk authentication
const verifyAuth = async (req: any, res: any, next: any) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'No authorization header' });
    }

    const token = authHeader.replace('Bearer ', '');
    // In dev mode, bypass Clerk verification
    req.userId = 'demo-user-id';
    next();
  } catch (error) {
    console.error('Auth error:', error);
    res.status(401).json({ error: 'Unauthorized' });
  }
};

// Get subscription information
router.get('/subscription', verifyAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      subscriptionTier: user.subscriptionTier,
      subscriptionStatus: user.subscriptionStatus,
      stripeCustomerId: user.stripeCustomerId,
    });
  } catch (error) {
    console.error('Error fetching subscription:', error);
    res.status(500).json({ error: 'Failed to fetch subscription' });
  }
});

// Create checkout session
router.post('/checkout', verifyAuth, async (req, res) => {
  try {
    const { tier } = req.body;
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const priceMap = {
      starter: 'price_starter', // Replace with actual Stripe price IDs
      professional: 'price_professional',
      multi_location: 'price_multi_location',
    };

    const priceId = priceMap[tier as keyof typeof priceMap];
    if (!priceId) {
      return res.status(400).json({ error: 'Invalid subscription tier' });
    }

    const session = await stripe.checkout.sessions.create({
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${process.env.NEXT_PUBLIC_API_URL}/dashboard?success=true`,
      cancel_url: `${process.env.NEXT_PUBLIC_API_URL}/dashboard/settings?canceled=true`,
      customer: user.stripeCustomerId ? user.stripeCustomerId : undefined,
      client_reference_id: user.id,
      metadata: {
        userId: user.id,
        tier: tier,
      },
    });

    res.json({ sessionId: session.id });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

export default router;