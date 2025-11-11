import { isClerkConfigured } from '../../lib/clerk-config';

// Development mode bypass for API authentication
export const verifyAuth = async (req: any, res: any, next: any) => {
  const clerkConfigured = isClerkConfigured();

  if (!clerkConfigured) {
    // Development mode - bypass authentication
    req.userId = 'dev-user-id-123';
    return next();
  }

  // Production mode - use Clerk authentication
  try {
    const { verifyToken } = require('@clerk/nextjs/server');
    
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'No authorization header' });
    }

    const token = authHeader.replace('Bearer ', '');
    const verified = await verifyToken(token);
    
    if (!verified) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    req.userId = verified.sub;
    next();
  } catch (error) {
    console.error('Auth error:', error);
    res.status(401).json({ error: 'Unauthorized' });
  }
};