
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher([
  "/",                  
  "/demo",              
  "/demo/(.*)",         
  "/sign-in(.*)",       
  "/