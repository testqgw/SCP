import { auth } from "@clerk/nextjs/server";
import { prisma as db } from "@/lib/prisma";
import { redirect } from "next/navigation";

export async function getAdminAccess() {
  const { userId } = auth();

  if (!userId) {
    return redirect("/sign-in");
  }

  // Note: We are looking up by clerkId (which is 'id' in our schema if mapped, or we need to check how User is defined)
  // In our schema, User.id is uuid. We need to check if we store clerkId.
  // Wait, the schema shows 'id' is uuid. Where is clerkId?
  // Let's check the schema again.
  // The schema has 'id' as String @id @default(uuid()).
  // Usually with Clerk, we might store the Clerk ID as 'id' or a separate field.
  // Let's assume 'id' IS the Clerk ID for now, or check how users are created.
  // Checking previous context... 'actions/stripe-redirect.ts' uses 'where: { id: userId }'.
  // So 'id' in our DB IS the Clerk User ID.
  
  const user = await db.user.findUnique({
    where: { id: userId }
  });

  if (!user || user.role !== "ADMIN") {
    // If they try to access admin, kick them back to the normal dashboard
    return redirect("/dashboard");
  }

  return user;
}
