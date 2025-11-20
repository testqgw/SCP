import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// ✅ FLIPPED LOGIC: Define only what needs PROTECTION
// If a URL matches this list, the user MUST be logged in.
// If a URL does NOT match (like /demo), it is automatically Public.
const isProtectedRoute = createRouteMatcher([
  '/dashboard(.*)',           // Protect the Dashboard
  '/api/businesses(.*)',      // Protect Data APIs
  '/api/licenses(.*)',
  '/api/documents(.*)',
  '/api/settings(.*)',
  '/api/cron(.*)',            // Protect Cron Job (it has its own key check too)
]);

export default clerkMiddleware((auth, req) => {
  // Only protect if it matches the list above
  if (isProtectedRoute(req)) {
    auth().protect();
  }
});

export const config = {
  matcher: [
    // Standard Next.js Matcher
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};