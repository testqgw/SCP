import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { isClerkConfigured } from '@/lib/clerk-config'

export function middleware(request: NextRequest) {
  // In dev mode without Clerk, allow all routes
  if (!isClerkConfigured()) {
    return NextResponse.next()
  }

  // With Clerk keys, use Clerk middleware
  const { clerkMiddleware, createRouteMatcher } = require('@clerk/nextjs/server')
  
  const isPublicRoute = createRouteMatcher([
    '/',
    '/sign-in(.*)',
    '/sign-up(.*)',
    '/api/webhooks(.*)',
  ])

  return clerkMiddleware((auth: any, req: NextRequest) => {
    if (!isPublicRoute(req)) {
      auth().protect()
    }
  })(request)
}

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}