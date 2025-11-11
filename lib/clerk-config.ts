// Utility to check if Clerk is configured with real keys
export const isClerkConfigured = () => {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  return publishableKey && 
         publishableKey !== 'pk_test_placeholder' && 
         publishableKey !== 'YOUR_PUBLISHABLE_KEY' &&
         publishableKey.startsWith('pk_');
};

// Helper to safely import Clerk components only when configured
export const getClerkComponents = () => {
  if (!isClerkConfigured()) {
    return null;
  }
  
  try {
    return require('@clerk/nextjs');
  } catch (error) {
    return null;
  }
};