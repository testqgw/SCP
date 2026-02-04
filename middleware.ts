import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// 1. Define routes that DO NOT require authentication
const isPublicRoute = createRouteMatcher([
  "/",                  // Landing page
  "/demo(.*)",          // Demo page (and all sub-paths)
  "/privacy",           // Privacy Policy page
  "/terms",             // Terms of Service page
  "/contact",           // Contact/Help page
  "/sign-in(.*)",       // Sign-in page
  "/sign-up(.*)",       // Sign-up page
  "/api/webhooks(.*)",  // Webhooks (Stripe/Clerk)
  "/api/test",          // Test endpoint
  "/api/uploadthing(.*)"    // ALLOW UPLOADTHING HANDSHAKE
]);

export default clerkMiddleware((auth, req) => {
  // 2. If the route is NOT public, protect it
  if (!isPublicRoute(req)) {
    auth().protect();
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};