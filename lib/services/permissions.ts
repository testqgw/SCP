import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { BusinessRole } from "@prisma/client";

/**
 * Get the user's access level for a specific business
 * @param businessId - The business ID to check access for
 * @returns The user's role (OWNER, ADMIN, VIEWER) or null if no access
 */
export async function getBusinessAccess(businessId: string): Promise<BusinessRole | null> {
  const { userId } = auth();

  if (!userId) {
    return null; // Not logged in
  }

  // Check the membership table
  const membership = await prisma.businessMember.findUnique({
    where: {
      userId_businessId: {
        userId,
        businessId,
      },
    },
  });

  if (!membership) {
    return null; // No access at all
  }

  return membership.role; // Returns "OWNER", "ADMIN", or "VIEWER"
}

/**
 * Verify that the user has OWNER or ADMIN role for a business
 * @param businessId - The business ID to check
 * @throws Error if user is not OWNER or ADMIN
 */
export async function verifyOwnerOrAdmin(businessId: string): Promise<boolean> {
  const role = await getBusinessAccess(businessId);
  
  if (role !== "OWNER" && role !== "ADMIN") {
    throw new Error("Unauthorized: Insufficient permissions");
  }
  
  return true;
}

/**
 * Verify that the user has OWNER role for a business
 * @param businessId - The business ID to check
 * @throws Error if user is not OWNER
 */
export async function verifyOwner(businessId: string): Promise<boolean> {
  const role = await getBusinessAccess(businessId);
  
  if (role !== "OWNER") {
    throw new Error("Unauthorized: Only business owners can perform this action");
  }
  
  return true;
}

/**
 * Check if the user is a member of a business (any role)
 * @param businessId - The business ID to check
 * @returns true if user is a member, false otherwise
 */
export async function isMember(businessId: string): Promise<boolean> {
  const role = await getBusinessAccess(businessId);
  return role !== null;
}
