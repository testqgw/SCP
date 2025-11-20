import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// 1. Define routes that DO NOT require authentication
const isPublicRoute = createRouteMatcher([
  "/",                  // Landing page
  "/demo(.*)",          // 👈 UPDATED: Matches /demo, /demo/, etc.
  "/sign-in(.*)",       // Sign-in page (and all sub-paths)
  "/sign-up(.*)",       // Sign-up page (and all sub-paths)
  "/api/webhooks(.*)",  // Webhooks (Stripe/Clerk)
  "/api/test"           // Test endpoint
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